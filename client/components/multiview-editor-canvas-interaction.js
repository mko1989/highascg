import { multiviewState } from '../lib/multiview-state.js'

const HANDLE_SIZE = 8

export function fitInContainer(canvas, wrap) {
	if (!canvas || !wrap) return { scale: 1, offsetX: 0, offsetY: 0 }
	const r = wrap.getBoundingClientRect()
	const w = Math.max(1, r.width)
	const h = Math.max(1, r.height)
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w
		canvas.height = h
	}
	const cw = multiviewState.canvasWidth
	const ch = multiviewState.canvasHeight
	const sx = w / cw
	const sy = h / ch
	const scale = Math.min(sx, sy, 1)
	const offsetX = (w - cw * scale) / 2
	const offsetY = (h - ch * scale) / 2
	return { scale, offsetX, offsetY }
}

export function toCanvas(x, y, offsetX, offsetY, scale) {
	return { x: (x - offsetX) / scale, y: (y - offsetY) / scale }
}

/** Interactive bounds for move/resize — full cell frame (video + label + chrome), not letterboxed picture. */
export function getCellOuterRect(cell) {
	return { x: cell.x, y: cell.y, w: cell.w, h: cell.h }
}

export function getCellAt(canvasX, canvasY, cm = {}) {
	const cells = multiviewState.getCells()
	for (let i = cells.length - 1; i >= 0; i--) {
		const c = cells[i]
		const r = getCellOuterRect(c, cm)
		if (canvasX >= r.x && canvasX <= r.x + r.w && canvasY >= r.y && canvasY <= r.y + r.h) return c
	}
	return null
}

export function cursorForResizeHandle(h) {
	const map = {
		n: 'ns-resize',
		s: 'ns-resize',
		e: 'ew-resize',
		w: 'ew-resize',
		ne: 'nesw-resize',
		sw: 'nesw-resize',
		nw: 'nwse-resize',
		se: 'nwse-resize',
	}
	return map[h] || 'default'
}

export function getResizeHandle(cell, canvasX, canvasY, scale, cm = {}) {
	const tol = HANDLE_SIZE / scale
	const { x, y, w, h } = getCellOuterRect(cell)
	const insideX = canvasX > x + tol && canvasX < x + w - tol
	const insideY = canvasY > y + tol && canvasY < y + h - tol
	if (insideX && insideY) return null

	const nearLeft = canvasX >= x - tol && canvasX <= x + tol
	const nearRight = canvasX >= x + w - tol && canvasX <= x + w + tol
	const nearTop = canvasY >= y - tol && canvasY <= y + tol
	const nearBottom = canvasY >= y + h - tol && canvasY <= y + h + tol
	const withinY = canvasY >= y - tol && canvasY <= y + h + tol
	const withinX = canvasX >= x - tol && canvasX <= x + w + tol

	if (nearRight && nearBottom) return 'se'
	if (nearLeft && nearBottom) return 'sw'
	if (nearRight && nearTop) return 'ne'
	if (nearLeft && nearTop) return 'nw'
	if (nearRight && withinY) return 'e'
	if (nearLeft && withinY) return 'w'
	if (nearBottom && withinX) return 's'
	if (nearTop && withinX) return 'n'
	return null
}
