/**
 * Canvas drawing helpers for scenes / timeline preview stacks.
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'

/** Letterbox around dual PRV/PGM — dark theme (match preview panel / compose cells). */
export const COMPOSE_DUAL_PREVIEW_BG = '#161b22'

/**
 * Draw a clear outer frame for the program output rectangle (full WxH).
 * Updated to a clean grey boundary per user request.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 */
export function drawOutputCanvasBounds(ctx, W, H) {
	ctx.save()
	ctx.strokeStyle = 'rgba(110, 118, 129, 0.8)' // Clean grey
	ctx.lineWidth = 1.5
	ctx.strokeRect(0.5, 0.5, W - 1, H - 1)
	
	const fs = Math.max(10, Math.round(Math.min(W, H) / 75))
	ctx.font = `600 ${fs}px ${UI_FONT_FAMILY}`
	ctx.textAlign = 'right'
	ctx.textBaseline = 'bottom'
	const tag = `${Math.round(W)}×${Math.round(H)}`
	ctx.fillStyle = 'rgba(48, 54, 61, 0.6)'
	const tw = ctx.measureText(tag).width
	ctx.fillRect(W - tw - 8, H - fs - 6, tw + 8, fs + 6)
	ctx.fillStyle = 'rgba(230, 237, 243, 0.7)'
	ctx.fillText(tag, W - 4, H - 3)
	ctx.restore()
}

/**
 * Render content with different opacities for parts inside vs outside the canvas boundaries.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W - canvas width
 * @param {number} H - canvas height
 * @param {number} op - base opacity (0-1)
 * @param {() => void} drawFn - callback to perform drawing
 */
export function drawLayerWithBoundaryTransparency(ctx, W, H, op, drawFn) {
	const outAlpha = Math.max(0, Math.min(1, op * 0.15))
	
	// 1. Draw outside part (faded)
	ctx.save()
	ctx.beginPath()
	// Create a path that covers the "universe" but excludes the canvas
	ctx.rect(-10000, -10000, 20000, 20000)
	ctx.rect(0, 0, W, H)
	ctx.clip('evenodd')
	ctx.globalAlpha = outAlpha
	drawFn()
	ctx.restore()

	// 2. Draw inside part (full)
	ctx.save()
	ctx.beginPath()
	ctx.rect(0, 0, W, H)
	ctx.clip()
	ctx.globalAlpha = op
	drawFn()
	ctx.restore()
}

/**
 * Compose preview (looks + timeline): PRV = preview (green), PGM = program (red).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 * @param {object} [opts]
 * @param {'lr'|'tb'} [opts.layout='lr'] — `lr`: PRV left / PGM right; `tb`: PGM top / PRV bottom (suited to wide aspect)
 */
