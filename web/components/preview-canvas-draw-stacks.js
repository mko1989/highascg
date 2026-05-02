import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { fillToPixelRect } from '../lib/fill-math.js'
import { clipPixelRectAtLocalTime } from '../lib/timeline-clip-interp.js'
import { isLikelyAudioOnlySource } from '../lib/media-audio-kind.js'
import {
	COMPOSE_DUAL_PREVIEW_BG,
	drawComposePrvPgmCellEdgeBar,
	drawComposePrvPgmEdgeBars,
	drawDualComposeCellPreview,
	drawOutputCanvasBounds,
	PREVIEW_LAYER_COLORS,
	findClipAtTime,
	lerpKeyframeProperty,
	getThumbnailEntry,
	drawImageCover,
	drawImageContainInRect,
} from './preview-canvas-draw-base.js'

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 * @param {object} opts
 * @param {object} opts.dashboardState
 * @param {number} opts.layerCount
 * @param {(src: object) => string | null} opts.getThumbUrl
 * @param {() => void} opts.onThumbLoaded
 */
export function drawDashboardProgramStack(ctx, W, H, opts) {
	const { dashboardState, layerCount, getThumbUrl, onThumbLoaded, isLive = false } = opts
	
	if (isLive) {
		ctx.clearRect(0, 0, W, H)
	} else {
		ctx.fillStyle = '#0d1117'
		ctx.fillRect(0, 0, W, H)
	}

	const colIdx = dashboardState.getActiveColumnIndex()
	if (colIdx < 0) {
		ctx.fillStyle = '#6e7681'
		ctx.font = `${Math.max(14, Math.round(W / 80))}px ${UI_FONT_FAMILY}`
		ctx.fillText('Activate a column to preview the stack', 16, Math.round(H / 2))
		return
	}

	const lw = Math.max(2, Math.round(W / 400))

	for (let layerIdx = 0; layerIdx < layerCount; layerIdx++) {
		const ls = dashboardState.getLayerSetting(layerIdx)
		const cell = dashboardState.getCell(colIdx, layerIdx)
		const src = cell?.source
		const x = Math.max(0, Math.min(W - 1, ls.x ?? 0))
		const y = Math.max(0, Math.min(H - 1, ls.y ?? 0))
		const w = Math.max(1, Math.min(W - x, ls.w ?? W))
		const h = Math.max(1, Math.min(H - y, ls.h ?? H))
		const color = PREVIEW_LAYER_COLORS[layerIdx % PREVIEW_LAYER_COLORS.length]
		const op = ls.opacity != null ? ls.opacity : 1

		ctx.save()
		ctx.globalAlpha = op

		const url = !isLive && src && getThumbUrl ? getThumbUrl(src) : null
		if (url) {
			const { img, ready, failed } = getThumbnailEntry(url, onThumbLoaded)
			if (ready && !failed) {
				ctx.save()
				ctx.beginPath()
				ctx.rect(x, y, w, h)
				ctx.clip()
				drawImageCover(ctx, img, x, y, w, h)
				ctx.restore()
			} else {
				ctx.fillStyle = 'rgba(48, 54, 61, 0.9)'
				ctx.fillRect(x, y, w, h)
			}
		} else if (src?.value) {
			ctx.fillStyle = 'rgba(48, 54, 61, 0.85)'
			ctx.fillRect(x, y, w, h)
			ctx.fillStyle = '#8b949e'
			ctx.font = `${Math.max(11, Math.round(w / 14))}px ${UI_FONT_FAMILY}`
			const label = (src.label || src.value || '').slice(0, 24)
			ctx.fillText(label, x + 6, y + Math.min(22, h * 0.25))
		} else {
			ctx.fillStyle = 'rgba(22, 27, 34, 0.5)'
			ctx.fillRect(x, y, w, h)
		}

		ctx.strokeStyle = color
		ctx.lineWidth = lw
		ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)

		ctx.fillStyle = color
		ctx.font = `bold ${Math.max(11, Math.round(W / 100))}px ${UI_FONT_FAMILY}`
		ctx.fillText(`L${layerIdx + 1}`, x + 6, y + Math.max(14, Math.round(H / 70)))

		ctx.restore()
	}
}

