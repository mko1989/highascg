/**
 * Editor defaults schema (no settings-state import — breaks cycles with settings-state.js).
 */
import { SCENE_CONTENT_FIT_OPTIONS, SCENE_CONTENT_FIT_VALUES } from './scene-content-fit.js'

export const DEFAULT_EDITOR_DEFAULTS = {
	coordinateOrigin: 'topLeft',
	scene: {
		loop: false,
		startBehaviour: 'beginning',
		contentFit: 'native',
	},
	timeline: {
		loopAlways: false,
		startBehaviour: 'beginning',
		contentFit: 'native',
	},
	transition: {
		type: 'MIX',
		duration: 12,
		tween: 'linear',
	},
}

/**
 * @param {unknown} partial
 * @returns {typeof DEFAULT_EDITOR_DEFAULTS}
 */
export function mergeEditorDefaults(partial) {
	const p = partial && typeof partial === 'object' ? partial : {}
	const scene = p.scene && typeof p.scene === 'object' ? p.scene : {}
	const timeline = p.timeline && typeof p.timeline === 'object' ? p.timeline : {}
	const transition = p.transition && typeof p.transition === 'object' ? p.transition : {}
	const coord = p.coordinateOrigin === 'center' ? 'center' : 'topLeft'
	const startScene =
		scene.startBehaviour === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning'
	const startTl =
		timeline.startBehaviour === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning'
	const fitScene = SCENE_CONTENT_FIT_VALUES.has(scene.contentFit) ? scene.contentFit : 'native'
	const fitTl = SCENE_CONTENT_FIT_VALUES.has(timeline.contentFit) ? timeline.contentFit : 'native'
	return {
		coordinateOrigin: coord,
		scene: {
			loop: !!scene.loop,
			startBehaviour: startScene,
			contentFit: fitScene,
		},
		timeline: {
			loopAlways: !!timeline.loopAlways,
			startBehaviour: startTl,
			contentFit: fitTl,
		},
		transition: {
			type: String(transition.type || DEFAULT_EDITOR_DEFAULTS.transition.type),
			duration: Math.max(
				0,
				Math.round(Number(transition.duration) || DEFAULT_EDITOR_DEFAULTS.transition.duration),
			),
			tween: String(transition.tween || DEFAULT_EDITOR_DEFAULTS.transition.tween),
		},
	}
}

export function contentFitOptionsHtml(selected) {
	return SCENE_CONTENT_FIT_OPTIONS.map(
		(o) => `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`,
	).join('')
}
