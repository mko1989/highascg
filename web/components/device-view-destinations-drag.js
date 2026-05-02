export function wireDestinationDrag(args) {
	const {
		vb,
		visual,
		destinationId,
		layoutCache,
		persistDestinationLayout,
		requestCableOverlayRender,
	} = args
	let drag = null
	const getContentPoint = (ev) => {
		const vr = visual.getBoundingClientRect()
		return {
			x: ev.clientX - vr.left + visual.scrollLeft,
			y: ev.clientY - vr.top + visual.scrollTop,
		}
	}
	const startDrag = (ev, resize) => {
		if (ev.button !== 0) return
		const p = getContentPoint(ev)
		const base = {
			left: Math.round(parseFloat(vb.style.left || '0') || vb.offsetLeft),
			top: Math.round(parseFloat(vb.style.top || '0') || vb.offsetTop),
			w: vb.offsetWidth,
			h: vb.offsetHeight,
			clientX: ev.clientX,
			clientY: ev.clientY,
		}
		const ar = base.w > 0 && base.h > 0 ? (base.w / base.h) : (16 / 9)
		drag = { id: destinationId, resize, pointerId: ev.pointerId, base, ar, grabX: p.x - base.left, grabY: p.y - base.top }
		try { vb.setPointerCapture(ev.pointerId) } catch {}
		ev.preventDefault()
		ev.stopPropagation()
	}
	const rh = document.createElement('span')
	rh.className = 'device-view__destination-resize'
	rh.title = 'Resize'
	vb.appendChild(rh)
	vb.addEventListener('pointerdown', (ev) => {
		if (ev.target?.closest('.device-view__destination-resize, .device-view__destination-port')) return
		startDrag(ev, false)
	})
	rh.addEventListener('pointerdown', (ev) => startDrag(ev, true))
	window.addEventListener('pointermove', (ev) => {
		if (!drag || ev.pointerId !== drag.pointerId) return
		const p = getContentPoint(ev)
		if (drag.resize) {
			const minW = 110
			const minH = 62
			const dx = p.x - (drag.base.left + drag.base.w)
			const dy = p.y - (drag.base.top + drag.base.h)
			const dominant = Math.abs(dx) >= Math.abs(dy * drag.ar) ? dx : (dy * drag.ar)
			const nextW = Math.max(minW, Math.round(drag.base.w + dominant))
			const nextH = Math.max(minH, Math.round(nextW / drag.ar))
			vb.style.width = `${nextW}px`
			vb.style.height = `${nextH}px`
		} else {
			const maxX = Math.max(0, visual.clientWidth - vb.offsetWidth)
			const maxY = Math.max(0, visual.clientHeight - vb.offsetHeight)
			const dx = ev.clientX - drag.base.clientX
			const dy = ev.clientY - drag.base.clientY
			const x = Math.max(0, Math.min(maxX, Math.round(drag.base.left + dx)))
			const y = Math.max(0, Math.min(maxY, Math.round(drag.base.top + dy)))
			vb.style.left = `${x}px`
			vb.style.top = `${y}px`
		}
		if (typeof requestCableOverlayRender === 'function') requestCableOverlayRender()
	})
	window.addEventListener('pointerup', (ev) => {
		if (!drag || ev.pointerId !== drag.pointerId) return
		const x = Math.max(0, Math.round(parseFloat(vb.style.left || '0') || 0))
		const y = Math.max(0, Math.round(parseFloat(vb.style.top || '0') || 0))
		const wOut = Math.round(parseFloat(vb.style.width || '0') || vb.getBoundingClientRect().width)
		const hOut = Math.round(parseFloat(vb.style.height || '0') || vb.getBoundingClientRect().height)
		const nextLayout = { ...(layoutCache || {}), [destinationId]: { x, y, w: wOut, h: hOut } }
		if (typeof persistDestinationLayout === 'function') persistDestinationLayout(nextLayout)
		try { vb.releasePointerCapture(ev.pointerId) } catch {}
		drag = null
	})
	window.addEventListener('pointercancel', (ev) => {
		if (!drag || ev.pointerId !== drag.pointerId) return
		try { vb.releasePointerCapture(ev.pointerId) } catch {}
		drag = null
	})
}