/**
 * Scene / look editor stack — normalized FILL per layer, optional selection highlight.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 * @param {object} opts
 * @param {{ layers: object[] }} opts.scene
 * @param {number | null} [opts.selectedLayerIndex]
 * @param {(src: object) => string | null} [opts.getThumbUrl]
 * @param {() => void} [opts.onThumbLoaded]
 * @param {boolean} [opts.composeDualStreamPreview=false]
 */
export function drawSceneComposeStack(ctx, W, H, opts) {
	const {
		scene,
		selectedLayerIndex,
		getThumbUrl,
		onThumbLoaded,
		isLive = false,
		composePrvPgmLayout = 'lr',
		composeDualStreamPreview = false,
		skipBg = false,
		/** Look deck cards: composite layers only, no PRV/PGM chrome or layer outlines. */
		deckThumbnailMode = false,
	} = opts

	if (!skipBg) {
		if (isLive) {
			ctx.clearRect(0, 0, W, H)
		} else {
			ctx.fillStyle = composeDualStreamPreview ? COMPOSE_DUAL_PREVIEW_BG : '#0d1117'
			ctx.fillRect(0, 0, W, H)
		}
	}

	if (!scene?.layers?.length) {
		if (isLive && composeDualStreamPreview) {
			return
		}
		if (!composeDualStreamPreview && !deckThumbnailMode) {
			drawOutputCanvasBounds(ctx, W, H)
			drawComposePrvPgmEdgeBars(ctx, W, H, { layout: composePrvPgmLayout })
		}
		ctx.fillStyle = '#6e7681'
		ctx.font = `${Math.max(14, Math.round(W / 80))}px ${UI_FONT_FAMILY}`
		ctx.fillText('Add layers and assign sources', 16, Math.round(H / 2))
		return
	}

	const sorted = [...scene.layers].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))
	const lw = Math.max(2, Math.round(W / 400))

	if (!composeDualStreamPreview && !deckThumbnailMode) {
		drawOutputCanvasBounds(ctx, W, H)
		drawComposePrvPgmEdgeBars(ctx, W, H, { layout: composePrvPgmLayout })
	}

	for (let i = 0; i < sorted.length; i++) {
		const layer = sorted[i]
		const src = layer.source
		const fill = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
		/** Unclamped program rect in preview pixels — native/wide layers may extend past canvas (center crop like PGM). */
		const pr = fillToPixelRect(fill, { width: W, height: H })
		const px = pr.x
		const py = pr.y
		const pw = Math.max(1, pr.w)
		const ph = Math.max(1, pr.h)
		const realIdx = scene.layers.indexOf(layer)
		const color = PREVIEW_LAYER_COLORS[realIdx % PREVIEW_LAYER_COLORS.length]
		const op = layer.opacity != null ? layer.opacity : 1
		const isSel = selectedLayerIndex != null && realIdx === selectedLayerIndex

		ctx.save()
		ctx.globalAlpha = op

		const cx = px + pw / 2
		const cy = py + ph / 2
		const rot = ((layer.rotation || 0) * Math.PI) / 180
		ctx.translate(cx, cy)
		ctx.rotate(rot)
		ctx.translate(-cx, -cy)

		// Live WebRTC under canvas: layer borders + L# labels (not solid fills). Dual PRV/PGM: skip those
		// layer overlays; dashed frame + PRV/PGM edge bars are omitted in dual compose.
		if (isLive) {
			if (composeDualStreamPreview) {
				ctx.restore()
				continue
			}
			ctx.strokeStyle = isSel ? '#58a6ff' : color
			ctx.lineWidth = isSel ? lw * 2 : lw
			ctx.strokeRect(px + lw / 2, py + lw / 2, pw - lw, ph - lw)
			ctx.fillStyle = color
			ctx.font = `bold ${Math.max(11, Math.round(W / 100))}px ${UI_FONT_FAMILY}`
			ctx.fillText(`L${layer.layerNumber}`, px + 6, py + Math.max(14, Math.round(H / 70)))
			ctx.restore()
			continue
		}

		const url = src && getThumbUrl ? getThumbUrl(src) : null
		if (url) {
			const { img, ready, failed } = getThumbnailEntry(url, onThumbLoaded)
			if (ready && !failed) {
				ctx.save()
				ctx.beginPath()
				ctx.rect(px, py, pw, ph)
				ctx.clip()
				const cf = layer.contentFit || 'native'
				const forceStretch = cf === 'stretch' || layer.fillNativeAspect === false
				if (forceStretch) {
					ctx.drawImage(img, px, py, pw, ph)
				} else if (cf === 'horizontal' || cf === 'vertical') {
					drawImageCover(ctx, img, px, py, pw, ph)
				} else {
					/* native & fill-canvas: fill rect matches engine layer box (1:1 with PGM); thumb is stretched to that rect (same AR as source). */
					ctx.drawImage(img, px, py, pw, ph)
				}
				ctx.restore()
			} else {
				ctx.fillStyle = 'rgba(48, 54, 61, 0.9)'
				ctx.fillRect(px, py, pw, ph)
			}
		} else if (src?.isPlaceholder || src?.type === 'placeholder' || src?.template || l.template) {
			drawPlaceholderFill(ctx, px, py, pw, ph, src || { template: l.template })
		} else if (src?.value) {
			ctx.fillStyle = 'rgba(48, 54, 61, 0.85)'
			ctx.fillRect(px, py, pw, ph)
			ctx.fillStyle = '#8b949e'
			ctx.font = `${Math.max(11, Math.round(pw / 14))}px ${UI_FONT_FAMILY}`
			const label = (src.label || src.value || '').slice(0, 24)
			ctx.fillText(label, px + 6, py + Math.min(22, ph * 0.25))
		} else {
			ctx.fillStyle = 'rgba(22, 27, 34, 0.45)'
			ctx.fillRect(px, py, pw, ph)
		}

		if (!deckThumbnailMode) {
			ctx.strokeStyle = isSel ? '#58a6ff' : color
			ctx.lineWidth = isSel ? lw * 2 : lw
			ctx.strokeRect(px + lw / 2, py + lw / 2, pw - lw, ph - lw)

			ctx.fillStyle = color
			ctx.font = `bold ${Math.max(11, Math.round(W / 100))}px ${UI_FONT_FAMILY}`
			ctx.fillText(`L${layer.layerNumber}`, px + 6, py + Math.max(14, Math.round(H / 70)))
		}

		ctx.restore()
	}
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 * @param {object} opts
 * @param {{ getActive: () => object | null }} opts.timelineState
 * @param {() => { position: number }} opts.getPlayback
 * @param {(src: object) => string | null} opts.getThumbUrl
 * @param {() => void} opts.onThumbLoaded
 * @param {import('../lib/state-store.js').StateStore} [opts.stateStore]
 * @param {number} [opts.screenIdx]
 */
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} [label]
 */