export function drawComposePrvPgmEdgeBars(ctx, W, H, opts = {}) {
	const layout = opts.layout === 'tb' ? 'tb' : 'lr'
	const fs = Math.max(9, Math.round(Math.min(W, H) / 72))
	ctx.save()

	if (layout === 'tb') {
		const edge = Math.max(4, Math.min(12, Math.round(Math.min(W, H) / 100)))
		const gTop = ctx.createLinearGradient(0, 0, 0, edge)
		gTop.addColorStop(0, 'rgba(192, 57, 43, 0.95)')
		gTop.addColorStop(0.55, 'rgba(192, 57, 43, 0.22)')
		gTop.addColorStop(1, 'rgba(192, 57, 43, 0)')
		ctx.fillStyle = gTop
		ctx.fillRect(0, 0, W, edge)
		ctx.strokeStyle = 'rgba(100, 30, 24, 0.55)'
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(0.5, 0.5)
		ctx.lineTo(W - 0.5, 0.5)
		ctx.stroke()

		const gBot = ctx.createLinearGradient(0, H - edge, 0, H)
		gBot.addColorStop(0, 'rgba(39, 174, 96, 0)')
		gBot.addColorStop(0.45, 'rgba(39, 174, 96, 0.22)')
		gBot.addColorStop(1, 'rgba(39, 174, 96, 0.95)')
		ctx.fillStyle = gBot
		ctx.fillRect(0, H - edge, W, edge)
		ctx.strokeStyle = 'rgba(20, 90, 50, 0.55)'
		ctx.beginPath()
		ctx.moveTo(0.5, H - 0.5)
		ctx.lineTo(W - 0.5, H - 0.5)
		ctx.stroke()

		ctx.font = `700 ${fs}px ${UI_FONT_FAMILY}`
		ctx.textBaseline = 'middle'
		ctx.textAlign = 'center'
		ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
		ctx.fillText('PGM', W / 2, edge / 2)
		ctx.fillText('PRV', W / 2, H - edge / 2)
		ctx.restore()
		return
	}

	// Side layout: cap strip width so green/red never meet in the middle on narrow outputs.
	const edgeRaw = Math.max(4, Math.min(12, Math.round(Math.min(W, H) / 100)))
	const edge = Math.min(edgeRaw, Math.max(2, Math.floor(W / 2) - 2))

	// Preview — left (green): fade from outer edge inward
	const gL = ctx.createLinearGradient(0, 0, edge, 0)
	gL.addColorStop(0, 'rgba(39, 174, 96, 0.95)')
	gL.addColorStop(0.55, 'rgba(39, 174, 96, 0.22)')
	gL.addColorStop(1, 'rgba(39, 174, 96, 0)')
	ctx.fillStyle = gL
	ctx.fillRect(0, 0, edge, H)
	ctx.strokeStyle = 'rgba(20, 90, 50, 0.55)'
	ctx.lineWidth = 1
	ctx.beginPath()
	ctx.moveTo(0.5, 0.5)
	ctx.lineTo(0.5, H - 0.5)
	ctx.stroke()
	// Program — right (red): fade from outer edge inward
	const gR = ctx.createLinearGradient(W - edge, 0, W, 0)
	gR.addColorStop(0, 'rgba(192, 57, 43, 0)')
	gR.addColorStop(0.45, 'rgba(192, 57, 43, 0.22)')
	gR.addColorStop(1, 'rgba(192, 57, 43, 0.95)')
	ctx.fillStyle = gR
	ctx.fillRect(W - edge, 0, edge, H)
	ctx.strokeStyle = 'rgba(100, 30, 24, 0.55)'
	ctx.beginPath()
	ctx.moveTo(W - 0.5, 0.5)
	ctx.lineTo(W - 0.5, H - 0.5)
	ctx.stroke()

	// Top of each strip: horizontal labels (left vs right) — never stacked on the same line in the center.
	const sPRV = 'PRV'
	const sPGM = 'PGM'
	let lfs = Math.max(7, Math.min(12, edge + 3))
	ctx.textBaseline = 'middle'
	ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
	for (let i = 0; i < 8; i++) {
		ctx.font = `700 ${lfs}px ${UI_FONT_FAMILY}`
		const wPRV = ctx.measureText(sPRV).width
		const wPGM = ctx.measureText(sPGM).width
		if (wPRV <= edge - 1 && wPGM <= edge - 1) break
		lfs -= 1
	}
	if (lfs < 6) lfs = 6
	ctx.font = `700 ${lfs}px ${UI_FONT_FAMILY}`
	const labelY = Math.min(16, Math.max(9, edge))
	ctx.textAlign = 'left'
	ctx.fillText(sPRV, 3, labelY)
	ctx.textAlign = 'right'
	ctx.fillText(sPGM, W - 3, labelY)

	ctx.restore()
}

/**
 * One PRV/PGM preview cell only (each cell has its own canvas).
 * @param {'prv'|'pgm'} opts.cell
 */
