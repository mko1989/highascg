/**
 * WO-345 — Shader Live workflow (owner 2026-07-27).
 *
 * Clicking the header mascot WHILE it is the shades bunny (cefEnableGpu on) toggles a
 * full-workspace overlay that replaces the looks list/editor with a live-shader editor: every
 * shader currently LIVE on any channel (from scene.live) is listed, the selected one's
 * parameters (WO-340 scan: sliders / color pickers) are shown, and every control change rides
 * straight onto the RUNNING producer via `CG <ch>-<layer> UPDATE` — player.js hot-recompiles in
 * place (no restart, no black, audio/clock uninterrupted). Save persists to the shader library.
 */

import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { rewriteParamValues } from '../lib/shader-param-scan.js'
import { scanShaderCfg } from '../lib/shader-controls.js'
import { liveShaderInstances, createPlaylistNowTracker } from '../lib/shader-live-instances.js'
import { pushCgUpdateTo, wiggleParamOnPreview } from '../lib/shader-cg-update.js'
import { MIXER_ROWS, mixerRowsHtml, groupHtml, paramRowHtml, advancedHtml } from './shader-live-rows.js'
import { createShaderControlsPanel } from './shader-controls-panel.js'
import { installShaderAudition } from './shader-live-audition.js'
import { createShaderLiveStack } from './shader-live-stack.js'

