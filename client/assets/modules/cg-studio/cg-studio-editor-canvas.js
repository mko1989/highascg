/**
 * @param {import('grapesjs').Editor} editor
 * @param {HTMLElement} zoomLabel
 */
export function createCanvasController(editor, zoomLabel) {
	let zoomPct = 50

	function applyZoom(pct) {
		zoomPct = Math.max(10, Math.min(300, Math.round(pct)))
		editor.Canvas.setZoom(zoomPct)
		zoomLabel.textContent = `${zoomPct}%`
	}

	function fitCanvasZoom() {
		const canvasEl = editor.Canvas.getElement()
		if (!canvasEl) return
		const w = canvasEl.clientWidth
		const h = canvasEl.clientHeight
		if (w < 1 || h < 1) return
		const fit = Math.min((w * 0.92) / 1920, (h * 0.92) / 1080) * 100
		applyZoom(fit)
	}

	function handleWheel(ev) {
		ev.preventDefault()
		if (ev.ctrlKey || ev.metaKey) {
			const deltaFactor = 1 - ev.deltaY * 0.0005
			const factor = Math.max(0.85, Math.min(1.15, deltaFactor))
			applyZoom(zoomPct * factor)
		} else {
			const coords = editor.Canvas.getCoords()
			const scale = zoomPct / 100
			editor.Canvas.setCoords(coords.x - ev.deltaX / scale, coords.y - ev.deltaY / scale)
		}
	}

	/** @param {Document} doc */
	function bindIframeWheel(doc) {
		doc.addEventListener('wheel', handleWheel, { passive: false })
	}

	/** @param {HTMLElement} canvasWrap */
	function bindWrapWheel(canvasWrap) {
		canvasWrap.addEventListener('wheel', handleWheel, { passive: false })
	}

	return { applyZoom, fitCanvasZoom, bindIframeWheel, bindWrapWheel, getZoomPct: () => zoomPct }
}