export function drawComposePrvPgmCellEdgeBar(ctx, W, H, opts = {}) {
	const layout = opts.layout === 'tb' ? 'tb' : 'lr'
	const cell = opts.cell === 'pgm' ? 'pgm' : 'prv'
	const fs = Math.max(9, Math.round(Math.min(W, H) / 72))
	ctx.save()

	if (layout === 'tb') {
		const edge = Math.max(4, Math.min(12, Math.round(Math.min(W, H) / 100)))
		if (cell === 'pgm') {
			const gTop = ctx.createLinearGradient(0, 0, 0, edge)
			gTop.addColorStop(0, 'rgba(192, 57, 43, 0.95)')
			gTop.addColorStop(0.55, 'rgba(192, 57, 43, 0.22)')
			gTop.addColorStop(1, 'rgba(192, 57, 43, 0)')
			ctx.fillStyle = gTop
			ctx.fillRect(0, 0, W, edge)
			ctx.strokeStyle = 'rgba(100, 30, 24, 0.55)'
			ctx.lineWidth = 1
			ctx.beginPath()
			ctx.moveTo(0.5, 0.5)
			ctx.lineTo(W - 0.5, 0.5)
			ctx.stroke()
			ctx.font = `700 ${fs}px ${UI_FONT_FAMILY}`
			ctx.textBaseline = 'middle'
			ctx.textAlign = 'center'
			ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
			// ctx.fillText('PGM', W / 2, edge / 2)
		} else {
			const gBot = ctx.createLinearGradient(0, H - edge, 0, H)
			gBot.addColorStop(0, 'rgba(39, 174, 96, 0)')
			gBot.addColorStop(0.45, 'rgba(39, 174, 96, 0.22)')
			gBot.addColorStop(1, 'rgba(39, 174, 96, 0.95)')
			ctx.fillStyle = gBot
			ctx.fillRect(0, H - edge, W, edge)
			ctx.strokeStyle = 'rgba(20, 90, 50, 0.55)'
			ctx.lineWidth = 1
			ctx.beginPath()
			ctx.moveTo(0.5, H - 0.5)
			ctx.lineTo(W - 0.5, H - 0.5)
			ctx.stroke()
			ctx.font = `700 ${fs}px ${UI_FONT_FAMILY}`
			ctx.textBaseline = 'middle'
			ctx.textAlign = 'center'
			ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
			// ctx.fillText('PRV', W / 2, H - edge / 2)
		}
		ctx.restore()
		return
	}

	const edgeRaw = Math.max(4, Math.min(12, Math.round(Math.min(W, H) / 100)))
	const edge = Math.min(edgeRaw, Math.max(2, Math.floor(W / 2) - 2))

	if (cell === 'prv') {
		const gL = ctx.createLinearGradient(0, 0, edge, 0)
		gL.addColorStop(0, 'rgba(39, 174, 96, 0.95)')
		gL.addColorStop(0.55, 'rgba(39, 174, 96, 0.22)')
		gL.addColorStop(1, 'rgba(39, 174, 96, 0)')
		ctx.fillStyle = gL
		ctx.fillRect(0, 0, edge, H)
		ctx.strokeStyle = 'rgba(20, 90, 50, 0.55)'
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(0.5, 0.5)
		ctx.lineTo(0.5, H - 0.5)
		ctx.stroke()
		ctx.font = `700 ${fs}px ${UI_FONT_FAMILY}`
		ctx.textBaseline = 'middle'
		ctx.textAlign = 'left'
		ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
		const labelY = Math.min(16, Math.max(9, edge))
		// ctx.fillText('PRV', 3, labelY)
	} else {
		const gR = ctx.createLinearGradient(W - edge, 0, W, 0)
		gR.addColorStop(0, 'rgba(192, 57, 43, 0)')
		gR.addColorStop(0.45, 'rgba(192, 57, 43, 0.22)')
		gR.addColorStop(1, 'rgba(192, 57, 43, 0.95)')
		ctx.fillStyle = gR
		ctx.fillRect(W - edge, 0, edge, H)
		ctx.strokeStyle = 'rgba(100, 30, 24, 0.55)'
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(W - 0.5, 0.5)
		ctx.lineTo(W - 0.5, H - 0.5)
		ctx.stroke()
		ctx.font = `700 ${fs}px ${UI_FONT_FAMILY}`
		ctx.textBaseline = 'middle'
		ctx.textAlign = 'right'
		ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
		const labelY = Math.min(16, Math.max(9, edge))
		// ctx.fillText('PGM', W - 3, labelY)
	}
	ctx.restore()
}

/**
 * Letterbox full program W×H into one PRV/PGM cell (same math as dual split).
 * @param {(ctx: CanvasRenderingContext2D) => void} drawFullCompose — draw in full program coordinates
 */
