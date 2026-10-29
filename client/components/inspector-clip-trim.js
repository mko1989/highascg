/**
 * WO-813 — the look layer's clip Trim in the web inspector, under "Clip start point" (owner 29.10). Twin of the Godot
 * godot/client/features/live/clip_trim_section.gd; the maths are lib/clip-trim-model.js (same rules as the Godot
 * clip_trim_model.gd). Collapsible and folded by default: "▸ Trim  Full clip" / "▸ Trim  0:00.06 – 0:09.09". Open
 * (compact): [Trim in] in ↺ [Trim out] out ↺ on one row, the slider and its timecode in one thin row below.
 *
 * Trim in / Trim out store the slider position as `trimInMs` / `trimOutMs` (WO-570 fields; the take seeks to the in
 * point and ends at the out point under either start option). Ctrl+click (Cmd+click on macOS) or the ↺ beside a point
 * resets it to the clip's start / end (null = no trim) — right-click does not work in a web GUI (owner 29.10); a
 * right-click is still taken where the browser delivers one. The fields take a typed m:ss.ff or seconds with + - * /
 * (RULES.md) and select their value on focus.
 *
 * The slider moves the look's PRV copy (POST /api/scene/layer-scrub: PRV only, PGM is never sought), one request in
 * flight and the newest position next — the same route and pacing as the Godot section.
 *
 * The inspector re-renders on every layer change, so the open state and the slider position live here per
 * look / layer / clip; showing another layer or clip folds the section again (nothing saved).
 */

import { api } from '../lib/api-client.js'
import { mediaDurationMs } from '../lib/media-duration.js'
import { resolveMainIndexForScene } from '../lib/look-stack-amcp-channel.js'
import * as T from '../lib/clip-trim-model.js'
import { showScenesToast } from './scenes-editor-support.js'

let _lastKey = ''
let _openKey = ''
let _sliderMs = 0
let _note = ''
/** @type {Map<string, number>} clip → durationMs from /api/media/cinf when the media scan has none */
const _cinfMs = new Map()

const normId = (v) =>
	String(v || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/\.[a-z0-9]{2,4}$/i, '')
		.toLowerCase()

/** The clip's own fps from the media list (a sub-1 fps is the CINF-maths tell, media-duration.js), else 25. */
function clipFps(stateStore, value) {
	const id = normId(value)
	const row = (stateStore?.getState?.()?.media || []).find((m) => normId(m?.id ?? m?.name) === id && Number(m?.fps) >= 1)
	return T.fpsOrDefault(row?.fps)
}

function el(tag, cls, text) {
	const n = document.createElement(tag)
	if (cls) n.className = cls
	if (text != null) n.textContent = text
	return n
}

/**
 * @param {HTMLElement} parent - the "Look take (playback)" group
 * @param {{ sceneId: string, layerIndex: number, layer: object, scene: object, sceneState: object, stateStore: object,
 *   isClip: boolean }} ctx - isClip: a single video clip (no template / route / still / playlist)
 */
