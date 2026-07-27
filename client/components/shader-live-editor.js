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
import { scanShaderParams, scanShaderDeepParams, rewriteParamValues } from '../lib/shader-param-scan.js'
import { sceneState } from '../lib/scene-state.js'
import { liveShaderInstances } from '../lib/shader-live-instances.js'
import { pushCgUpdateTo, wiggleParamOnPreview } from '../lib/shader-cg-update.js'
import { MIXER_ROWS, mixerRowsHtml, groupHtml, paramRowHtml, toHex } from './shader-live-rows.js'
import { DEEP_CATEGORY_ORDER, baseLabelOf } from '../lib/shader-param-naming.js'

export function initShaderLiveEditor(stateStore) {
	let overlay = null
	let selectedKey = null
	let shaderCfg = null // { id, name, common, passes } — working copy with live edits applied
	let dirty = false
	let params = []
	let pristine = null
	let pristineParams = null
	let unsub = null

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
				<span class="shader-live__dirty" id="shl-dirty" hidden>● live edits not saved</span>
				<button type="button" class="btn btn--secondary" id="shl-reset-all" title="Restore every parameter to the library values (recovery for a broken shader)">Reset all</button>
				<button type="button" class="btn" id="shl-save" disabled>Save to library</button>
				<button type="button" class="btn btn--secondary" id="shl-close" title="Back to looks">✕</button>
			</div>
			<div class="shader-live__params" id="shl-params"><p class="settings-note">No shader live — take a shader look to PGM or PRV.</p></div>`
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

	const instances = () => liveShaderInstances(stateStore)
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
		if (!list.some((i) => keyOf(i) === selectedKey)) selectedKey = keyOf(list[0])
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
		syncDirty()
		renderParams()
		pristineParams = params.map((p) => ({ values: [...p.values] }))
	}

	function scanCfg() {
		const out = []
		const push = (passKey, source) => {
			const named = scanShaderParams(source || '')
			for (const p of named) out.push({ ...p, passKey })
			// Owner 2026-07-27: auto-extracted body literals — no code interaction needed. Drop
			// any that overlap a named param's spans (const literals appear in both scans).
			const taken = named.flatMap((p) => p.spans)
			for (const d of scanShaderDeepParams(source || '')) {
				const hits = d.spans.some((ds) => taken.some((ts) => ds.start < ts.end && ts.start < ds.end))
				if (!hits) out.push({ ...d, passKey })
			}
		}
		push('common', shaderCfg?.common)
		for (const key of ['image', 'bufferA', 'bufferB', 'bufferC', 'bufferD']) {
			if (shaderCfg?.passes?.[key]?.source) push(key, shaderCfg.passes[key].source)
		}
		return out
	}


	function renderParams() {
		params = scanCfg()
		const host = overlay.querySelector('#shl-params')
		const row = (p, idx) => paramRowHtml(p, idx, shaderCfg?.paramLabels?.[labelKeyOf(p)])
		const namedHtml = params.map((p, i) => (p.deep ? '' : row(p, i))).join('')
		/* todos27: deep params render as human-named rows grouped into CATEGORIES (Colors,
		 * Speed & time, …) instead of one bucket of code snippets. */
		const byCat = new Map()
		params.forEach((p, i) => {
			if (!p.deep) return
			const cat = p.category || 'Other values'
			if (!byCat.has(cat)) byCat.set(cat, [])
			byCat.get(cat).push({ p, i })
		})
		/* todos27: cluster same-base params ("freq", "freq #2") adjacently inside a category. */
		for (const items of byCat.values()) {
			items.sort((a, b) => {
				const ba = baseLabelOf(a.p.name)
				const bb = baseLabelOf(b.p.name)
				return ba < bb ? -1 : ba > bb ? 1 : a.i - b.i
			})
		}
		const order = [...DEEP_CATEGORY_ORDER, ...[...byCat.keys()].filter((c) => !DEEP_CATEGORY_ORDER.includes(c))]
		const deepHtml = order
			.filter((c) => byCat.has(c))
			.map((c) => groupHtml(c, byCat.get(c).map(({ p, i }) => row(p, i)).join('')))
			.join('')
		host.innerHTML =
			groupHtml('Layer (Caspar mixer)', mixerRowsHtml()) +
			groupHtml('Shader parameters', namedHtml) +
			deepHtml +
			(!namedHtml && !deepHtml
				? '<p class="settings-note">Nothing tweakable found in this shader source.</p>'
				: '')
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
		try {
			await api.post('/api/shaders', shaderCfg)
		} catch (err) {
			console.warn('[shader-live] label save failed:', err?.message || err)
		}
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
		params = scanCfg()
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
			if (renderInstanceList()) void loadSelected()
			unsub = stateStore.on?.('*', () => onLiveChanged()) || null
		}
	}

	/* todos27: templates-browser shader rows dispatch this on click. Only ACT while shaders
	 * mode is open — outside it the event fizzles and the browser behaves as before. Stages an
	 * ephemeral one-layer look on the active main's preview bus via the normal take pipeline,
	 * so scene.live updates and the instance dropdown picks it up. */
	document.addEventListener('shader-audition-request', (e) => {
		if (!overlay || overlay.hidden) return
		const id = String(e?.detail?.id || '')
		const label = String(e?.detail?.label || id)
		if (!id) return
		void (async () => {
			try {
				const cm = stateStore.getState()?.channelMap || {}
				const mIdx = Math.max(0, Number(sceneState.activeScreenIndex) || 0)
				const programCh = cm.programChannels?.[mIdx]
				if (!programCh) throw new Error('no program channel for the active main')
				const incomingScene = {
					id: `shader-audition-${mIdx}`,
					name: `Audition ${label}`,
					layers: [
						{ layerNumber: 10, source: { type: 'template', value: id }, opacity: 1, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } },
					],
				}
				await api.post('/api/scene/take', { channel: programCh, target: 'preview', forceCut: true, useServerLive: true, incomingScene })
				const sid = (id.toLowerCase().match(/sh-[a-z0-9-]+$/) || [])[0]
				const prvCh = cm.previewChannels?.[mIdx]
				if (sid && prvCh) selectedKey = `${sid}@${prvCh}-10`
				window.showToast?.(`${label} → preview`, 'info')
			} catch (err) {
				window.showToast?.(`Audition failed: ${err?.message || err}`, 'error')
			}
		})()
	})

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