export function drawDualComposeCellPreview(ctx, fullW, fullH, cellW, cellH, drawFullCompose) {
	ctx.fillStyle = COMPOSE_DUAL_PREVIEW_BG
	ctx.fillRect(0, 0, cellW, cellH)
	ctx.save()
	ctx.beginPath()
	ctx.rect(0, 0, cellW, cellH)
	ctx.clip()
	ctx.fillStyle = COMPOSE_DUAL_PREVIEW_BG
	ctx.fillRect(0, 0, cellW, cellH)
	const s = Math.min(cellW / fullW, cellH / fullH)
	const ox = (cellW - fullW * s) / 2
	const oy = (cellH - fullH * s) / 2
	ctx.translate(ox, oy)
	ctx.scale(s, s)
	drawFullCompose(ctx)
	ctx.restore()
}

export const PREVIEW_LAYER_COLORS = [
	'#e63946',
	'#2a9d8f',
	'#457b9d',
	'#e9c46a',
	'#9b59b6',
	'#1abc9c',
	'#e67e22',
	'#34495e',
	'#95a5a6',
]

/** @param {object} layer */
export function findClipAtTime(layer, ms) {
	for (const c of layer.clips || []) {
		if (ms >= c.startTime && ms < c.startTime + c.duration) return c
	}
	return null
}

/**
 * Linear interpolation of a keyframed numeric property on a clip (matches server timeline-engine _lerp).
 * @param {object} clip
 * @param {string} property
 * @param {number} localMs
 * @param {number} defaultVal
 */
export function lerpKeyframeProperty(clip, property, localMs, defaultVal) {
	const kfs = (clip.keyframes || [])
		.filter((k) => k.property === property)
		.sort((a, b) => a.time - b.time)
	if (!kfs.length) return defaultVal
	const t = localMs
	if (t <= kfs[0].time) return kfs[0].value
	const last = kfs[kfs.length - 1]
	if (t >= last.time) return last.value
	for (let i = 0; i < kfs.length - 1; i++) {
		const a = kfs[i]
		const b = kfs[i + 1]
		if (t >= a.time && t <= b.time) {
			return a.value + (b.value - a.value) * (t - a.time) / (b.time - a.time)
		}
	}
	return defaultVal
}

const _thumbCache = new Map()

/**
 * Drop cached Image entries so a new URL (e.g. after live PRINT refresh) reloads.
 * @param {string} [urlSubstring] — if omitted, clears entire thumbnail image cache
 */
export function invalidateThumbnailCache(urlSubstring) {
	if (!urlSubstring) {
		_thumbCache.clear()
		return
	}
	for (const k of [..._thumbCache.keys()]) {
		if (k.includes(urlSubstring)) _thumbCache.delete(k)
	}
}

/**
 * @param {string} url
 * @param {() => void} onReady
 * @returns {{ img: HTMLImageElement, ready: boolean }}
 */
export function getThumbnailEntry(url, onReady) {
	let e = _thumbCache.get(url)
	if (!e) {
		const img = new Image()
		img.crossOrigin = 'anonymous'
		e = { img, ready: false, failed: false }
		img.onload = () => {
			e.ready = true
			onReady?.()
		}
		img.onerror = () => {
			e.failed = true
			onReady?.()
		}
		img.src = url
		_thumbCache.set(url, e)
	}
	return e
}

export function drawImageCover(ctx, img, x, y, w, h) {
	if (!img?.naturalWidth) return
	const iw = img.naturalWidth
	const ih = img.naturalHeight
	const br = w / h
	const ir = iw / ih
	let sx, sy, sw, sh
	if (ir > br) {
		sh = ih
		sw = sh * br
		sy = 0
		sx = (iw - sw) / 2
	} else {
		sw = iw
		sh = sw / br
		sx = 0
		sy = (ih - sh) / 2
	}
	ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

/**
 * Uniform scale (contain / letterbox) inside the destination rect — matches MIXER FILL native + fill-canvas
 * when content resolution is known (min scale into layer box, centered).
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 */
export function drawImageContainInRect(ctx, img, x, y, w, h) {
	if (!img?.naturalWidth) return
	const iw = img.naturalWidth
	const ih = img.naturalHeight
	const scale = Math.min(w / iw, h / ih)
	const dw = iw * scale
	const dh = ih * scale
	const dx = x + (w - dw) / 2
	const dy = y + (h - dh) / 2
	ctx.drawImage(img, dx, dy, dw, dh)
}
