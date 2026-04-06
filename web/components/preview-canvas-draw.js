/**
 * Canvas drawing helpers for dashboard / scenes / timeline preview stacks.
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { clipPixelRectAtLocalTime } from '../lib/timeline-clip-interp.js'

/** Match `.preview-panel--compose-dual` cell background in styles.css (letterbox around video). */
const COMPOSE_DUAL_PREVIEW_BG = '#e8eaed'

/**
 * Draw a clear outer frame for the program output rectangle (full WxH), on top of layer content.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 */
export function drawOutputCanvasBounds(ctx, W, H) {
	const pad = 1.5
	ctx.save()
	ctx.strokeStyle = 'rgba(230, 237, 243, 0.92)'
	ctx.lineWidth = 2
	ctx.setLineDash([7, 5])
	ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2)
	ctx.setLineDash([])
	ctx.strokeStyle = 'rgba(88, 166, 255, 0.55)'
	ctx.lineWidth = 1
	ctx.strokeRect(pad + 2.5, pad + 2.5, W - pad * 2 - 5, H - pad * 2 - 5)
	const fs = Math.max(11, Math.round(Math.min(W, H) / 70))
	ctx.font = `600 ${fs}px ${UI_FONT_FAMILY}`
	ctx.textAlign = 'right'
	ctx.textBaseline = 'bottom'
	const tag = `Canvas · ${Math.round(W)}×${Math.round(H)}`
	ctx.fillStyle = 'rgba(13, 17, 23, 0.82)'
	const tw = ctx.measureText(tag).width
	const bx = W - 10
	const by = H - 8
	ctx.fillRect(bx - tw - 12, by - fs - 8, tw + 14, fs + 10)
	ctx.fillStyle = 'rgba(88, 166, 255, 0.95)'
	ctx.fillText(tag, bx, by)
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
		ctx.fillStyle = 'rgba(192, 57, 43, 0.95)'
		ctx.fillRect(0, 0, W, edge)
		ctx.strokeStyle = 'rgba(100, 30, 24, 0.85)'
		ctx.lineWidth = 1
		ctx.strokeRect(0.5, 0.5, W - 1, edge - 1)

		ctx.fillStyle = 'rgba(39, 174, 96, 0.95)'
		ctx.fillRect(0, H - edge, W, edge)
		ctx.strokeStyle = 'rgba(20, 90, 50, 0.85)'
		ctx.strokeRect(0.5, H - edge + 0.5, W - 1, edge - 1)

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

	// Preview — left (green)
	ctx.fillStyle = 'rgba(39, 174, 96, 0.95)'
	ctx.fillRect(0, 0, edge, H)
	ctx.strokeStyle = 'rgba(20, 90, 50, 0.85)'
	ctx.lineWidth = 1
	ctx.strokeRect(0.5, 0.5, edge - 1, H - 1)
	// Program — right (red)
	ctx.fillStyle = 'rgba(192, 57, 43, 0.95)'
	ctx.fillRect(W - edge, 0, edge, H)
	ctx.strokeStyle = 'rgba(100, 30, 24, 0.85)'
	ctx.strokeRect(W - edge + 0.5, 0.5, edge - 1, H - 1)

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