function drawAudioOnlyPreviewFill(ctx, x, y, w, h, label = 'Audio') {
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
function drawPreviewStatusText(ctx, x, y, w, h, text) {
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
function drawPlaceholderFill(ctx, x, y, w, h, item) {
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

export function drawTimelineStack(ctx, W, H, opts) {
	const {
		timelineState,
		getPlayback,
		getThumbUrl,
		onThumbLoaded,
		isLive = false,
		composePrvPgmLayout = 'lr',
		composeDualStreamPreview = false,
		composeCell,
		stateStore,
		screenIdx,
	} = opts

	if (composeDualStreamPreview && composeCell) {
		const layout = composePrvPgmLayout === 'tb' ? 'tb' : 'lr'
		const v = opts.composeCellViewport
		const cellW = v?.w > 0 && v?.h > 0 ? v.w : layout === 'lr' ? W / 2 : W
		const cellH = v?.w > 0 && v?.h > 0 ? v.h : layout === 'tb' ? H / 2 : H
		if (isLive) {
			ctx.clearRect(0, 0, cellW, cellH)
			drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: composeCell })
			return
		}
		drawDualComposeCellPreview(ctx, W, H, cellW, cellH, (c) => {
			drawTimelineStack(c, W, H, {
				...opts,
				composeDualStreamPreview: false,
				composeCell: undefined,
			})
		})
		drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: composeCell })
		return
	}

	if (isLive) {
		ctx.clearRect(0, 0, W, H)
	} else {
		ctx.fillStyle = composeDualStreamPreview ? COMPOSE_DUAL_PREVIEW_BG : '#0d1117'
		ctx.fillRect(0, 0, W, H)
	}

	if (!composeDualStreamPreview) {
		drawOutputCanvasBounds(ctx, W, H)
		drawComposePrvPgmEdgeBars(ctx, W, H, { layout: composePrvPgmLayout })
	}

	const mediaList = stateStore?.getState?.()?.media || []

	const tl = timelineState.getActive()
	if (!tl) {
		if (isLive && composeDualStreamPreview) {
			return
		}
		ctx.fillStyle = '#6e7681'
		ctx.font = `${Math.max(14, Math.round(W / 80))}px ${UI_FONT_FAMILY}`
		ctx.fillText('No timeline', 16, Math.round(H / 2))
		return
	}

	const pos = getPlayback().position
	const lw = Math.max(2, Math.round(W / 400))

	for (let li = 0; li < tl.layers.length; li++) {
		const clip = findClipAtTime(tl.layers[li], pos)
		if (!clip?.source?.value) continue

		const localMs = Math.max(0, pos - clip.startTime)
		const op = lerpKeyframeProperty(clip, 'opacity', localMs, 1)
		const r = clipPixelRectAtLocalTime(clip, localMs, W, H, stateStore, screenIdx)
		const x = r.x
		const y = r.y
		const w = Math.max(1, r.w)
		const h = Math.max(1, r.h)
		const color = PREVIEW_LAYER_COLORS[li % PREVIEW_LAYER_COLORS.length]

		ctx.save()
		ctx.globalAlpha = Math.max(0, Math.min(1, op))

		/* Live WebRTC: dual PRV/PGM — skip L# layer strokes/labels only (see drawSceneComposeStack). */
		if (isLive) {
			if (composeDualStreamPreview) {
				ctx.restore()
				continue
			}
			ctx.strokeStyle = color
			ctx.lineWidth = lw
			ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
			ctx.fillStyle = color
			ctx.font = `bold ${Math.max(11, Math.round(W / 100))}px ${UI_FONT_FAMILY}`
			ctx.fillText(`L${li + 1}`, x + 6, y + Math.max(14, Math.round(H / 70)))
			ctx.restore()
			continue
		}

		const audioOnly = isLikelyAudioOnlySource(clip.source, mediaList)
		const url = !audioOnly && getThumbUrl ? getThumbUrl(clip.source) : null
		if (audioOnly) {
			drawAudioOnlyPreviewFill(
				ctx,
				x,
				y,
				w,
				h,
				(clip.source.label || clip.source.value || 'Audio').slice(0, 28),
			)
		} else if (url) {
			const { img, ready, failed } = getThumbnailEntry(url, onThumbLoaded)
			if (ready && !failed) {
				ctx.save()
				ctx.beginPath()
				ctx.rect(x, y, w, h)
				ctx.clip()
				const cf = clip.contentFit || 'native'
				if (cf === 'stretch') {
					ctx.drawImage(img, x, y, w, h)
				} else if (cf === 'horizontal' || cf === 'vertical') {
					drawImageCover(ctx, img, x, y, w, h)
				} else {
					drawImageContainInRect(ctx, img, x, y, w, h)
				}
				ctx.restore()
			} else if (failed) {
				drawPreviewStatusText(ctx, x, y, w, h, 'No preview')
			} else {
				drawPreviewStatusText(ctx, x, y, w, h, 'Loading…')
			}
		} else if (clip.source?.isPlaceholder) {
			drawPlaceholderFill(ctx, x, y, w, h, clip.source)
		} else {
			ctx.fillStyle = 'rgba(48, 54, 61, 0.85)'
			ctx.fillRect(x, y, w, h)
			ctx.fillStyle = '#8b949e'
			ctx.font = `${Math.max(11, Math.round(w / 14))}px ${UI_FONT_FAMILY}`
			const label = (clip.source.label || clip.source.value || '').slice(0, 24)
			ctx.fillText(label, x + 6, y + Math.min(22, h * 0.25))
		}

		ctx.strokeStyle = color
		ctx.lineWidth = lw
		ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)

		ctx.fillStyle = color
		ctx.font = `bold ${Math.max(11, Math.round(W / 100))}px ${UI_FONT_FAMILY}`
		ctx.fillText(`L${li + 1}`, x + 6, y + Math.max(14, Math.round(H / 70)))

		ctx.restore()
	}
}
