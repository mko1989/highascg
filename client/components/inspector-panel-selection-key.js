export function inspectorSelectionKey(data) {
	if (!data) return ''
	switch (data.type) {
		case 'timelineClip':
			return `timelineClip:${data.timelineId}:${data.clipId}`
		case 'timelineLayer':
			return `timelineLayer:${data.timelineId}:${data.layerIdx}`
		case 'timelineFlag':
			return `timelineFlag:${data.timelineId}:${data.flagId}`
		case 'sceneLayer':
			return `sceneLayer:${data.sceneId}:${data.layerIndex}`
		case 'scene':
			return `scene:${data.sceneId}`
		case 'multiview':
			return `multiview:${data.cellId}`
		case 'globalBorder':
			return `globalBorder:${data.screenIndex}`
		case 'screenTimer':
			return `screenTimer:${data.screenIndex}`
		case 'liveAudioInput':
			return `liveAudioInput:${data.slot}`
		case 'webpageHost':
			return `webpageHost:${data.sourceId || data.value || data.hostChannel || ''}`
		case 'ndiHost':
			return `ndiHost:${data.sourceId || data.value || data.hostChannel || ''}`
		case 'v4l2Input':
			return `v4l2Input:${data.slot}`
		default:
			return String(data.type || '')
	}
}
