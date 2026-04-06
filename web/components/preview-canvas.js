/**
 * Collapsible output preview panel — program aspect ratio, layer rectangles, optional thumbnails.
 * Used by Dashboard (active column stack) and Timeline (clips at playhead).
 * @see working.md FEAT-4
 */

export {
	PREVIEW_LAYER_COLORS,
	findClipAtTime,
	lerpKeyframeProperty,
	getThumbnailEntry,
	drawDashboardProgramStack,
	drawSceneComposeStack,
	drawTimelineStack,
} from './preview-canvas-draw.js'
export { initPreviewPanel } from './preview-canvas-panel.js'