function drawImageCover(ctx, img, x, y, w, h) {
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
	} = opts

	if (isLive) {
		ctx.clearRect(0, 0, W, H)
	} else {
		ctx.fillStyle = composeDualStreamPreview ? COMPOSE_DUAL_PREVIEW_BG : '#0d1117'
		ctx.fillRect(0, 0, W, H)
	}

	if (!scene?.layers?.length) {
		ctx.fillStyle = '#6e7681'
		ctx.font = `${Math.max(14, Math.round(W / 80))}px ${UI_FONT_FAMILY}`
		ctx.fillText('Add layers and assign sources', 16, Math.round(H / 2))
		if (!composeDualStreamPreview) {
			drawOutputCanvasBounds(ctx, W, H)
			drawComposePrvPgmEdgeBars(ctx, W, H, { layout: composePrvPgmLayout })
		}
		return
	}

	const sorted = [...scene.layers].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))
	const lw = Math.max(2, Math.round(W / 400))

	for (let i = 0; i < sorted.length; i++) {
		const layer = sorted[i]
		const src = layer.source
		const fill = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
		const x = Math.max(0, Math.min(W - 1, fill.x * W))
		const y = Math.max(0, Math.min(H - 1, fill.y * H))
		const w = Math.max(1, Math.min(W - x, fill.scaleX * W))
		const h = Math.max(1, Math.min(H - y, fill.scaleY * H))
		const realIdx = scene.layers.indexOf(layer)
		const color = PREVIEW_LAYER_COLORS[realIdx % PREVIEW_LAYER_COLORS.length]
		const op = layer.opacity != null ? layer.opacity : 1
		const isSel = selectedLayerIndex != null && realIdx === selectedLayerIndex

		ctx.save()
		ctx.globalAlpha = op

		const cx = x + w / 2
		const cy = y + h / 2
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
			ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
			ctx.fillStyle = color
			ctx.font = `bold ${Math.max(11, Math.round(W / 100))}px ${UI_FONT_FAMILY}`
			ctx.fillText(`L${layer.layerNumber}`, x + 6, y + Math.max(14, Math.round(H / 70)))
			ctx.restore()
			continue
		}

		const url = src && getThumbUrl ? getThumbUrl(src) : null
		if (url) {
			const { img, ready, failed } = getThumbnailEntry(url, onThumbLoaded)
			if (ready && !failed) {
				ctx.save()
				ctx.beginPath()
				ctx.rect(x, y, w, h)
				ctx.clip()
				if (layer.contentFit === 'stretch' || layer.fillNativeAspect === false) {
					ctx.drawImage(img, x, y, w, h)
				} else {
					/* Contain within layer rect — approximates fit / fill-canvas MIXER FILL. */
					drawImageCover(ctx, img, x, y, w, h)
				}
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
			ctx.fillStyle = 'rgba(22, 27, 34, 0.45)'
			ctx.fillRect(x, y, w, h)
		}

		ctx.strokeStyle = isSel ? '#58a6ff' : color
		ctx.lineWidth = isSel ? lw * 2 : lw
		ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)

		ctx.fillStyle = color
		ctx.font = `bold ${Math.max(11, Math.round(W / 100))}px ${UI_FONT_FAMILY}`
		ctx.fillText(`L${layer.layerNumber}`, x + 6, y + Math.max(14, Math.round(H / 70)))

		ctx.restore()
	}

	if (!composeDualStreamPreview) {
		drawOutputCanvasBounds(ctx, W, H)
		drawComposePrvPgmEdgeBars(ctx, W, H, { layout: composePrvPgmLayout })
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
export function drawTimelineStack(ctx, W, H, opts) {
	const {
		timelineState,
		getPlayback,
		getThumbUrl,
		onThumbLoaded,
		isLive = false,
		composePrvPgmLayout = 'lr',
		composeDualStreamPreview = false,
		stateStore,
		screenIdx,
	} = opts
	
	if (isLive) {
		ctx.clearRect(0, 0, W, H)
	} else {
		ctx.fillStyle = composeDualStreamPreview ? COMPOSE_DUAL_PREVIEW_BG : '#0d1117'
		ctx.fillRect(0, 0, W, H)
	}

	const tl = timelineState.getActive()
	if (!tl) {
		ctx.fillStyle = '#6e7681'
		ctx.font = `${Math.max(14, Math.round(W / 80))}px ${UI_FONT_FAMILY}`
		ctx.fillText('No timeline', 16, Math.round(H / 2))
		if (!composeDualStreamPreview) {
			drawOutputCanvasBounds(ctx, W, H)
			drawComposePrvPgmEdgeBars(ctx, W, H, { layout: composePrvPgmLayout })
		}
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

		const url = getThumbUrl ? getThumbUrl(clip.source) : null
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

	if (!composeDualStreamPreview) {
		drawOutputCanvasBounds(ctx, W, H)
		drawComposePrvPgmEdgeBars(ctx, W, H, { layout: composePrvPgmLayout })
	}
}
