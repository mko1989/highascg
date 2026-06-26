/**
 * Multiview editor canvas — geometry, drawing, and Caspar apply helpers.
 * Implementation split across `multiview-editor-canvas-*.js`; import from this barrel for a stable API.
 */

export {
	fitInContainer,
	toCanvas,
	getCellOuterRect,
	getCellAt,
	cursorForResizeHandle,
	getResizeHandle,
} from './multiview-editor-canvas-interaction.js'

export {
	getCellOverlayType,
	getContainedVideoRect,
	resolveSourceAspectRatio,
	solveCellDimensions,
} from './multiview-editor-canvas-layout.js'

export { drawMultiviewEditor } from './multiview-editor-canvas-draw.js'

export { applyMultiviewAudioFocus, applyMultiviewLayout } from './multiview-editor-canvas-apply.js'
