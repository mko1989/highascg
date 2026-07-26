/**
 * WO-339 — editing chrome ON the PRV channel: while a look is being edited (and NOT edit-on-PGM),
 * every layer gets an outline + label rendered by template/edit_chrome.html on EDIT_CHROME_LAYER,
 * riding the same deferred AMCP batch as the look push — zero extra round-trips. The chrome is
 * never part of the saved look; it clears on editor exit, on any non-edit push that reuses the
 * bus, and in the server's boot restage sweep (src/config/routing-setup.js).
 */

import { postAmcpPreviewPipeline } from './amcp-preview-batch.js'

/** Mirror of src/engine/look-layer-ranges.js EDIT_CHROME_LAYER (WO-339 band 980–995). */
export const EDIT_CHROME_LAYER = 990

/** PRV channels that currently have chrome CG'd (so a later non-edit push knows to clear). */
const _chromeLive = new Set()

/* Selection comes from scenes-editor's `scene-layer-select` window event (detail.layerIndex is
 * the index into scene.layers). Tracked module-side so the push path needs no plumbing; the
 * highlight refreshes on the next push (every drag/inspector edit triggers one). */
let _selectedLayerIndex = null
if (typeof window !== 'undefined') {
	window.addEventListener('scene-layer-select', (e) => {
		_selectedLayerIndex = e?.detail?.layerIndex ?? null
	})
}

function chromePayload(scene, computedFills) {
	const layers = Array.isArray(scene?.layers) ? scene.layers : []
	const rects = []
	layers.forEach((layer, idx) => {
		if (!layer || !layer.source?.value) return
		const f = computedFills.get(Number(layer.layerNumber))
		if (!f) return
		const label = `L${layer.layerNumber} ${shortSourceLabel(layer)}`
		rects.push({
			x: round4(f.x),
			y: round4(f.y),
			w: round4(f.scaleX),
			h: round4(f.scaleY),
			rot: layer.rotation ? Number(layer.rotation) : 0,
			label,
			sel: _selectedLayerIndex != null && idx === _selectedLayerIndex,
		})
	})
	return JSON.stringify({ rects })
}

function round4(n) {
	return Math.round((Number(n) || 0) * 10000) / 10000
}

function shortSourceLabel(layer) {
	const v = String(layer.source?.value || '')
	const base = v.split('/').pop().split('?')[0]
	return base.length > 22 ? `${base.slice(0, 20)}…` : base
}

/**
 * AMCP lines for the current push. When `active`, ADDs (first time on this channel) or UPDATEs
 * the chrome; when inactive, emits clear lines only if this channel still has chrome up.
 * All lines are safe inside the deferred batch (CG commands are not DEFER-gated).
 * @param {{ active: boolean, previewCh: number, scene?: object, computedFills?: Map<number, object> }} opts
 * @returns {string[]}
 */
export function editChromeLinesForPush({ active, previewCh, scene, computedFills }) {
	const ch = Number(previewCh)
	if (!Number.isFinite(ch) || ch <= 0) return []
	const cl = `${ch}-${EDIT_CHROME_LAYER}`
	if (!active) {
		if (!_chromeLive.has(ch)) return []
		_chromeLive.delete(ch)
		return [`CG ${cl} CLEAR`, `MIXER ${cl} CLEAR`]
	}
	const data = chromePayload(scene, computedFills).replace(/"/g, '\\"')
	if (_chromeLive.has(ch)) {
		return [`CG ${cl} UPDATE 0 "${data}"`]
	}
	_chromeLive.add(ch)
	return [`CG ${cl} ADD 0 "edit_chrome" 1 "${data}"`, `CG ${cl} PLAY 0`]
}

/**
 * Clear chrome from every channel it is live on — editor exit / bus teardown. Fire-and-forget.
 * @returns {Promise<void>}
 */
export async function clearAllEditChrome() {
	if (!_chromeLive.size) return
	const lines = []
	for (const ch of _chromeLive) {
		lines.push(`CG ${ch}-${EDIT_CHROME_LAYER} CLEAR`, `MIXER ${ch}-${EDIT_CHROME_LAYER} CLEAR`)
	}
	_chromeLive.clear()
	try {
		await postAmcpPreviewPipeline(lines)
	} catch (e) {
		console.warn('Edit chrome clear failed:', e?.message || e)
	}
}
