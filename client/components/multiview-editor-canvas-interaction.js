import { multiviewState } from '../lib/multiview-state.js'
import { getContainedVideoRect, getCellOverlayType } from './multiview-editor-canvas-layout.js'

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

export function getCellOuterRect(cell, cm = {}) {
	const programChannels = cm.programChannels || []
	const previewChannels = cm.previewChannels || []
	const ovType = getCellOverlayType(cell, programChannels, previewChannels)
	if (ovType === 'timers') {
		return { x: cell.x, y: cell.y, w: cell.w, h: cell.h }
	}
	const rect = getContainedVideoRect(cell, cm)
	return {
		x: rect.x - 3,
		y: rect.y - 3,
		w: rect.w + 6,
		h: rect.h + 6 + rect.lh,
	}
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
	const { x, y, w, h } = getCellOuterRect(cell, cm)
	const handles = [
		['se', x + w - tol, y + h - tol, x + w + tol, y + h + tol],
		['sw', x - tol, y + h - tol, x + tol, y + h + tol],
		['ne', x + w - tol, y - tol, x + w + tol, y + tol],
		['nw', x - tol, y - tol, x + tol, y + tol],
		['e', x + w - tol, y + h / 2 - tol, x + w + tol, y + h / 2 + tol],
		['w', x - tol, y + h / 2 - tol, x + tol, y + h / 2 + tol],
		['s', x + w / 2 - tol, y + h - tol, x + w / 2 + tol, y + h + tol],
		['n', x + w / 2 - tol, y - tol, x + w / 2 + tol, y + tol],
	]
	for (const [name, x1, y1, x2, y2] of handles) {
		if (canvasX >= x1 && canvasX <= x2 && canvasY >= y1 && canvasY <= y2) return name
	}
	return null
}
