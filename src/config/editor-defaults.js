'use strict'

const START_BEHAVIOURS = new Set(['beginning', 'relativeToPrevious'])
const COORDINATE_ORIGINS = new Set(['topLeft', 'center'])
const CONTENT_FITS = new Set(['native', 'stretch'])

function editorDefaultsDefaults() {
	return {
		coordinateOrigin: 'topLeft',
		scene: {
			loop: false,
			startBehaviour: 'beginning',
			contentFit: 'native',
		},
		timeline: {
			loopAlways: false,
			contentFit: 'native',
		},
		transition: {
			type: 'MIX',
			duration: 12,
			tween: 'linear',
		},
	}
}

/**
 * @param {unknown} v
 * @returns {'beginning' | 'relativeToPrevious'}
 */
function normalizeStartBehaviour(v) {
	return START_BEHAVIOURS.has(v) ? v : 'beginning'
}

/**
 * Merge persisted editor defaults; preserve unknown top-level keys from existing config.
 * @param {object} [input] from POST body
 * @param {object} [existing] current cfg.editorDefaults
 */
function normalizeEditorDefaults(input, existing) {
	const def = editorDefaultsDefaults()
	const base = { ...def, ...(existing && typeof existing === 'object' ? existing : {}) }
	const src = { ...base, ...(input && typeof input === 'object' ? input : {}) }
	const out = { ...src }

	const origin = String(src.coordinateOrigin || def.coordinateOrigin).trim()
	out.coordinateOrigin = COORDINATE_ORIGINS.has(origin) ? origin : def.coordinateOrigin

	const sceneIn = src.scene && typeof src.scene === 'object' ? src.scene : {}
	out.scene = {
		...def.scene,
		...(base.scene && typeof base.scene === 'object' ? base.scene : {}),
		...sceneIn,
	}
	out.scene.loop = !!out.scene.loop
	out.scene.startBehaviour = normalizeStartBehaviour(out.scene.startBehaviour)
	const sceneFit = String(out.scene.contentFit || def.scene.contentFit).trim()
	out.scene.contentFit = CONTENT_FITS.has(sceneFit) ? sceneFit : def.scene.contentFit

	const tlIn = src.timeline && typeof src.timeline === 'object' ? src.timeline : {}
	out.timeline = {
		...def.timeline,
		...(base.timeline && typeof base.timeline === 'object' ? base.timeline : {}),
		...tlIn,
	}
	out.timeline.loopAlways = !!out.timeline.loopAlways
	const tlFit = String(out.timeline.contentFit || def.timeline.contentFit).trim()
	out.timeline.contentFit = CONTENT_FITS.has(tlFit) ? tlFit : def.timeline.contentFit

	const trIn = src.transition && typeof src.transition === 'object' ? src.transition : {}
	out.transition = {
		...def.transition,
		...(base.transition && typeof base.transition === 'object' ? base.transition : {}),
		...trIn,
	}
	if (out.transition.type != null) out.transition.type = String(out.transition.type).trim() || def.transition.type
	const dur = parseInt(String(out.transition.duration ?? def.transition.duration), 10)
	out.transition.duration = Number.isFinite(dur) ? Math.max(0, dur) : def.transition.duration
	if (out.transition.tween != null) out.transition.tween = String(out.transition.tween).trim() || def.transition.tween

	return out
}

module.exports = {
	editorDefaultsDefaults,
	normalizeEditorDefaults,
	normalizeStartBehaviour,
}
