/**
 * Preview canvas — placeholder / status-text / audio-only fill helpers shared by
 * drawSceneComposeStack and drawTimelineStack.
 * Extracted from preview-canvas-draw-stacks.js (WO-221 Phase A mechanical split).
 */
import { UI_FONT_FAMILY } from '../lib/ui-font.js'

/** @param {object | null | undefined} source */
export function sourceFallbackLabel(source) {
	const t = String(source?.type || '').toLowerCase()
	if (t === 'timeline') return 'Timeline'
	if (t === 'route' || t === 'live' || /^route:\/\//i.test(String(source?.value || ''))) return 'Live'
	if (t === 'ndi') return 'NDI'
	if (t === 'browser') return 'Browser'
	if (t === 'live_audio') return 'Audio in'
	return (source?.label || source?.value || 'Source').slice(0, 24)
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} [label]
 */
export function drawAudioOnlyPreviewFill(ctx, x, y, w, h, label = 'Audio') {
	const g = ctx.createLinearGradient(x, y, x, y + h)
	g.addColorStop(0, '#1e2a3a')
	g.addColorStop(1, '#0d1117')
	ctx.fillStyle = g
	ctx.fillRect(x, y, w, h)
	ctx.fillStyle = 'rgba(255,255,255,0.82)'
	const fs = Math.max(10, Math.round(Math.min(w, h) / 14))
	ctx.font = `600 ${fs}px ${UI_FONT_FAMILY}`
	ctx.textAlign = 'left'
	ctx.textBaseline = 'top'
	ctx.fillText(label, x + 6, y + 6)
	const cy = y + h * 0.55
	const n = Math.min(40, Math.max(4, Math.floor((w - 24) / 3)))
	const barW = Math.max(1, (w - 20 - (n - 1)) / n)
	ctx.fillStyle = 'rgba(129, 182, 255, 0.55)'
	for (let i = 0; i < n; i++) {
		const ph = (0.25 + 0.55 * Math.abs(Math.sin(i * 0.7))) * (h * 0.22)
		ctx.fillRect(x + 10 + i * (barW + 1), cy - ph / 2, barW, ph)
	}
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} text
 */
export function drawPreviewStatusText(ctx, x, y, w, h, text) {
	ctx.fillStyle = 'rgba(48, 54, 61, 0.92)'
	ctx.fillRect(x, y, w, h)
	ctx.fillStyle = '#8b949e'
	const fs = Math.max(10, Math.round(Math.min(w, h) / 16))
	ctx.font = `${fs}px ${UI_FONT_FAMILY}`
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(text, x + w / 2, y + h / 2)
	ctx.textAlign = 'left'
	ctx.textBaseline = 'alphabetic'
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {object} item
 */
export function drawPlaceholderFill(ctx, x, y, w, h, item) {
	const template = String(item.template || 'color_grid').toLowerCase()
	const label = String(item.label || item.id || '').toUpperCase()

	ctx.save()
	ctx.beginPath()
	ctx.rect(x, y, w, h)
	ctx.clip()

	if (template === 'color_grid') {
		const cw = w / 8, ch = h / 4
		for (let r = 0; r < 4; r++) {
			for (let c = 0; c < 8; c++) {
				ctx.fillStyle = (r + c) % 2 === 0 ? '#0f172a' : '#1e293b'
				ctx.fillRect(x + c * cw, y + r * ch, cw, ch)
			}
		}
	} else if (template === 'solid') {
		ctx.fillStyle = item.value || '#3b82f6'
		ctx.fillRect(x, y, w, h)
	} else if (template === 'smpte_bars') {
		const colors = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff']
		const bw = w / colors.length
		colors.forEach((c, i) => {
			ctx.fillStyle = c
			ctx.fillRect(x + i * bw, y, bw, h * 0.7)
		})
		const bottomColors = ['#0000ff', '#131313', '#ff00ff', '#131313', '#00ffff', '#131313', '#ffffff']
		bottomColors.forEach((c, i) => {
			ctx.fillStyle = c
			ctx.fillRect(x + i * bw, y + h * 0.7, bw, h * 0.3)
		})
	} else if (template === 'aspect_guide') {
		ctx.fillStyle = '#161b22'
		ctx.fillRect(x, y, w, h)
		ctx.strokeStyle = '#58a6ff'
		ctx.lineWidth = 2
		ctx.strokeRect(x + 2, y + 2, w - 4, h - 4)
		// 4:3 guide
		const targetAR = 4/3, currentAR = w/h
		let gw = w, gh = h
		if (currentAR > targetAR) gw = h * targetAR; else gh = w / targetAR
		ctx.setLineDash([5, 5])
		ctx.strokeRect(x + (w - gw)/2, y + (h - gh)/2, gw, gh)
		ctx.setLineDash([])
	} else if (template === 'countdown') {
		ctx.fillStyle = '#0d1117'
		ctx.fillRect(x, y, w, h)
		ctx.strokeStyle = '#2ecc71'
		ctx.lineWidth = 4
		const radius = Math.min(w, h) * 0.3
		ctx.beginPath()
		ctx.arc(x + w / 2, y + h / 2, radius, 0, Math.PI * 2)
		ctx.stroke()
		ctx.fillStyle = '#fff'
		ctx.font = `bold ${radius}px ${UI_FONT_FAMILY}`
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.fillText('10', x + w / 2, y + h / 2)
	} else if (template === 'white_noise') {
		for (let i = 0; i < 1000; i++) {
			ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000'
			ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 2, 2)
		}
	} else {
		const g = ctx.createLinearGradient(x, y, x + w, y + h)
		g.addColorStop(0, '#21262d'); g.addColorStop(1, '#0d1117')
		ctx.fillStyle = g
		ctx.fillRect(x, y, w, h)
	}

	// Label overlay
	ctx.fillStyle = 'rgba(0,0,0,0.5)'
	const labelH = Math.max(16, h * 0.15)
	ctx.fillRect(x, y + h - labelH, w, labelH)
	ctx.fillStyle = '#fff'
	ctx.font = `${Math.max(10, labelH * 0.6)}px ${UI_FONT_FAMILY}`
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(label, x + w / 2, y + h - labelH / 2)

	ctx.restore()
}
