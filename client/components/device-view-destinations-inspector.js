export {
	STANDARD_VIDEO_MODES,
	CASPAR_VIDEO_MODE_SPECS,
	casparVideoModeToOsModeAndRate,
	normalizeCasparVideoModeId,
	matchCasparVideoModeFromDimensions,
	casparVideoModeFromDetectedDisplay,
	resolveGpuInspectorVideoMode,
	edgeOutputLayer,
} from './device-view-destinations-inspector-modes.js'

export { renderDestinationInspector } from './device-view-destinations-inspector-form.js'
