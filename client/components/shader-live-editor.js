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

const SHADER_VALUE_RE = /(^|\/)shaders\/(sh-[a-z0-9-]+)/i

function liveShaderInstances(stateStore) {
	const st = stateStore.getState() || {}
	const live = st.scene?.live || st['scene.live'] || {}
	const banks = st.scene?.programLayerBankByChannel || {}
	const cm = st.channelMap || {}
	const prvSet = new Set((cm.previewChannels || []).map(Number))
	const out = []
	for (const chKey of Object.keys(live)) {
		const scene = live[chKey]?.scene
		if (!scene || !Array.isArray(scene.layers)) continue
		for (const layer of scene.layers) {
			const m = SHADER_VALUE_RE.exec(String(layer?.source?.value || ''))
			if (!m) continue
			const ch = parseInt(chKey, 10)
			const logical = Number(layer.layerNumber)
			const bank = prvSet.has(ch) ? 'a' : String(banks[chKey] || 'a')
			const pLayer = bank === 'b' ? logical + 100 : logical
			out.push({
				shaderId: m[2].toLowerCase(),
				/* Full template path for the CG ADD re-host fallback (same string the engine plays). */
				cgName: String(layer.source.value).trim().toLowerCase(),
				channel: ch,
				pLayer,
				isPrv: prvSet.has(ch),
				sceneName: scene.name || scene.id,
			})
		}
	}
	// PGM instances first so auto-select lands on air.
	out.sort((a, b) => Number(a.isPrv) - Number(b.isPrv) || a.channel - b.channel)
	return out
}

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
		overlay.querySelector('#shl-reset-all').addEventListener('click', () => void resetAll())
		overlay.querySelector('#shl-params').addEventListener('click', onParamReset)
		overlay.querySelector('#shl-params').addEventListener('click', (e) => void onParamRename(e))
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
			passes: Object.fromEntries(
				Object.entries(shaderCfg?.passes || {}).map(([k, v]) => [k, v ? { source: v.source } : null]),
			),
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

	function toHex(v) {
		const c = (x) => Math.max(0, Math.min(255, Math.round((Number(x) || 0) * 255))).toString(16).padStart(2, '0')
		return `#${c(v[0])}${c(v[1])}${c(v[2])}`
	}

	/* Universal Caspar-mixer rides — available for EVERY shader (no GLSL literals needed). */
	const MIXER_ROWS = [
		{ cmd: 'OPACITY', label: 'opacity', min: 0, max: 1, step: 0.01, def: 1 },
		{ cmd: 'BRIGHTNESS', label: 'brightness', min: 0, max: 3, step: 0.01, def: 1 },
		{ cmd: 'SATURATION', label: 'saturation', min: 0, max: 3, step: 0.01, def: 1 },
		{ cmd: 'CONTRAST', label: 'contrast', min: 0, max: 3, step: 0.01, def: 1 },
	]
	function mixerRowsHtml() {
		return (
			'<div class="shader-live__section">Layer (Caspar mixer)</div>' +
			MIXER_ROWS.map(
				(r, i) => `<div class="shader-live__param"><span class="shader-live__pname">${r.label}</span>
					<input type="range" data-mixer="${i}" min="${r.min}" max="${r.max}" step="${r.step}" value="${r.def}">
					<input type="number" data-mixer="${i}" data-num min="${r.min}" max="${r.max}" step="${r.step}" value="${r.def}"></div>`,
			).join('')
		)
	}

	function renderParams() {
		params = scanCfg()
		const host = overlay.querySelector('#shl-params')
		const row = (p, idx) => paramRowHtml(p, idx)
		const namedHtml = params.map((p, i) => (p.deep ? '' : row(p, i))).join('')
		const deepHtml = params.map((p, i) => (p.deep ? row(p, i) : '')).join('')
		host.innerHTML =
			mixerRowsHtml() +
			(namedHtml ? '<div class="shader-live__section">Shader parameters</div>' + namedHtml : '') +
			(deepHtml ? '<div class="shader-live__section">Auto — from the code (each ◆ is that value)</div>' + deepHtml : '') +
			(!namedHtml && !deepHtml
				? '<p class="settings-note">Nothing tweakable found in this shader source.</p>'
				: '')
	}

	/* todos27: stable identity for operator-given labels (survives reloads; deep keys embed the
	 * ordinal + code context so they follow the same literal until the source itself changes). */
	function labelKeyOf(p) {
		return `${p.passKey}:${p.deep ? 'deep:' : ''}${p.name}`
	}

	function paramRowHtml(p, idx) {
		const cls = p.deep ? 'shader-live__param shader-live__param--deep' : 'shader-live__param'
		const custom = shaderCfg?.paramLabels?.[labelKeyOf(p)]
		/* Tooltip = the decode: pass + the raw name (deep names carry the ◆ code context). */
		const tip = `${p.passKey} — ${p.name}`
		const name = `<button type="button" class="shader-live__reset" data-reset="${idx}" title="Revert to the library value">↺</button><button type="button" class="shader-live__rename" data-rename="${idx}" title="Name this parameter (saved to the shader library)">✎</button><span class="shader-live__pname${custom ? ' shader-live__pname--custom' : ''}" title="${escapeHtml(tip)}">${escapeHtml(custom || p.name)}</span>`
		if (p.kind === 'color') {
			const alpha = p.vec === 4 ? `<input type="range" data-p="${idx}" data-c="3" min="0" max="1" step="0.01" value="${p.values[3]}">` : ''
			return `<div class="${cls}">${name}<input type="color" data-p="${idx}" data-color value="${toHex(p.values)}">${alpha}</div>`
		}
		const sliders = p.values
			.map(
				(v, ci) => `<input type="range" data-p="${idx}" data-c="${ci}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">
				<input type="number" data-p="${idx}" data-c="${ci}" data-num min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">`,
			)
			.join('')
		return `<div class="${cls}">${name}${sliders}</div>`
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
		/* AMCP quoted-string escaping: BACKSLASHES FIRST, then quotes — multi-line GLSL serializes
		 * with \n escapes, and without doubling them Caspar unescapes \n to a REAL newline inside a
		 * JSON string literal = invalid JSON = silent no-op (the owner's 'live edits do not work').*/
		const json = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
		const targets = instances().filter((i) => i.shaderId === inst.shaderId)
		for (const t of targets) {
			try {
				/* /api/raw answers HTTP 200 even when Caspar refuses — the error rides the body. */
				const r = await api.post('/api/raw', { cmd: `CG ${t.channel}-${t.pLayer} UPDATE 0 "${json}"` })
				if (!r?.error) continue
				/* todos27: playlist hops with a MIX transition PLAY plain html producers (that is
				 * what makes shader-to-shader mixing work) — CG UPDATE 403s on those. Re-host via
				 * CG ADD once (one visible restart, only at edit time) and retry. */
				if (/403/.test(String(r.error)) && t.cgName) {
					await api.post('/api/raw', { cmd: `CG ${t.channel}-${t.pLayer} ADD 0 "${t.cgName}" 1 "{}"` })
					const r2 = await api.post('/api/raw', { cmd: `CG ${t.channel}-${t.pLayer} UPDATE 0 "${json}"` })
					if (r2?.error) console.warn('[shader-live] re-host retry failed:', r2.error)
				} else {
					console.warn('[shader-live] CG UPDATE failed:', r.error)
				}
			} catch (e) {
				console.warn('[shader-live] CG UPDATE failed:', e?.message || e)
			}
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

	async function saveToLibrary() {
		if (!shaderCfg) return
		try {
			const r = await api.post('/api/shaders', shaderCfg)
			if (!r?.ok) throw new Error(r?.error || 'save failed')
			dirty = false
			syncDirty()
		} catch (e) {
			console.warn('[shader-live] save failed:', e?.message || e)
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
