/**
 * Timeline editor preview split — drag handle + persisted height.
 */

const TL_SPLIT_LS = 'casparcg_timeline_preview_split_px'

export function initTimelinePreviewSplit(previewHost) {
	const splitPx = { current: 220 }
	try {
		const n = parseInt(localStorage.getItem(TL_SPLIT_LS) || '', 10)
		if (!Number.isNaN(n) && n >= 120 && n <= 1200) splitPx.current = n
	} catch {
		/* ignore */
	}
	previewHost.style.flex = `0 0 ${splitPx.current}px`
	previewHost.style.minHeight = '0'
	return splitPx
}

export function bindTimelinePreviewSplitDrag(tlSplitHandle, previewHost, splitPx, getPreviewPanel) {
	if (!tlSplitHandle) return
	tlSplitHandle.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return
		e.preventDefault()
		const startY = e.clientY
		const startH = previewHost.getBoundingClientRect().height
		const onMove = (ev) => {
			const dy = ev.clientY - startY
			const nh = Math.max(120, Math.min(1000, startH + dy))
			previewHost.style.flex = `0 0 ${nh}px`
			getPreviewPanel()?.scheduleDraw?.()
		}
		const onUp = () => {
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
			const h = previewHost.getBoundingClientRect().height
			splitPx.current = Math.round(h)
			try {
				localStorage.setItem(TL_SPLIT_LS, String(splitPx.current))
			} catch {
				/* ignore */
			}
		}
		document.body.style.cursor = 'row-resize'
		document.body.style.userSelect = 'none'
		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	})
}
