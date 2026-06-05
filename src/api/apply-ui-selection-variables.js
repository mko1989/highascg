/**
 * Maps POST /api/selection (and WS selection_sync) payloads into Companion-style string variables.
 * @see web/lib/selection-sync.js buildSelectionPayload
 */

'use strict'

/** @param {unknown} v */
function str(v) {
	if (v == null) return ''
	return String(v)
}

/** @param {unknown} o */
function jsonStr(o) {
	if (o == null || o === '') return ''
	try {
		return JSON.stringify(o)
	} catch {
		return ''
	}
}

/**
 * Every variable key this module owns — cleared before applying a new payload so stale values disappear.
 */
const ALL_UI_SELECTION_KEYS = [
	'ui_selection_context',
	'ui_selection_label',

	'ui_selection_look_id',
	'ui_selection_look_name',
	'ui_selection_look_layer_index',
	'ui_selection_look_layer_number',
	'ui_selection_look_preview_channel',
	'ui_selection_look_caspar_layer',
	'ui_selection_look_screen_index',
	'ui_selection_look_canvas_w',
	'ui_selection_look_canvas_h',
	'ui_selection_look_fill_x',
	'ui_selection_look_fill_y',
	'ui_selection_look_fill_scale_x',
	'ui_selection_look_fill_scale_y',
	'ui_selection_look_rotation',
	'ui_selection_look_opacity',
	'ui_selection_look_source_type',
	'ui_selection_look_source_value',
	'ui_selection_look_source_label',
	'ui_selection_look_loop',
	'ui_selection_look_audio_route',
	'ui_selection_look_volume',
	'ui_selection_look_muted',
	'ui_selection_look_straight_alpha',
	'ui_selection_look_content_fit',
	'ui_selection_look_aspect_locked',
	'ui_selection_look_transition_json',
	'ui_selection_look_fade_on_end_json',
	'ui_selection_look_effects_json',
	'ui_selection_look_pip_overlays_json',
	'ui_selection_look_start_behaviour',
	'ui_selection_look_layer_json',

	'ui_selection_tl_timeline_id',
	'ui_selection_tl_layer_idx',
	'ui_selection_tl_clip_id',
	'ui_selection_tl_aspect_locked',
	'ui_selection_tl_pixel_x',
	'ui_selection_tl_pixel_y',
	'ui_selection_tl_pixel_w',
	'ui_selection_tl_pixel_h',
	'ui_selection_tl_fill_x',
	'ui_selection_tl_fill_y',
	'ui_selection_tl_scale_x',
	'ui_selection_tl_scale_y',

	'ui_selection_mv_cell_id',
	'ui_selection_mv_layer_index',
	'ui_selection_mv_channel',
	'ui_selection_mv_canvas_w',
	'ui_selection_mv_canvas_h',
	'ui_selection_mv_x',
	'ui_selection_mv_y',
	'ui_selection_mv_w',
	'ui_selection_mv_h',
	'ui_selection_mv_aspect_locked',
]

/**
 * @param {import('../state/state-manager').StateManager} state
 */
function clearAllUiSelectionKeys(state) {
	for (const k of ALL_UI_SELECTION_KEYS) {
		state.setVariable(k, '')
	}
}

/**
 * @param {import('../state/state-manager').StateManager} state
 * @param {Record<string, unknown>} payload
 */
