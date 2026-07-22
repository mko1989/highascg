/**
 * WO-319 — client stream view (punch-hole imitation, no holes).
 *
 * The operator channel (ch4) is a mosaic of routed feeds at FILL positions. This shows the WHOLE
 * stream letterboxed to fit the compose area, and draws a framed window (border + label) over each
 * route at its SHARED FILL position — so the frames sit exactly on the routes regardless of this
 * client's window size. The stream is the backdrop; the frames are the "holes". Dragging/resizing a
 * frame edits the shared layout (reports FILL as a fraction of the fitted stream, applied to ch4 for
 * everyone). Layout is fetched once and kept in sync via the operatorGuiLayout broadcast.
 *
 * Deliberately NOT the WO-256 tiles: those carve an aspect-locked hole inside an outer box for the X
 * SHAPE overlay, which does not map to a stream backdrop. Here a frame IS the route rect.
 */

import {
	drawOperatorLiveCanvas,
	operatorLiveCanvasFrameSize,
	operatorLiveCanvasHasFrame,
	isOperatorLiveCanvasEnabled,
	subscribeOperatorLiveCanvasRepaint,
} from './preview-canvas-live-stream.js'
import { subscribeSharedLayout, reportComposeCellRects } from '../lib/operator-gui-mode.js'
import { screenLabel } from '../lib/screen-label.js'

const MIN_FRAC = 0.03

/**
 * @param {HTMLElement} container
 * @param {{ stateStore?: object }} [options]
 */