export function initShaderLiveEditor(stateStore) {
	let overlay = null
	let selectedKey = null
	let shaderCfg = null // { id, name, common, passes } — working copy with live edits applied
	let dirty = false
	let params = []
	let pristine = null
	let pristineParams = null
	let pristineByKey = new Map() // param key → library values (macro base, presets, reset)
	let advOpen = false
	let panel = null
	let unsub = null
	let _stack = null

	const isGlassesLogo = () => settingsState.getSettings()?.operatorTools?.cefEnableGpu === true

	function ensureOverlay() {
		if (overlay) return overlay
		overlay = document.createElement('div')
		overlay.id = 'shader-live-overlay'
		overlay.className = 'shader-live shader-live--inline'
		overlay.innerHTML = `
			<div class="shader-live__bar">
				<span class="shader-live__title">🕶 Shader Live</span>
				<select class="inspector-field__select" id="shl-instance" style="max-width:340px"></select>
				<button type="button" class="btn scenes-btn--take shader-live__take" id="shl-take" title="Take preview to program (same transition as the deck ▶)">▶</button>
				<span class="shader-live__dirty" id="shl-dirty" hidden>● live edits not saved</span>
				<button type="button" class="btn btn--secondary" id="shl-reset-all" title="Restore every parameter to the library values (recovery for a broken shader)">Reset all</button>
				<button type="button" class="btn" id="shl-save" disabled>Save to library</button>
				<button type="button" class="btn btn--secondary" id="shl-close" title="Back to looks">✕</button>
			</div>
			<div class="shader-live__body">
				<div class="shader-live__params" id="shl-params"><p class="settings-note">No shader live — take a shader look to PGM or PRV.</p></div>
				<div class="shader-live__stack" id="shl-stack"></div>
			</div>`
		/* Owner 2026-07-27: the compose preview must stay exactly where it is — the panel replaces
		 * only the looks area BELOW it (.scenes-main inside .scenes-split). */
		overlay.querySelector('#shl-close').addEventListener('click', () => setOpen(false))
		overlay.querySelector('#shl-instance').addEventListener('change', (e) => {
			selectedKey = e.target.value
			void loadSelected()
		})
		overlay.querySelector('#shl-save').addEventListener('click', () => void saveToLibrary())
		/* todos27: PRV→PGM from inside the editor — fires the deck's global take (hidden while
		 * shaders mode is open, but its handler and transition semantics stay the source of truth). */
		overlay.querySelector('#shl-take').addEventListener('click', () => {
			const takeBtn = document.querySelector('#scenes-global-take')
			if (takeBtn) takeBtn.click()
			else window.showToast?.('Take unavailable — deck not mounted', 'error')
		})
		overlay.querySelector('#shl-reset-all').addEventListener('click', () => void resetAll())
		_stack = createShaderLiveStack({ stateStore, getSelected: selected })
		_stack.mount(overlay.querySelector('#shl-stack'))
		panel = createShaderControlsPanel({
			getParams: () => params,
			getManifest: () => shaderCfg?.controls || null,
			setManifest: (m) => {
				if (shaderCfg) shaderCfg.controls = m
				return persistCfg()
			},
			pristine: () => pristineByKey,
			applyBatch,
			labelOf: (p) => shaderCfg?.paramLabels?.[labelKeyOf(p)],
			rerender: () => renderParams(),
		})
		panel.attach(overlay.querySelector('#shl-params'))
		/* `toggle` does not bubble — capture it; the Advanced list is built lazily (up to 48 rows). */
		overlay.querySelector('#shl-params').addEventListener(
			'toggle',
			(e) => {
				if (e.target?.id !== 'shl-adv') return
				advOpen = e.target.open
				if (advOpen) fillAdvanced()
			},
			true,
		)
		overlay.querySelector('#shl-params').addEventListener('click', onParamReset)
		overlay.querySelector('#shl-params').addEventListener('click', (e) => void onParamWiggle(e))
		overlay.querySelector('#shl-params').addEventListener('click', (e) => void onParamRename(e))
		/* todos27: wheel over a slider = one step per notch — small precise changes. */
		overlay.querySelector('#shl-params').addEventListener(
			'wheel',
			(e) => {
				const t = e.target
				if (!(t instanceof HTMLInputElement) || t.type !== 'range') return
				e.preventDefault()
				const step = parseFloat(t.step) || 0.01
				const lo = parseFloat(t.min)
				const hi = parseFloat(t.max)
				const next = Math.min(hi, Math.max(lo, (parseFloat(t.value) || 0) + (e.deltaY < 0 ? step : -step)))
				t.value = String(next)
				t.dispatchEvent(new Event('input', { bubbles: true }))
			},
			{ passive: false },
		)
		overlay.querySelector('#shl-params').addEventListener('change', onControlChange)
		overlay.querySelector('#shl-params').addEventListener('input', onControlInputMirror)
		return overlay
	}

	/* issues 01.08: playlist layers hop server-side without touching scene.live — resolve them to
	 * the item actually ON AIR, else edits (and the 403→CG ADD re-host) land on the stale first
	 * shader and visibly replay it. Polls only while the overlay is open. */
	const _plNow = createPlaylistNowTracker(api, () => onLiveChanged())
	const instances = () => liveShaderInstances(stateStore, _plNow.now())
	const keyOf = (i) => `${i.shaderId}@${i.channel}-${i.pLayer}`
	const selected = () => instances().find((i) => keyOf(i) === selectedKey) || null

	function renderInstanceList() {
		const sel = overlay.querySelector('#shl-instance')
		const list = instances()
		if (!list.length) {
			sel.innerHTML = '<option value="">— no live shader —</option>'
			overlay.querySelector('#shl-params').innerHTML =
				'<p class="settings-note">No shader live — take a shader look to PGM or PRV.</p>'
			return false
		}
		if (!list.some((i) => keyOf(i) === selectedKey)) {
			/* issues 01.08: a playlist hop replaces this channel-layer's instance — FOLLOW the layer
			 * (load the shader now on air there) instead of snapping back to the first in the list. */
			const tail = String(selectedKey || '').split('@')[1]
			const follow = tail ? list.find((i) => keyOf(i).endsWith(`@${tail}`)) : null
			selectedKey = keyOf(follow || list[0])
		}
		const html = list
			.map((i) => {
				const k = keyOf(i)
				const where = `${i.isPrv ? 'PRV' : 'PGM'} ch${i.channel} L${i.pLayer}`
				return `<option value="${escapeHtml(k)}"${k === selectedKey ? ' selected' : ''}>${escapeHtml(`${i.shaderId} — ${where} (${i.sceneName})`)}</option>`
			})
			.join('')
		/* todos27: the state store fires every second — rewriting identical options made the
		 * dropdown blink (and killed an open picker). Only touch the DOM on a real change. */
		if (sel.dataset.optionsHtml !== html) {
			sel.dataset.optionsHtml = html
			sel.innerHTML = html
		}
		return true
	}

	async function loadSelected() {
		const inst = selected()
		if (!inst) return
		try {
			shaderCfg = await api.get(`/api/shaders/${encodeURIComponent(inst.shaderId)}`)
		} catch (e) {
			overlay.querySelector('#shl-params').innerHTML = `<p class="settings-note">Load failed: ${escapeHtml(e?.message || String(e))}</p>`
			return
		}
		dirty = false
		/* WO-348: pristine copy for per-param revert + Reset all (recovery from broken values). */
		pristine = {
			common: shaderCfg?.common || '',
			passes: Object.fromEntries(Object.entries(shaderCfg?.passes || {}).map(([k, v]) => [k, v ? { source: v.source } : null])),
		}
		pristineParams = null
		pristineByKey = new Map(scanShaderCfg(shaderCfg).map((p) => [p.key, [...p.values]]))
		syncDirty()
		renderParams()
		pristineParams = params.map((p) => ({ values: [...p.values] }))
	}

	const labelOfParam = (p) => shaderCfg?.paramLabels?.[labelKeyOf(p)]

	function fillAdvanced() {
		const host = overlay.querySelector('#shl-adv-body')
		if (host) host.innerHTML = advancedHtml(params, (p, i) => paramRowHtml(p, i, labelOfParam(p)))
	}

	/* Main panel = the synthesized key controls (shader-controls-panel); everything else the
	 * scanner found sits in the collapsed Advanced list, one ★ away from the main panel. */
	function renderParams() {
		params = scanShaderCfg(shaderCfg)
		const host = overlay.querySelector('#shl-params')
		host.innerHTML =
			panel.html() +
			groupHtml('Layer (Caspar mixer)', mixerRowsHtml()) +
			`<details class="shader-live__adv" id="shl-adv"${advOpen ? ' open' : ''}><summary>Advanced — all ${params.length} detected values</summary><div id="shl-adv-body"></div></details>`
		if (advOpen) fillAdvanced()
	}

	/* todos27: stable identity for operator-given labels (survives reloads; deep keys embed the
	 * ordinal + code context so they follow the same literal until the source itself changes). */
	function labelKeyOf(p) {
		/* Deep keys ride the raw code context (stable while the source is unchanged) — the
		 * human name from the auto-decoder may improve between versions and must not orphan
		 * stored labels. */
		return `${p.passKey}:${p.deep ? `deep:${p.context || p.name}` : p.name}`
	}


	function sourceOf(passKey) {
		return passKey === 'common' ? shaderCfg?.common || '' : shaderCfg?.passes?.[passKey]?.source || ''
	}
	function setSource(passKey, src) {
		if (passKey === 'common') shaderCfg.common = src
		else shaderCfg.passes[passKey].source = src
	}

	function onControlInputMirror(e) {
		const t = e.target
		if (!(t instanceof HTMLInputElement) || t.dataset.color != null) return
		if (t.dataset.mixer != null) {
			for (const twin of overlay.querySelectorAll(`[data-mixer="${t.dataset.mixer}"]`)) {
				if (twin !== t) twin.value = t.value
			}
			return
		}
		if (t.dataset.p == null) return
		for (const twin of overlay.querySelectorAll(`[data-p="${t.dataset.p}"][data-c="${t.dataset.c}"]`)) {
			if (twin !== t) twin.value = t.value
		}
	}

	function onControlChange(e) {
		const t = e.target
		if (!(t instanceof HTMLInputElement)) return
		if (t.dataset.mixer != null) {
			const row = MIXER_ROWS[Number(t.dataset.mixer)]
			const inst = selected()
			const v = Number(t.value)
			if (!row || !inst || !Number.isFinite(v)) return
			void api.post('/api/raw', { cmd: `MIXER ${inst.channel}-${inst.pLayer} ${row.cmd} ${v}` }).catch(() => {})
			return
		}
		if (t.dataset.p == null) return
		const p = params[Number(t.dataset.p)]
		if (!p || !shaderCfg) return
		let next
		if (t.dataset.color != null) {
			const m = /^#?([0-9a-f]{6})$/i.exec(t.value)
			if (!m) return
			const n = parseInt(m[1], 16)
			const r4 = (v) => Math.round((v / 255) * 10000) / 10000
			next = [r4((n >> 16) & 255), r4((n >> 8) & 255), r4(n & 255)]
			if (p.vec === 4) next.push(p.values[3])
		} else {
			const v = Number(t.value)
			if (!Number.isFinite(v)) return
			next = [...p.values]
			next[Number(t.dataset.c) || 0] = v
		}
		applyParamValues(p, next)
	}

	/** CG UPDATE the rewritten pass onto EVERY live instance of the selected shader. */
	async function pushLive(passKey) {
		const inst = selected()
		if (!inst) return
		const payload =
			passKey === 'common'
				? { common: shaderCfg.common }
				: { passes: { [passKey]: { source: shaderCfg.passes[passKey].source } } }
		const targets = instances().filter((i) => i.shaderId === inst.shaderId)
		for (const { target: t, error } of await pushCgUpdateTo(api, targets, payload)) {
			/* todos27: playlist hops with a MIX transition PLAY plain html producers — CG UPDATE
			 * 403s on those. Re-host via CG ADD once (one visible restart, only at edit time). */
			if (/403/.test(error) && t.cgName) {
				await api.post('/api/raw', { cmd: `CG ${t.channel}-${t.pLayer} ADD 0 "${t.cgName}" 1 "{}"` }).catch(() => {})
				const again = await pushCgUpdateTo(api, [t], payload)
				if (again.length) console.warn('[shader-live] re-host retry failed:', again[0].error)
			} else {
				console.warn('[shader-live] CG UPDATE failed:', error)
			}
		}
	}

	/* todos27: SHOW what a value does — wiggle it briefly on the PREVIEW instances, restore. */
	async function onParamWiggle(e) {
		const t = e.target
		if (!(t instanceof HTMLElement) || t.dataset.wiggle == null) return
		const p = params[Number(t.dataset.wiggle)]
		const inst = selected()
		if (!p || !inst || !shaderCfg || t.disabled) return
		const prvTargets = instances().filter((i) => i.shaderId === inst.shaderId && i.isPrv)
		if (!prvTargets.length) {
			window.showToast?.('Load this shader on preview first (click it in Templates while in Shader Live)', 'info')
			return
		}
		t.disabled = true
		try {
			await wiggleParamOnPreview({ api, param: p, source: sourceOf(p.passKey), passKey: p.passKey, prvTargets, rewrite: rewriteParamValues })
		} finally {
			t.disabled = false
		}
	}

	async function onParamRename(e) {
		const t = e.target
		if (!(t instanceof HTMLElement) || t.dataset.rename == null) return
		const p = params[Number(t.dataset.rename)]
		if (!p || !shaderCfg) return
		const key = labelKeyOf(p)
		const cur = shaderCfg.paramLabels?.[key] || ''
		const next = window.prompt(`Label for this parameter\n(${p.passKey} — ${p.name})\nEmpty clears the label.`, cur)
		if (next == null) return
		shaderCfg.paramLabels = shaderCfg.paramLabels || {}
		if (String(next).trim()) shaderCfg.paramLabels[key] = String(next).trim()
		else delete shaderCfg.paramLabels[key]
		await persistCfg()
		const keep = params.map((x) => ({ values: [...x.values] }))
		renderParams()
		params.forEach((x, i) => {
			if (keep[i] && keep[i].values.length === x.values.length) x.values = keep[i].values
		})
	}

	function onParamReset(e) {
		const t = e.target
		if (!(t instanceof HTMLElement) || t.dataset.reset == null) return
		const idx = Number(t.dataset.reset)
		const p = params[idx]
		const orig = pristineParams?.[idx]
		if (!p || !orig || orig.values.length !== p.values.length) return
		applyParamValues(p, [...orig.values])
		/* todos27: without a re-render the row kept showing the edited value — the reset DID
		 * land on air but looked dead. Re-render from the rewritten source. */
		renderParams()
	}

	/* Persist the operator's curation (labels/controls/presets) WITHOUT baking in live edits —
	 * the library shader keeps its pristine source; edits only ever land as a child (Save). */
	async function persistCfg() {
		if (!shaderCfg || !pristine) return
		const passes = Object.fromEntries(
			Object.entries(shaderCfg.passes || {}).map(([k, v]) => [k, v && pristine.passes[k] ? { ...v, source: pristine.passes[k].source } : v]),
		)
		try {
			await api.post('/api/shaders', { ...shaderCfg, common: pristine.common, passes })
		} catch (e) {
			console.warn('[shader-live] save of controls failed:', e?.message || e)
		}
	}

	/** Several params at once (macro / preset / randomize): one source rewrite + one CG UPDATE per pass. */
	function applyBatch(items) {
		const byPass = new Map()
		for (const it of items) {
			if (!byPass.has(it.p.passKey)) byPass.set(it.p.passKey, [])
			byPass.get(it.p.passKey).push(it)
		}
		for (const [passKey, list] of byPass) {
			list.sort((a, b) => b.p.spans[0].start - a.p.spans[0].start) // right-to-left keeps earlier spans valid
			try {
				let src = sourceOf(passKey)
				for (const { p, next } of list) src = rewriteParamValues(src, p, next, { preserveInt: !!p.intLiteral })
				setSource(passKey, src)
			} catch {
				renderParams()
				return
			}
		}
		params = scanShaderCfg(shaderCfg)
		dirty = true
		syncDirty()
		for (const passKey of byPass.keys()) void pushLive(passKey)
	}

	function applyParamValues(p, next) {
		let rewritten
		try {
			rewritten = rewriteParamValues(sourceOf(p.passKey), p, next)
		} catch {
			renderParams()
			return
		}
		setSource(p.passKey, rewritten)
		p.values = next
		params = scanShaderCfg(shaderCfg)
		dirty = true
		syncDirty()
		void pushLive(p.passKey)
	}

	async function resetAll() {
		if (!shaderCfg || !pristine) return
		shaderCfg.common = pristine.common
		for (const [k, v] of Object.entries(pristine.passes)) {
			if (v && shaderCfg.passes?.[k]) shaderCfg.passes[k].source = v.source
		}
		renderParams()
		pristineParams = params.map((p) => ({ values: [...p.values] }))
		dirty = false
		syncDirty()
		// Push every pass (and common) back onto the live producer(s).
		await pushLive('common')
		for (const k of ['image', 'bufferA', 'bufferB', 'bufferC', 'bufferD']) {
			if (shaderCfg.passes?.[k]?.source) await pushLive(k)
		}
	}

	/* todos27: a save never overwrites the source shader — it lands as a CHILD (parentId =
	 * the root shader), exported to template/shaders/<child>.html so it shows up in the
	 * templates browser next to its parent. */
	async function saveToLibrary() {
		if (!shaderCfg) return
		try {
			const rootId = shaderCfg.parentId || shaderCfg.id
			const listed = await api.get('/api/shaders')
			const ids = new Set((listed?.shaders || []).map((x) => x.id))
			let n = 2
			while (ids.has(`${rootId}-c${n}`)) n++
			const baseName = String(shaderCfg.name || rootId).replace(/ c\d+$/, '')
			const child = { ...shaderCfg, id: `${rootId}-c${n}`, name: `${baseName} c${n}`, parentId: rootId }
			const r = await api.post('/api/shaders', child)
			if (!r?.ok) throw new Error(r?.error || 'save failed')
			dirty = false
			syncDirty()
			window.showToast?.(`Saved as ${child.id} (child of ${rootId})`, 'success')
		} catch (e) {
			console.warn('[shader-live] save failed:', e?.message || e)
			window.showToast?.(`Save failed: ${e?.message || e}`, 'error')
		}
	}

	function syncDirty() {
		overlay.querySelector('#shl-dirty').hidden = !dirty
		overlay.querySelector('#shl-save').disabled = !dirty
	}

	function onLiveChanged() {
		if (!overlay || overlay.hidden) return
		const had = selectedKey
		if (renderInstanceList() && selectedKey !== had) void loadSelected()
		_stack?.render()
	}

	function setOpen(open) {
		ensureOverlay()
		const mainEl = document.querySelector('.scenes-main')
		if (open && mainEl) {
			mainEl.style.display = 'none'
			mainEl.parentNode.insertBefore(overlay, mainEl.nextSibling)
		} else if (mainEl) {
			mainEl.style.display = ''
			if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
		}
		overlay.hidden = !open
		document.body.classList.toggle('shader-live-open', open)
		if (unsub) {
			unsub()
			unsub = null
		}
		if (open) {
			_plNow.start()
			if (renderInstanceList()) void loadSelected()
			unsub = stateStore.on?.('*', () => onLiveChanged()) || null
		} else {
			_plNow.stop()
		}
	}

	installShaderAudition({ stateStore, isOpen: () => !!overlay && !overlay.hidden, select: (key) => (selectedKey = key) })

	// Trigger: the mascot — only while it wears the shades (GPU CEF on).
	const logo = document.querySelector('img.header__logo')
	if (logo) {
		logo.style.cursor = 'pointer'
		logo.title = 'Shader Live (when the bunny wears shades)'
		logo.addEventListener('click', () => {
			if (!isGlassesLogo()) return
			setOpen(!overlay || overlay.hidden)
		})
	}
}