function applyUiSelectionPayloadToVariables(state, payload) {
	const ctx = str(payload?.context) || 'none'
	clearAllUiSelectionKeys(state)

	state.setVariable('ui_selection_context', ctx)
	state.setVariable('ui_selection_label', str(payload?.label))

	if (ctx === 'scene_layer') {
		const scene = payload.scene && typeof payload.scene === 'object' ? payload.scene : {}
		const snap =
			payload.layerSnapshot && typeof payload.layerSnapshot === 'object'
				? payload.layerSnapshot
				: null

		const fill = scene.fill && typeof scene.fill === 'object' ? scene.fill : {}
		const src = scene.source && typeof scene.source === 'object' ? scene.source : snap?.source
		const res = scene.res && typeof scene.res === 'object' ? scene.res : {}

		state.setVariable('ui_selection_look_id', str(scene.sceneId))
		state.setVariable('ui_selection_look_name', str(scene.sceneName))
		state.setVariable('ui_selection_look_layer_index', str(scene.layerIndex))
		state.setVariable(
			'ui_selection_look_layer_number',
			str(snap?.layerNumber != null ? snap.layerNumber : scene.casparLayer),
		)
		state.setVariable('ui_selection_look_preview_channel', str(scene.channel))
		state.setVariable('ui_selection_look_caspar_layer', str(scene.casparLayer))
		state.setVariable('ui_selection_look_screen_index', str(scene.screenIdx))
		state.setVariable('ui_selection_look_canvas_w', str(res.w))
		state.setVariable('ui_selection_look_canvas_h', str(res.h))
		state.setVariable('ui_selection_look_fill_x', str(fill.x))
		state.setVariable('ui_selection_look_fill_y', str(fill.y))
		state.setVariable('ui_selection_look_fill_scale_x', str(fill.scaleX))
		state.setVariable('ui_selection_look_fill_scale_y', str(fill.scaleY))
		state.setVariable('ui_selection_look_rotation', str(scene.rotation))
		state.setVariable('ui_selection_look_opacity', str(scene.opacity))

		state.setVariable('ui_selection_look_source_type', str(src?.type))
		state.setVariable('ui_selection_look_source_value', str(src?.value))
		state.setVariable('ui_selection_look_source_label', str(src?.label))

		if (snap && typeof snap === 'object') {
			state.setVariable('ui_selection_look_loop', snap.loop === true ? 'true' : snap.loop === false ? 'false' : '')
			state.setVariable('ui_selection_look_audio_route', str(snap.audioRoute))
			state.setVariable('ui_selection_look_volume', str(snap.volume))
			state.setVariable('ui_selection_look_muted', snap.muted === true ? 'true' : snap.muted === false ? 'false' : '')
			state.setVariable(
				'ui_selection_look_straight_alpha',
				snap.straightAlpha === true ? 'true' : snap.straightAlpha === false ? 'false' : '',
			)
			state.setVariable('ui_selection_look_content_fit', str(snap.contentFit))
			state.setVariable(
				'ui_selection_look_aspect_locked',
				snap.aspectLocked === true ? 'true' : snap.aspectLocked === false ? 'false' : '',
			)
			state.setVariable('ui_selection_look_transition_json', jsonStr(snap.transition))
			state.setVariable('ui_selection_look_fade_on_end_json', jsonStr(snap.fadeOnEnd))
			state.setVariable('ui_selection_look_effects_json', jsonStr(snap.effects))
			state.setVariable('ui_selection_look_pip_overlays_json', jsonStr(snap.pipOverlays))
			state.setVariable('ui_selection_look_start_behaviour', str(snap.startBehaviour))
			state.setVariable('ui_selection_look_layer_json', jsonStr(snap))
		}
		return
	}

	if (ctx === 'timeline_clip') {
		const t = payload.timeline && typeof payload.timeline === 'object' ? payload.timeline : {}
		const px = t.pixelRect && typeof t.pixelRect === 'object' ? t.pixelRect : {}

		state.setVariable('ui_selection_tl_timeline_id', str(t.timelineId))
		state.setVariable('ui_selection_tl_layer_idx', str(t.layerIdx))
		state.setVariable('ui_selection_tl_clip_id', str(t.clipId))
		state.setVariable(
			'ui_selection_tl_aspect_locked',
			t.aspectLocked === true ? 'true' : t.aspectLocked === false ? 'false' : '',
		)
		state.setVariable('ui_selection_tl_pixel_x', str(px.x))
		state.setVariable('ui_selection_tl_pixel_y', str(px.y))
		state.setVariable('ui_selection_tl_pixel_w', str(px.w))
		state.setVariable('ui_selection_tl_pixel_h', str(px.h))
		state.setVariable('ui_selection_tl_fill_x', str(t.fill_x))
		state.setVariable('ui_selection_tl_fill_y', str(t.fill_y))
		state.setVariable('ui_selection_tl_scale_x', str(t.scale_x))
		state.setVariable('ui_selection_tl_scale_y', str(t.scale_y))
		return
	}

	if (ctx === 'multiview') {
		const m = payload.multiview && typeof payload.multiview === 'object' ? payload.multiview : {}

		state.setVariable('ui_selection_mv_cell_id', str(m.cellId))
		state.setVariable('ui_selection_mv_layer_index', str(m.layerIndex))
		state.setVariable('ui_selection_mv_channel', str(m.multiviewChannel))
		state.setVariable('ui_selection_mv_canvas_w', str(m.canvasW))
		state.setVariable('ui_selection_mv_canvas_h', str(m.canvasH))
		state.setVariable('ui_selection_mv_x', str(m.x))
		state.setVariable('ui_selection_mv_y', str(m.y))
		state.setVariable('ui_selection_mv_w', str(m.w))
		state.setVariable('ui_selection_mv_h', str(m.h))
		state.setVariable(
			'ui_selection_mv_aspect_locked',
			m.aspectLocked === true ? 'true' : m.aspectLocked === false ? 'false' : '',
		)
	}
}

module.exports = {
	ALL_UI_SELECTION_KEYS,
	applyUiSelectionPayloadToVariables,
}