export function initOperatorStreamTiles(container, options = {}) {
	const stateStore = options.stateStore
	const root = document.createElement('div')
	root.className = 'operator-stream-tiles'
	root.style.cssText = 'position:absolute;inset:0;overflow:hidden;'
	const canvas = document.createElement('canvas')
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;background:#000;'
	const frameLayer = document.createElement('div')
	frameLayer.style.cssText = 'position:absolute;inset:0;'
	root.append(canvas, frameLayer)
	container.appendChild(root)

	/** @type {Array<{ role:string, mainIndex:number, srcCh?:number, rect:{x,y,w,h} }>} shared FILL cells */
	let cells = []
	/** id -> { el, labelEl, cell } */
	const frames = new Map()

	const cm = () => stateStore?.getState?.()?.channelMap || {}
	const keyOf = (c) => `${c.role}:${c.mainIndex}${c.srcCh ? ':' + c.srcCh : ''}`

	/** The letterboxed rect (px within root) the stream is drawn into — frames are placed inside it. */
	function fitRect() {
		const r = root.getBoundingClientRect()
		const w = Math.max(1, r.width)
		const h = Math.max(1, r.height)
		const size = operatorLiveCanvasFrameSize()
		if (!size) return { x: 0, y: 0, w, h }
		const s = Math.min(w / size.width, h / size.height)
		const dw = size.width * s
		const dh = size.height * s
		return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh }
	}

	function drawStream() {
		const r = root.getBoundingClientRect()
		const w = Math.max(1, Math.round(r.width))
		const h = Math.max(1, Math.round(r.height))
		if (canvas.width !== w) canvas.width = w
		if (canvas.height !== h) canvas.height = h
		const cx = canvas.getContext('2d')
		if (!cx) return
		cx.clearRect(0, 0, w, h)
		if (isOperatorLiveCanvasEnabled() && operatorLiveCanvasHasFrame()) drawOperatorLiveCanvas(cx, w, h)
	}

	function layoutFrames() {
		const fit = fitRect()
		for (const [, f] of frames) {
			const rc = f.cell.rect
			f.el.style.left = `${fit.x + rc.x * fit.w}px`
			f.el.style.top = `${fit.y + rc.y * fit.h}px`
			f.el.style.width = `${rc.w * fit.w}px`
			f.el.style.height = `${rc.h * fit.h}px`
		}
	}

	function relabel(f) {
		const c = f.cell
		f.labelEl.textContent = `${String(c.role || 'pgm').toUpperCase()} ${Number(c.mainIndex ?? 0) + 1} / ${screenLabel(cm(), c.mainIndex)}`
	}

	function rebuildFrames() {
		const want = new Set(cells.map(keyOf))
		for (const [k, f] of frames) if (!want.has(k)) { f.el.remove(); frames.delete(k) }
		for (const c of cells) {
			const k = keyOf(c)
			let f = frames.get(k)
			if (!f) {
				const el = document.createElement('div')
				el.className = `operator-stream-tile operator-stream-tile--${c.role || 'pgm'}`
				const labelEl = document.createElement('div')
				labelEl.className = 'operator-stream-tile__label'
				const grip = document.createElement('div')
				grip.className = 'operator-stream-tile__resize'
				el.append(labelEl, grip)
				frameLayer.appendChild(el)
				f = { el, labelEl, cell: c }
				frames.set(k, f)
				wireDrag(f, el, 'move')
				wireDrag(f, grip, 'resize')
			} else {
				f.cell = c
			}
			relabel(f)
		}
		layoutFrames()
	}

	// Drag/resize a frame → new FILL fraction of the fitted stream → report (shared).
	function wireDrag(f, handle, mode) {
		handle.addEventListener('pointerdown', (e) => {
			e.preventDefault()
			e.stopPropagation()
			handle.setPointerCapture?.(e.pointerId)
			const fit = fitRect()
			const start = { ...f.cell.rect }
			const sx = e.clientX
			const sy = e.clientY
			const move = (ev) => {
				const dx = (ev.clientX - sx) / fit.w
				const dy = (ev.clientY - sy) / fit.h
				let { x, y, w, h } = start
				if (mode === 'move') { x = clamp01(start.x + dx, w); y = clamp01(start.y + dy, h) }
				else { w = Math.max(MIN_FRAC, Math.min(start.w + dx, 1 - start.x)); h = Math.max(MIN_FRAC, Math.min(start.h + dy, 1 - start.y)) }
				f.cell.rect = { x, y, w, h }
				layoutFrames()
			}
			const up = (ev) => {
				handle.releasePointerCapture?.(ev.pointerId)
				document.removeEventListener('pointermove', move)
				document.removeEventListener('pointerup', up)
				reportLayout()
			}
			document.addEventListener('pointermove', move)
			document.addEventListener('pointerup', up)
		})
	}

	function clamp01(v, size) {
		return Math.max(0, Math.min(v, 1 - size))
	}

	// Report all frames as compose cells, rects relative to the fitted-stream rect (= FILL fractions).
	function reportLayout() {
		const fit = fitRect()
		const cellRects = cells.map((c) => ({
			role: c.role,
			mainIndex: c.mainIndex,
			srcCh: c.srcCh,
			rect: { left: c.rect.x * fit.w, top: c.rect.y * fit.h, width: c.rect.w * fit.w, height: c.rect.h * fit.h },
		}))
		reportComposeCellRects(cellRects, { width: fit.w, height: fit.h })
	}

	async function loadLayout() {
		try {
			const res = await fetch('/api/operator-gui/layout', { cache: 'no-store' })
			if (!res.ok) return
			const j = await res.json()
			applyCells(Array.isArray(j?.cells) ? j.cells : [])
		} catch {
			/* keep last */
		}
	}
	function applyCells(next) {
		cells = next.filter((c) => c && c.rect && c.rect.w > 0 && c.rect.h > 0).map((c) => ({ role: c.role, mainIndex: c.mainIndex, srcCh: c.srcCh, rect: { ...c.rect } }))
		rebuildFrames()
	}

	let rafPending = false
	function redraw() {
		if (rafPending) return
		rafPending = true
		requestAnimationFrame(() => { rafPending = false; drawStream(); layoutFrames() })
	}

	const unsubFrame = subscribeOperatorLiveCanvasRepaint(redraw)
	const unsubShared = subscribeSharedLayout((c) => applyCells(c))
	const unsubCm = stateStore?.on?.('channelMap', () => { for (const [, f] of frames) relabel(f) }) || null
	const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : null
	ro?.observe(root)
	void loadLayout()
	redraw()

	return {
		refreshDefs() { void loadLayout() },
		destroy() {
			unsubFrame()
			unsubShared()
			unsubCm?.()
			ro?.disconnect()
			root.remove()
		},
	}
}
