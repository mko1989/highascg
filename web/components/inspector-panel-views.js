/**
 * Inspector panel view renderers (multiview / look shell). Layer + global border live in sibling modules.
 */
import { sceneState } from '../lib/scene-state.js'
import { multiviewState } from '../lib/multiview-state.js'
import { appendMultiviewPositionSize } from './inspector-fill.js'

export { getResolutionForScreen } from './inspector-channel-resolution.js'
export { renderSceneLayerInspector } from './inspector-scene-layer.js'
export { renderGlobalBorderInspector } from './inspector-global-border.js'

/**
 * @param {{
 *   root: HTMLElement,
 *   renderEmpty: () => void,
 * }} deps
 */
export function renderMultiviewInspector(deps, cellId) {
	const { root, renderEmpty, stateStore } = deps
	const cell = multiviewState.getCell(cellId)
	if (!cell) {
		renderEmpty()
		return
	}
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = cell.label || cell.id
	root.appendChild(title)
	appendMultiviewPositionSize(root, { cellId, cell, stateStore })
}

export function renderSceneInspector(root, sceneId) {
	const scene = sceneState.getScene(sceneId)
	if (!scene) {
		root.innerHTML = '<p class="inspector-empty">Select a scene</p>'
		return
	}
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Look: ${scene.name}`
	root.appendChild(title)
}
