/**
 * WO-319 — operator stream view. The simple, correct compose preview: show the operator channel
 * (ch4) live stream FULL WIDTH, cropped from the bottom, with a divider each client drags to reveal
 * more of the bottom, and an optional per-client zoom. Everything here is LOCAL to the client
 * (persisted in localStorage) — the operator channel's internal mosaic is Caspar's job, and the host
 * may run no client at all. No layout reporting, no cross-client sync: every client just views the
 * one shared stream and frames its own window.
 */

import {
	drawOperatorLiveCanvas,
	operatorLiveCanvasFrameSize,
	operatorLiveCanvasHasFrame,
	isOperatorLiveCanvasEnabled,
	subscribeOperatorLiveCanvasRepaint,
} from './preview-canvas-live-stream.js'

const LS_CROP = 'highascg.streamView.crop' // fraction of the full-width frame height that is visible
const LS_ZOOM = 'highascg.streamView.zoom'
const MIN_CROP = 0.15
const MAX_ZOOM = 4
const MIN_ZOOM = 1

function clampNum(v, lo, hi, dflt) {
	const n = parseFloat(v)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}

/**
 * @param {HTMLElement} container
 * @returns {{ redraw: () => void, destroy: () => void, root: HTMLElement }}
 */
export function initOperatorStreamView(container) {
	const root = document.createElement('div')
	root.className = 'operator-stream-view'
	root.style.cssText = 'position:relative;width:100%;overflow:hidden;background:#000;'

	// The canvas is the FULL-WIDTH frame at its natural aspect (× zoom); the root is shorter and
	// clips it — that clip IS the crop-from-bottom. The divider changes how much shows.
	const canvas = document.createElement('canvas')
	canvas.style.cssText = 'display:block;width:100%;transform-origin:top left;'
	root.appendChild(canvas)

	const divider = document.createElement('div')
	divider.className = 'operator-stream-view__divider'
	divider.title = 'Drag to reveal more / less of the bottom'
	divider.style.cssText =
		'position:absolute;left:0;right:0;bottom:0;height:10px;cursor:ns-resize;z-index:2;' +
		'background:linear-gradient(rgba(80,170,255,0),rgba(80,170,255,.55));'
	const grip = document.createElement('div')
	grip.style.cssText = 'position:absolute;left:50%;bottom:2px;width:38px;height:3px;border-radius:2px;background:rgba(255,255,255,.7);transform:translateX(-50%);'
	divider.appendChild(grip)
	root.appendChild(divider)

	const offBadge = document.createElement('div')
	offBadge.textContent = 'Live preview off'
	offBadge.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#666;font:13px system-ui,sans-serif;pointer-events:none;'
	root.appendChild(offBadge)

	container.appendChild(root)

	let crop = clampNum(localStorage.getItem(LS_CROP), MIN_CROP, 1, 0.6)
	let zoom = clampNum(localStorage.getItem(LS_ZOOM), MIN_ZOOM, MAX_ZOOM, 1)

	function frameAspect() {
		const s = operatorLiveCanvasFrameSize()
		return s && s.width > 0 && s.height > 0 ? s.width / s.height : 16 / 9
	}

	function draw() {
		const cw = Math.max(1, Math.round(root.clientWidth || container.clientWidth || 320))
		const fullH = Math.round((cw / frameAspect()) * zoom) // full-width frame height at this zoom
		const visH = Math.max(40, Math.round(fullH * crop)) // crop from the bottom
		root.style.height = `${visH}px`
		if (canvas.width !== cw || canvas.height !== fullH) {
			canvas.width = cw
			canvas.height = fullH
		}
		canvas.style.height = `${fullH}px`
		const cx = canvas.getContext('2d')
		if (!cx) return
		cx.clearRect(0, 0, cw, fullH)
		const live = isOperatorLiveCanvasEnabled() && operatorLiveCanvasHasFrame()
		offBadge.style.display = live ? 'none' : 'flex'
		if (live) drawOperatorLiveCanvas(cx, cw, fullH) // fills full width at natural aspect (no bars)
	}

	let rafPending = false
	function redraw() {
		if (rafPending) return
		rafPending = true
		requestAnimationFrame(() => {
			rafPending = false
			draw()
		})
	}

	// Divider drag → crop from bottom.
	divider.addEventListener('pointerdown', (e) => {
		e.preventDefault()
		divider.setPointerCapture?.(e.pointerId)
		const startY = e.clientY
		const startVis = root.clientHeight
		const fullH = (root.clientWidth / frameAspect()) * zoom || 1
		const move = (ev) => {
			const visH = Math.max(40, startVis + (ev.clientY - startY))
			crop = clampNum(visH / fullH, MIN_CROP, 1, crop)
			localStorage.setItem(LS_CROP, String(crop))
			draw()
		}
		const up = (ev) => {
			divider.releasePointerCapture?.(ev.pointerId)
			document.removeEventListener('pointermove', move)
			document.removeEventListener('pointerup', up)
		}
		document.addEventListener('pointermove', move)
		document.addEventListener('pointerup', up)
	})

	// Ctrl/⌘ + wheel over the view → per-client zoom of the whole stream.
	root.addEventListener(
		'wheel',
		(e) => {
			if (!(e.ctrlKey || e.metaKey)) return
			e.preventDefault()
			zoom = clampNum(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_ZOOM, MAX_ZOOM, zoom)
			localStorage.setItem(LS_ZOOM, String(zoom))
			draw()
		},
		{ passive: false },
	)

	const unsubFrame = subscribeOperatorLiveCanvasRepaint(redraw)
	const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : null
	ro?.observe(root)
	draw()

	return {
		redraw,
		root,
		destroy() {
			unsubFrame()
			ro?.disconnect()
			root.remove()
		},
	}
}
