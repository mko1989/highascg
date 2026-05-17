/**
 * @file ui-selection.js
 * Map UI selection payload to Companion-style variables.
 */

'use strict'

/**
 * Set UI selection variables in state.
 * @param {object} ctx - App context containing `state` (StateManager)
 * @param {object} payload - Selection payload from UI or WS
 */
async function setUiSelection(ctx, payload) {
	if (!ctx.state || typeof ctx.state.setVariable !== 'function') return
	if (!payload || typeof payload !== 'object') return

	const state = ctx.state
	const context = payload.context || 'none'
	
	state.setVariable('ui_selection_context', context)
	state.setVariable('ui_selection_label', payload.label || '')

	if (context === 'scene_layer' && payload.scene) {
		const s = payload.scene
		state.setVariable('ui_selection_look_id', s.sceneId || '')
		state.setVariable('ui_selection_look_layer_index', s.layerIndex != null ? String(s.layerIndex) : '')
		state.setVariable('ui_selection_look_preview_channel', s.channel != null ? String(s.channel) : '')
		state.setVariable('ui_selection_look_caspar_layer', s.casparLayer != null ? String(s.casparLayer) : '')
		state.setVariable('ui_selection_look_screen_index', s.screenIdx != null ? String(s.screenIdx) : '')
		
		if (s.res) {
			state.setVariable('ui_selection_look_canvas_w', s.res.w != null ? String(s.res.w) : '')
			state.setVariable('ui_selection_look_canvas_h', s.res.h != null ? String(s.res.h) : '')
		}
		
		if (s.fill) {
			state.setVariable('ui_selection_look_fill_x', s.fill.x != null ? String(s.fill.x) : '')
			state.setVariable('ui_selection_look_fill_y', s.fill.y != null ? String(s.fill.y) : '')
			state.setVariable('ui_selection_look_fill_scale_x', s.fill.scaleX != null ? String(s.fill.scaleX) : '')
			state.setVariable('ui_selection_look_fill_scale_y', s.fill.scaleY != null ? String(s.fill.scaleY) : '')
		}
		
		state.setVariable('ui_selection_look_rotation', s.rotation != null ? String(s.rotation) : '0')
		state.setVariable('ui_selection_look_opacity', s.opacity != null ? String(s.opacity) : '1')
		
		if (s.source) {
			state.setVariable('ui_selection_look_source_type', s.source.type || '')
			state.setVariable('ui_selection_look_source_value', s.source.value || '')
			state.setVariable('ui_selection_look_source_label', s.source.label || '')
		}
		
		// Apply to CasparCG if requested and available
		if (ctx.amcp && s.channel && s.casparLayer && s.fill) {
			try {
				await ctx.amcp.mixer.mixerFill(s.channel, s.casparLayer, s.fill.x, s.fill.y, s.fill.scaleX, s.fill.scaleY)
			} catch (e) {
				if (typeof ctx.log === 'function') ctx.log('warn', `Failed to apply selection fill to Caspar: ${e.message || e}`)
			}
		}
	} else if (context === 'timeline_clip' && payload.timeline) {
		const t = payload.timeline
		state.setVariable('ui_selection_tl_timeline_id', t.timelineId || '')
		state.setVariable('ui_selection_tl_layer_idx', t.layerIdx != null ? String(t.layerIdx) : '')
		state.setVariable('ui_selection_tl_clip_id', t.clipId || '')
		state.setVariable('ui_selection_tl_aspect_locked', t.aspectLocked ? 'true' : 'false')
		
		if (t.pixelRect) {
			state.setVariable('ui_selection_tl_pixel_x', t.pixelRect.x != null ? String(t.pixelRect.x) : '')
			state.setVariable('ui_selection_tl_pixel_y', t.pixelRect.y != null ? String(t.pixelRect.y) : '')
			state.setVariable('ui_selection_tl_pixel_w', t.pixelRect.w != null ? String(t.pixelRect.w) : '')
			state.setVariable('ui_selection_tl_pixel_h', t.pixelRect.h != null ? String(t.pixelRect.h) : '')
		}
		
		state.setVariable('ui_selection_tl_fill_x', t.fill_x != null ? String(t.fill_x) : '')
		state.setVariable('ui_selection_tl_fill_y', t.fill_y != null ? String(t.fill_y) : '')
		state.setVariable('ui_selection_tl_scale_x', t.scale_x != null ? String(t.scale_x) : '')
		state.setVariable('ui_selection_tl_scale_y', t.scale_y != null ? String(t.scale_y) : '')
	} else if (context === 'multiview' && payload.multiview) {
		const m = payload.multiview
		state.setVariable('ui_selection_mv_cell_id', m.cellId || '')
		state.setVariable('ui_selection_mv_layer_index', m.layerIndex != null ? String(m.layerIndex) : '')
		state.setVariable('ui_selection_mv_channel', m.multiviewChannel != null ? String(m.multiviewChannel) : '')
		state.setVariable('ui_selection_mv_canvas_w', m.canvasW != null ? String(m.canvasW) : '')
		state.setVariable('ui_selection_mv_canvas_h', m.canvasH != null ? String(m.canvasH) : '')
		state.setVariable('ui_selection_mv_x', m.x != null ? String(m.x) : '')
		state.setVariable('ui_selection_mv_y', m.y != null ? String(m.y) : '')
		state.setVariable('ui_selection_mv_w', m.w != null ? String(m.w) : '')
		state.setVariable('ui_selection_mv_h', m.h != null ? String(m.h) : '')
		state.setVariable('ui_selection_mv_aspect_locked', m.aspectLocked ? 'true' : 'false')
	}
}

module.exports = { setUiSelection }
