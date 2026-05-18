import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { multiviewState } from '../lib/multiview-state.js'
import { shouldShowLiveVideo } from '../lib/stream-state.js'
import {
	getContainedVideoRect,
	getCellOverlayType,
	getResolutionSuffix,
} from './multiview-editor-canvas-layout.js'
import { getCellOuterRect } from './multiview-editor-canvas-interaction.js'

const CELL_COLORS = { pgm: '#e63946', prv: '#2a9d8f', decklink: '#457b9d', ndi: '#457b9d' }
const LABEL_BAR_BG = { pgm: '#c92a2a', prv: '#0d9488', decklink: '#2563eb', ndi: '#2563eb', route: '#2563eb' }

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {{ offsetX: number, offsetY: number, scale: number, selectedId: string | null, dropHoverId: string | null, channelMap?: any }} view
 */
export function drawMultiviewEditor(ctx, canvas, view) {
	if (!ctx || !canvas) return

	const { offsetX, offsetY, scale, selectedId, dropHoverId, channelMap = {} } = view
	const mw = multiviewState.canvasWidth
	const mh = multiviewState.canvasHeight
	const bx = offsetX
	const by = offsetY
	const bw = mw * scale
	const bh = mh * scale

	ctx.fillStyle = '#0a0e13'
	ctx.fillRect(0, 0, canvas.width, canvas.height)

	const isLive = shouldShowLiveVideo()
	if (isLive) {
		ctx.clearRect(bx, by, bw, bh)
	} else {
		ctx.fillStyle = dropHoverId === '__canvas__' ? '#1a2535' : '#131a22'
		ctx.fillRect(bx, by, bw, bh)
	}

	ctx.save()
	ctx.strokeStyle = 'rgba(255,255,255,0.45)'
	ctx.lineWidth = 1.5
	ctx.setLineDash([8, 5])
	ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
	ctx.setLineDash([])
	ctx.restore()

	const sizeLabel = `${mw}×${mh}`
	ctx.save()
	ctx.font = `${Math.round(Math.max(10, 12 * scale))}px ${UI_FONT_FAMILY}`
	ctx.fillStyle = 'rgba(255,255,255,0.3)'
	const tw = ctx.measureText(sizeLabel).width
	ctx.fillText(sizeLabel, bx + bw - tw - 6, by + bh - 5)
	ctx.restore()

	ctx.save()
	ctx.translate(bx, by)
	ctx.scale(scale, scale)

	const cells = multiviewState.getCells()
	cells.forEach((c) => {
		const isDropTarget = dropHoverId === c.id
		const programChannels = channelMap.programChannels || []
		const previewChannels = channelMap.previewChannels || []
		const ovType = getCellOverlayType(c, programChannels, previewChannels)
		const isTimers = ovType === 'timers'
		const borderColor = CELL_COLORS[ovType] || '#8b949e'

		if (isTimers) {
			if (selectedId === c.id || isDropTarget) {
				ctx.save()
				ctx.strokeStyle = '#58a6ff'
				ctx.lineWidth = 1.5
				ctx.setLineDash([6, 4])
				ctx.strokeRect(c.x, c.y, c.w, c.h)
				ctx.restore()
			}
			return
		}

		const rect = getContainedVideoRect(c, channelMap)

		if (selectedId === c.id || isDropTarget) {
			ctx.save()
			ctx.strokeStyle = '#58a6ff'
			ctx.lineWidth = 1
			ctx.setLineDash([4, 3])
			const outer = getCellOuterRect(c, channelMap)
			ctx.strokeRect(outer.x, outer.y, outer.w, outer.h)
			ctx.restore()
		}

		ctx.strokeStyle = (selectedId === c.id || isDropTarget) ? '#58a6ff' : borderColor
		ctx.lineWidth = 3
		ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
		if (isDropTarget) {
			ctx.save()
			ctx.strokeStyle = '#58a6ff'
			ctx.lineWidth = 1.5
			ctx.setLineDash([6, 4])
			ctx.strokeRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4)
			ctx.setLineDash([])
			ctx.restore()
		}
		const OVERLAY_BORDER = 3
		const timersUnder = !!multiviewState.showTimersUnderLabels
		const isScreen = ovType === 'pgm' || ovType === 'prv'
		const labelBg = LABEL_BAR_BG[ovType] || LABEL_BAR_BG.route
		const displayLabel = ((c.source ? (c.source.label || c.source.value) : c.label) || c.id || '') + getResolutionSuffix(c, channelMap)
		const shortLabel = displayLabel.length > 36 ? displayLabel.slice(0, 33) + '…' : displayLabel

		if (timersUnder && isScreen) {
			const titleH = Math.min(34, Math.max(22, Math.floor(rect.lh * 0.36)))
			const dockH = rect.lh - titleH
			const dockW = Math.min(rect.lw - 8, Math.max(200, rect.lw * 0.5))
			const dockX = rect.lx + (rect.lw - dockW) / 2

			ctx.fillStyle = labelBg
			ctx.fillRect(rect.lx - OVERLAY_BORDER, rect.ly, rect.lw + OVERLAY_BORDER * 2, titleH)
			ctx.strokeStyle = borderColor
			ctx.lineWidth = 2
			ctx.strokeRect(rect.lx - OVERLAY_BORDER + 0.5, rect.ly + 0.5, rect.lw + OVERLAY_BORDER * 2 - 1, titleH - 1)

			ctx.fillStyle = 'rgba(10, 14, 20, 0.92)'
			ctx.fillRect(dockX, rect.ly + titleH, dockW, dockH)
			ctx.strokeStyle = borderColor
			ctx.strokeRect(dockX + 0.5, rect.ly + titleH + 0.5, dockW - 1, dockH - 1)

			ctx.fillStyle = '#fff'
			ctx.font = `600 ${Math.min(12, Math.max(10, titleH * 0.38))}px ${UI_FONT_FAMILY}`
			ctx.textAlign = 'center'
			ctx.textBaseline = 'middle'
			ctx.fillText(shortLabel, rect.lx + rect.lw / 2, rect.ly + titleH / 2)

			if (multiviewState.audioActiveCellId === c.id) {
				ctx.save()
				ctx.textAlign = 'right'
				ctx.fillText('🔊', rect.lx + rect.lw - 10, rect.ly + titleH / 2)
				ctx.restore()
			}
		} else {
			ctx.fillStyle = labelBg
			ctx.fillRect(rect.lx - OVERLAY_BORDER, rect.ly, rect.lw + OVERLAY_BORDER * 2, rect.lh)
			ctx.strokeStyle = borderColor
			ctx.lineWidth = 2
			ctx.strokeRect(rect.lx - OVERLAY_BORDER + 0.5, rect.ly + 0.5, rect.lw + OVERLAY_BORDER * 2 - 1, rect.lh - 1)
			ctx.fillStyle = '#fff'
			ctx.font = `600 ${Math.min(13, Math.max(10, rect.lh * 0.38))}px ${UI_FONT_FAMILY}`
			ctx.textAlign = 'center'
			ctx.textBaseline = 'middle'
			ctx.fillText(shortLabel, rect.lx + rect.lw / 2, rect.ly + rect.lh / 2)
			if (multiviewState.audioActiveCellId === c.id) {
				ctx.save()
				ctx.textAlign = 'right'
				ctx.fillStyle = '#fff'
				ctx.fillText('🔊', rect.lx + rect.lw - 10, rect.ly + rect.lh / 2)
				ctx.restore()
			}
		}

		ctx.textAlign = 'left'
		ctx.textBaseline = 'alphabetic'
	})

	ctx.restore()

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
