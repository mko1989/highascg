import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { multiviewState } from '../lib/multiview-state.js'
import { api } from '../lib/api-client.js'
import { shouldShowLiveVideo, streamState } from '../lib/stream-state.js'

const HANDLE_SIZE = 8
const CELL_COLORS = { pgm: '#e63946', prv: '#2a9d8f', decklink: '#457b9d', ndi: '#457b9d' }
/** Solid label bar under tile (preview=green, program=red, other=blue) — no transparency over video */
const LABEL_BAR_BG = { pgm: '#c92a2a', prv: '#0d9488', decklink: '#2563eb', ndi: '#2563eb', route: '#2563eb' }

export function fitInContainer(canvas, wrap) {
	if (!canvas || !wrap) return { scale: 1, offsetX: 0, offsetY: 0 }
	const r = wrap.getBoundingClientRect()
	const w = Math.max(1, r.width)
	const h = Math.max(1, r.height)
	// Setting canvas dimensions resets the bitmap — only when size changes avoids blank flashes on frequent calls.
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

export function getCellAt(canvasX, canvasY) {
	const cells = multiviewState.getCells()
	for (let i = cells.length - 1; i >= 0; i--) {
		const c = cells[i]
		if (canvasX >= c.x && canvasX <= c.x + c.w && canvasY >= c.y && canvasY <= c.y + c.h) return c
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

export function getResizeHandle(cell, canvasX, canvasY, scale) {
	const tol = HANDLE_SIZE / scale
	const { x, y, w, h } = cell
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

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {{ offsetX: number, offsetY: number, scale: number, selectedId: string | null, dropHoverId: string | null }} view
 */
export function drawMultiviewEditor(ctx, canvas, view) {
	if (!ctx || !canvas) return

	const { offsetX, offsetY, scale, selectedId, dropHoverId } = view
	const mw = multiviewState.canvasWidth
	const mh = multiviewState.canvasHeight
	const bx = offsetX, by = offsetY
	const bw = mw * scale, bh = mh * scale

	// Outer chrome (outside the multiview canvas area)
	ctx.fillStyle = '#0a0e13'
	ctx.fillRect(0, 0, canvas.width, canvas.height)

	const isLive = shouldShowLiveVideo()
	if (isLive) {
		ctx.clearRect(bx, by, bw, bh)
	} else {
		// Multiview canvas area — slightly lighter background to distinguish it
		ctx.fillStyle = dropHoverId === '__canvas__' ? '#1a2535' : '#131a22'
		ctx.fillRect(bx, by, bw, bh)
	}

	// Dashed border marking the canvas edge
	ctx.save()
	ctx.strokeStyle = 'rgba(255,255,255,0.45)'
	ctx.lineWidth = 1.5
	ctx.setLineDash([8, 5])
	ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
	ctx.setLineDash([])
	ctx.restore()

	// Canvas size label at bottom-right of the canvas area
	const sizeLabel = `${mw}×${mh}`
	ctx.save()
	ctx.font = `${Math.round(Math.max(10, 12 * scale))}px ${UI_FONT_FAMILY}`
	ctx.fillStyle = 'rgba(255,255,255,0.3)'
	const tw = ctx.measureText(sizeLabel).width
	ctx.fillText(sizeLabel, bx + bw - tw - 6, by + bh - 5)
	ctx.restore()

	// Draw cells
	ctx.save()
	ctx.translate(bx, by)
	ctx.scale(scale, scale)

	const cells = multiviewState.getCells()
	cells.forEach((c) => {
		const isDropTarget = dropHoverId === c.id
		const borderColor = CELL_COLORS[c.type] || '#8b949e'
		// No fill over video — borders + label only (live picture stays visible)
		// Border — match output overlay (3px colored border)
		ctx.strokeStyle = (selectedId === c.id || isDropTarget) ? '#58a6ff' : borderColor
		ctx.lineWidth = 3
		ctx.strokeRect(c.x, c.y, c.w, c.h)
		if (isDropTarget) {
			ctx.save()
			ctx.strokeStyle = '#58a6ff'
			ctx.lineWidth = 1.5
			ctx.setLineDash([6, 4])
			ctx.strokeRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4)
			ctx.setLineDash([])
			ctx.restore()
		}
		// Label bar below cell (matches multiview_overlay.html — solid color, not over video)
		const OVERLAY_LABEL_H = 50
		const OVERLAY_BORDER = 3
		const labelH = OVERLAY_LABEL_H
		const labelY = c.y + c.h + OVERLAY_BORDER
		const labelBg = LABEL_BAR_BG[c.type] || LABEL_BAR_BG.route
		ctx.fillStyle = labelBg
		ctx.fillRect(c.x - OVERLAY_BORDER, labelY, c.w + OVERLAY_BORDER * 2, labelH)
		ctx.strokeStyle = borderColor
		ctx.lineWidth = 2
		ctx.strokeRect(c.x - OVERLAY_BORDER + 0.5, labelY + 0.5, c.w + OVERLAY_BORDER * 2 - 1, labelH - 1)
		ctx.fillStyle = '#fff'
		ctx.font = `bold 14px ${UI_FONT_FAMILY}`
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		const displayLabel = (c.source ? (c.source.label || c.source.value) : c.label) || c.id || ''
		const shortLabel = displayLabel.length > 28 ? displayLabel.slice(0, 25) + '…' : displayLabel
		ctx.fillText(shortLabel, c.x + c.w / 2, labelY + labelH / 2)
		
		// Audio indicator (🔊)
		if (multiviewState.audioActiveCellId === c.id) {
			ctx.save()
			ctx.textAlign = 'right'
			ctx.fillStyle = '#fff'
			ctx.fillText('🔊', c.x + c.w - 10, labelY + labelH / 2)
			ctx.restore()
		}
		
		ctx.textAlign = 'left'
		ctx.textBaseline = 'alphabetic'
	})

	ctx.restore()

	// "Drop sources here" hint when no cells exist
	if (cells.length === 0) {
		ctx.save()
		ctx.fillStyle = 'rgba(255,255,255,0.18)'
		ctx.font = `14px ${UI_FONT_FAMILY}`
		ctx.textAlign = 'center'
		ctx.fillText('Drag sources here or click Reset Layout', bx + bw / 2, by + bh / 2)
		ctx.textAlign = 'left'
		ctx.restore()
	}
}

export async function applyMultiviewAudioFocus() {
	const cells = multiviewState.getCells()
	const targetId = multiviewState.audioActiveCellId
	if (!targetId) return

	// Channel 3 is MV channel as per T1.2
	const MV_CH = 3 
	
	const idx = cells.findIndex(c => c.id === targetId)
	if (idx < 0) return

	const layer = idx + 1
	
	// Ensure browser follows the MV audio
	streamState.setAudioSource('multiview')
	streamState.setMuted(false)
	
	try {
		const cmds = []
		cells.forEach((c, i) => {
			const L = i + 1
			cmds.push(`MIXER ${MV_CH} VOLUME ${L} ${L === layer ? 1 : 0}`)
		})
		await api.post('/api/amcp/batch', { commands: cmds })
	} catch (e) {
		console.error('Audio focus AMCP failed:', e)
	}
}

/**
 * @param {() => object} getChannelMap
 * @param {{ silent?: boolean }} [opts] — silent: no alert on error (live updates)
 */
export async function applyMultiviewLayout(getChannelMap, opts = {}) {
	const silent = !!opts.silent
	const cm = getChannelMap()
	const mvCh = cm.multiviewCh
	if (mvCh == null) {
		if (!silent) alert('Multiview is not enabled. Enable it in module settings.')
		return
	}
	const layout = multiviewState.toApiLayout()
	try {
		await api.post('/api/multiview/apply', {
			layout,
			showOverlay: multiviewState.showOverlay,
		})
	} catch (e) {
		console.error('Multiview apply failed:', e)
		if (silent) return
		const msg = String(e?.message ?? e ?? '')
		const hint = (msg.toLowerCase().includes('not connected') || msg.includes('503'))
			? 'CasparCG is not connected. Check module Settings → Connection and ensure CasparCG server is running.'
			: msg
		alert('Multiview output failed: ' + hint)
	}
}
