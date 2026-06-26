/**
 * Collapsible output preview panel — program aspect ratio, layer rectangles, optional thumbnails.
 * Used by Timeline (clips at playhead) and scene editors via exported draw helpers.
 * @see working.md FEAT-4
 */

export {
	PREVIEW_LAYER_COLORS,
	findClipAtTime,
	lerpKeyframeProperty,
	getThumbnailEntry,
	drawSceneComposeStack,
	drawTimelineStack,
} from './preview-canvas-draw.js'
export { initPreviewPanel } from './preview-canvas-panel.js'