export function appendClipTrimSection(parent, { sceneId, layerIndex, layer, scene, sceneState, stateStore, isClip }) {
	const value = String(layer?.source?.value || '')
	const key = `${sceneId}|${layer?.layerNumber ?? ''}|${value}`
	if (key !== _lastKey) {
		_lastKey = key
		_openKey = ''
		_sliderMs = T.inMs(layer)
		_note = ''
	}
	if (!isClip) return

	const fps = clipFps(stateStore, value)
	const durMs = () => mediaDurationMs(value) || _cinfMs.get(value) || 0
	const cur = () => sceneState.getScene(sceneId)?.layers?.[layerIndex] || layer
	const tc = (ms) => T.formatTc(ms / 1000, fps)

	const wrap = el('div', 'inspector-field inspector-clip-trim')
	const head = el('div', 'inspector-clip-trim__head')
	const toggle = el('button', 'inspector-clip-trim__toggle')
	toggle.type = 'button'
	toggle.title = 'Trim in / out of this clip'
	const summary = el('span', 'inspector-clip-trim__summary')
	head.append(toggle, summary)
	const body = el('div', 'inspector-clip-trim__body')
	const row = el('div', 'inspector-clip-trim__row')
	const slider = el('input', 'inspector-clip-trim__slider')
	slider.type = 'range'
	slider.min = '0'
	slider.title = 'Scrub the clip (moves it on PRV when this look is there)'
	slider.setAttribute('aria-label', 'Trim position')
	const pos = el('span', 'inspector-clip-trim__pos')
	const srow = el('div', 'inspector-clip-trim__srow')
	srow.append(slider, pos)
	body.append(row, srow)
	wrap.append(head, body)

	function apply(r) {
		if (!r.ok) {
			showScenesToast(r.error, 'warn')
			refresh()
			return
		}
		sceneState.patchLayer(sceneId, layerIndex, r.patch)
		refresh()
	}
	const trim = (isIn) =>
		apply(isIn ? T.setIn(cur(), _sliderMs, durMs(), fps) : T.setOut(cur(), _sliderMs, durMs(), fps))
	/** Ctrl+click on Trim in / out and the ↺ beside it land here (owner 29.10). */
	const reset = (isIn) => apply(isIn ? T.resetIn(cur(), fps) : T.resetOut(cur(), durMs(), fps))

	function pointButton(isIn) {
		const b = el('button', 'scenes-btn scenes-btn--sm', isIn ? 'Trim in' : 'Trim out')
		b.type = 'button'
		b.dataset.trimSet = isIn ? 'in' : 'out'
		b.title = `Set ${isIn ? 'In' : 'Out'} to the slider position\n${isIn ? T.RESET_TIP_IN : T.RESET_TIP_OUT}`
		b.addEventListener('click', (e) => (T.isResetClick(e) ? reset(isIn) : trim(isIn)))
		b.addEventListener('contextmenu', (e) => {
			e.preventDefault()
			reset(isIn)
		})
		return b
	}
	function resetButton(isIn) {
		const b = el('button', 'inspector-clip-trim__reset', '↺')
		b.type = 'button'
		b.dataset.trimReset = isIn ? 'in' : 'out'
		b.title = isIn ? T.RESET_TIP_IN : T.RESET_TIP_OUT
		b.setAttribute('aria-label', isIn ? "Reset In to the clip's start" : "Reset Out to the clip's end")
		b.addEventListener('click', () => reset(isIn))
		return b
	}
	function field(isIn) {
		const f = el('input', 'inspector-clip-trim__tc')
		f.type = 'text'
		f.spellcheck = false
		f.title = `${isIn ? 'In' : 'Out'} point — type m:ss.ff or seconds`
		f.addEventListener('focus', () => f.select()) // RULES.md: focus selects the value
		f.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') f.blur()
		})
		f.addEventListener('blur', () => {
			const d = durMs()
			const pt = T.points(cur(), d)
			const shown = isIn ? pt.in : pt.out
			if (d > 0 && f.value !== tc(shown)) {
				const ms = T.parseTc(f.value, fps)
				if (!Number.isNaN(ms)) return apply(isIn ? T.setIn(cur(), ms, d, fps) : T.setOut(cur(), ms, d, fps))
			}
			refresh() // garbage or unchanged: the stored point stays
		})
		return f
	}
	const inBtn = pointButton(true)
	const inEdit = field(true)
	const outBtn = pointButton(false)
	const outEdit = field(false)
	row.append(inBtn, inEdit, resetButton(true), outBtn, outEdit, resetButton(false))

	function refresh() {
		const open = _openKey === key
		toggle.textContent = `${open ? '▾' : '▸'} Trim`
		toggle.setAttribute('aria-expanded', String(open))
		body.hidden = !open
		summary.hidden = open
		const d = durMs()
		const known = d > 0
		const L = cur()
		summary.textContent = known ? T.summary(L, d, fps) : T.hasTrim(L) ? T.summary(L, 0, fps) : 'Clip length unknown'
		for (const n of [slider, inEdit, outEdit, inBtn, outBtn]) n.disabled = !known
		if (!known) {
			pos.textContent = '--:--.--'
			inEdit.value = ''
			outEdit.value = ''
			return
		}
		slider.max = String(d)
		slider.step = String(T.frameToMs(1, fps))
		slider.value = String(Math.min(d, _sliderMs))
		pos.textContent = tc(Number(slider.value))
		const pt = T.points(L, d)
		if (document.activeElement !== inEdit) inEdit.value = tc(pt.in)
		if (document.activeElement !== outEdit) outEdit.value = tc(pt.out)
	}

	toggle.addEventListener('click', () => {
		_openKey = _openKey === key ? '' : key
		refresh()
	})

	let busy = false
	let next = -1
	async function scrub(ms) {
		busy = true
		let note
		try {
			const mainIdx = resolveMainIndexForScene(scene, sceneState)
			const res = await api.post('/api/scene/layer-scrub', {
				sceneId,
				mainIdx,
				layerNumber: Number(layer.layerNumber) || 0,
				ms: Math.round(ms),
			})
			note = T.scrubNote(res)
		} catch (e) {
			note = `Scrub failed: ${e?.message || e}`
		}
		busy = false
		slider.title = note
		if (note !== _note) {
			_note = note
			showScenesToast(note, 'info')
		}
		if (next >= 0) {
			const n = next
			next = -1
			void scrub(n)
		}
	}
	slider.addEventListener('input', () => {
		_sliderMs = Number(slider.value) || 0
		pos.textContent = tc(_sliderMs)
		if (busy) next = _sliderMs
		else void scrub(_sliderMs)
	})

	parent.appendChild(wrap)
	refresh()
	if (!(durMs() > 0) && value) {
		api
			.post('/api/media/cinf', { id: value })
			.then((r) => {
				const ms = Number(r?.durationMs)
				if (ms > 0) _cinfMs.set(value, ms)
				if (document.body.contains(wrap)) refresh()
			})
			.catch(() => {})
	}
}
