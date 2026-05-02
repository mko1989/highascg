/**
 * Multiview canvas sync logic.
 */
export function syncMultiviewCanvasFromChannelMap(cm, multiviewState) {
	if (!cm) return
	const by = cm.channelResolutionsByChannel || {}; const mvCh = cm.multiviewCh
	let w = 0, h = 0
	if (mvCh != null && by[mvCh]) { w = by[mvCh].w; h = by[mvCh].h }
	else if (cm.programResolutions?.[0]) { w = cm.programResolutions[0].w; h = cm.programResolutions[0].h }
	if (w > 0 && h > 0 && (multiviewState.canvasWidth !== w || multiviewState.canvasHeight !== h)) {
		multiviewState.setCanvasSize(w, h)
	}
}

let mvLayoutRefreshTimer = null
export function scheduleMultiviewLayoutRefresh() {
	clearTimeout(mvLayoutRefreshTimer)
	mvLayoutRefreshTimer = setTimeout(() => {
		mvLayoutRefreshTimer = null
		document.dispatchEvent(new CustomEvent('mv-layout-refresh'))
	}, 120)
}
