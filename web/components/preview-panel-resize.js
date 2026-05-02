/**
 * Resizing logic for the preview panel.
 */

export function initPanelResizing(handle, body, { collapsed, onHeightChange, maxPanelBodyPx }) {
	handle.addEventListener('mousedown', (e) => {
		if (e.button !== 0 || collapsed()) return; e.preventDefault()
		const startY = e.clientY; const startH = body.offsetHeight
		const onMove = (ev) => {
			const nh = Math.max(80, Math.min(maxPanelBodyPx(), startH + ev.clientY - startY))
			body.style.height = `${nh}px`; onHeightChange()
		}
		const onUp = () => {
			document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
			document.body.style.cursor = ''; document.body.style.userSelect = ''
			localStorage.setItem('casparcg_preview_height', String(body.offsetHeight))
		}
		document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'
		document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
	})
}

export function initGutterResizing(gutter, pair, { collapsed, layout, onSplitChange }) {
	gutter.addEventListener('mousedown', (e) => {
		if (e.button !== 0 || collapsed()) return; e.preventDefault()
		const onMove = (ev) => {
			const r = pair.getBoundingClientRect()
			let next = (layout() === 'lr') ? (ev.clientX - r.left) / r.width : (r.bottom - ev.clientY) / r.height
			next = Math.max(0.15, Math.min(0.85, next)); onSplitChange(next)
		}
		const onUp = () => {
			document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
			document.body.style.cursor = ''; document.body.style.userSelect = ''
		}
		document.body.style.cursor = (layout() === 'lr') ? 'col-resize' : 'row-resize'
		document.body.style.userSelect = 'none'; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
	})
}
