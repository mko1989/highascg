/**
 * Application editor defaults (Settings → Defaults). Applied when creating new layers/clips/looks.
 */
import { settingsState } from './settings-state.js'
import { defaultTransition } from './scene-state-helpers.js'
import {
	DEFAULT_EDITOR_DEFAULTS,
	mergeEditorDefaults,
	contentFitOptionsHtml,
} from './editor-defaults-constants.js'

export { DEFAULT_EDITOR_DEFAULTS, mergeEditorDefaults } from './editor-defaults-constants.js'

/** @typedef {'topLeft' | 'center'} CoordinateOrigin */

export function getEditorDefaults() {
	return mergeEditorDefaults(settingsState.getSettings()?.editorDefaults)
}

/** @returns {CoordinateOrigin} */
export function getCoordinateOrigin() {
	return getEditorDefaults().coordinateOrigin
}

export function getDefaultTransitionFromEditor() {
	const t = getEditorDefaults().transition
	return { ...defaultTransition(), ...t }
}

/**
 * @param {Record<string, unknown>} layer
 */
export function applySceneLayerDefaults(layer) {
	if (!layer || typeof layer !== 'object') return
	const s = getEditorDefaults().scene
	layer.loop = !!s.loop
	layer.startBehaviour = s.startBehaviour === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning'
	layer.contentFit = s.contentFit
}

/**
 * @param {Record<string, unknown>} clip
 */
export function applyTimelineClipDefaults(clip) {
	if (!clip || typeof clip !== 'object') return
	const t = getEditorDefaults().timeline
	if (t.loopAlways) {
		clip.loopAlways = true
		clip.loop = false
	} else {
		clip.loopAlways = false
		clip.loop = false
	}
	clip.startBehaviour = t.startBehaviour === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning'
	clip.contentFit = t.contentFit
}

/**
 * @param {import('./scene-state.js').SceneState} [sceneState]
 * @param {{ syncSceneGlobalTransition?: boolean }} [opts]
 */
export function applyEditorDefaultsToRuntime(sceneState, opts = {}) {
	if (opts.syncSceneGlobalTransition && sceneState?.setGlobalDefaultTransition) {
		sceneState.setGlobalDefaultTransition(getDefaultTransitionFromEditor())
	}
	document.dispatchEvent(
		new CustomEvent('highascg-editor-defaults-changed', { detail: getEditorDefaults() }),
	)
}

/**
 * @param {HTMLElement} modal
 * @returns {typeof DEFAULT_EDITOR_DEFAULTS}
 */
export function collectEditorDefaultsFromModal(modal) {
	const coord = modal.querySelector('#ed-coordinate-origin')?.value
	const sceneLoop = !!(modal.querySelector('#ed-scene-loop') || {}).checked
	const sceneStart = modal.querySelector('#ed-scene-start')?.value
	const sceneFit = modal.querySelector('#ed-scene-content-fit')?.value
	const tlLoop = !!(modal.querySelector('#ed-timeline-loop-always') || {}).checked
	const tlStart = modal.querySelector('#ed-timeline-start')?.value
	const tlFit = modal.querySelector('#ed-timeline-content-fit')?.value
	const trType = modal.querySelector('#ed-transition-type')?.value
	const trDur = modal.querySelector('#ed-transition-duration')?.value
	const trTween = modal.querySelector('#ed-transition-tween')?.value
	return mergeEditorDefaults({
		coordinateOrigin: coord,
		scene: {
			loop: sceneLoop,
			startBehaviour: sceneStart,
			contentFit: sceneFit,
		},
		timeline: {
			loopAlways: tlLoop,
			startBehaviour: tlStart,
			contentFit: tlFit,
		},
		transition: {
			type: trType,
			duration: trDur,
			tween: trTween,
		},
	})
}

/**
 * @param {HTMLElement} modal
 * @param {typeof DEFAULT_EDITOR_DEFAULTS} ed
 */
export function hydrateEditorDefaultsModal(modal, ed) {
	const d = mergeEditorDefaults(ed)
	const coordEl = modal.querySelector('#ed-coordinate-origin')
	if (coordEl) coordEl.value = d.coordinateOrigin
	const sceneLoopEl = modal.querySelector('#ed-scene-loop')
	if (sceneLoopEl) sceneLoopEl.checked = d.scene.loop
	const sceneStartEl = modal.querySelector('#ed-scene-start')
	if (sceneStartEl) sceneStartEl.value = d.scene.startBehaviour
	const sceneFitEl = modal.querySelector('#ed-scene-content-fit')
	if (sceneFitEl) sceneFitEl.innerHTML = contentFitOptionsHtml(d.scene.contentFit)
	const tlLoopEl = modal.querySelector('#ed-timeline-loop-always')
	if (tlLoopEl) tlLoopEl.checked = d.timeline.loopAlways
	const tlStartEl = modal.querySelector('#ed-timeline-start')
	if (tlStartEl) tlStartEl.value = d.timeline.startBehaviour
	const tlFitEl = modal.querySelector('#ed-timeline-content-fit')
	if (tlFitEl) tlFitEl.innerHTML = contentFitOptionsHtml(d.timeline.contentFit)
	const trTypeEl = modal.querySelector('#ed-transition-type')
	if (trTypeEl) trTypeEl.value = d.transition.type
	const trDurEl = modal.querySelector('#ed-transition-duration')
	if (trDurEl) trDurEl.value = String(d.transition.duration)
	const trTweenEl = modal.querySelector('#ed-transition-tween')
	if (trTweenEl) trTweenEl.value = d.transition.tween
}
