/**
 * CG-only look deck thumbnails — checkerboard alpha + server-rendered CG PNGs (WO-60).
 */

import { fillToPixelRect } from '../lib/fill-math.js'
import { deriveTemplateId, resolveLayerLowerThirdCgData } from '../lib/lower-third-cg-data.js'
import { apiPost, resolveApiUrl } from '../lib/api-client.js'
import { drawImageContainInRect, drawLayerWithBoundaryTransparency } from './preview-canvas-draw-base.js'

/** @type {Map<string, { url?: string, img?: HTMLImageElement, loading?: boolean, error?: boolean }>} */
const layerThumbCache = new Map()

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 */
export function drawAlphaCheckerboard(ctx, W, H) {
	const size = Math.max(8, Math.round(Math.min(W, H) / 14))
	ctx.fillStyle = '#334155'
	ctx.fillRect(0, 0, W, H)
	ctx.fillStyle = '#475569'
	const cols = Math.ceil(W / size)
	const rows = Math.ceil(H / size)
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			if ((r + c) % 2 !== 0) continue
			const x = c * size
			const y = r * size
			ctx.fillRect(x, y, Math.min(size, W - x), Math.min(size, H - y))
		}
	}
}

/**
 * Draw a server-rendered CG PNG (already cropped to the graphic) into the dest rect.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} img
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} [paddingRatio]
 */
function drawCgThumbContained(ctx, img, x, y, w, h, paddingRatio = 0.05) {
	const pad = Math.min(w, h) * paddingRatio
	const dx = x + pad
	const dy = y + pad
	const dw = Math.max(1, w - pad * 2)
	const dh = Math.max(1, h - pad * 2)
	drawImageContainInRect(ctx, img, dx, dy, dw, dh)
}

/**
 * @param {object} layer
 * @returns {{ sourceValue: string, templateId: string, cgData: object | null } | null}
 */
export function resolveLayerCgRenderPayload(layer) {
	if (!layer || typeof layer !== 'object') return null
	const src = layer.source
	const sourceValue = src?.value != null ? String(src.value) : String(layer.template || '').trim()
	if (!sourceValue) return null
	let cgData = resolveLayerLowerThirdCgData(layer)
	if (!cgData && layer.cgData && typeof layer.cgData === 'object') {
		cgData = layer.cgData
	} else if (!cgData && layer.templateData && typeof layer.templateData === 'object') {
		cgData = layer.templateData
	} else if (!cgData && src?.data && typeof src.data === 'object') {
		cgData = src.data
	}
	const templateId = deriveTemplateId(sourceValue) || sourceValue.toLowerCase()
	return { sourceValue, templateId, cgData }
}

/**
 * @param {{ sourceValue: string, templateId: string, cgData: object | null, width: number, height: number }} payload
 * @returns {string}
 */
function cacheKey(payload) {
	return JSON.stringify({
		sourceValue: payload.sourceValue,
		templateId: payload.templateId,
		cgData: payload.cgData,
		width: payload.width,
		height: payload.height,
	})
}

/**
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error('CG thumb image load failed'))
		img.src = url
	})
}

/**
 * @param {{ sourceValue: string, templateId: string, cgData: object | null, width: number, height: number }} payload
 * @param {() => void} onReady
 */
async function ensureCgLayerThumb(payload, onReady) {
	const key = cacheKey(payload)
	let entry = layerThumbCache.get(key)
	if (!entry) {
		entry = {}
		layerThumbCache.set(key, entry)
	}
	if (entry.img && entry.url) return
	if (entry.loading) return
	entry.loading = true
	try {
		const res = await apiPost('/api/cg-thumb/render', {
			sourceValue: payload.sourceValue,
			templateId: payload.templateId,
			cgData: payload.cgData,
			width: payload.width,
			height: payload.height,
		})
		const url = res?.url ? `${resolveApiUrl(res.url)}?t=${Date.now()}` : null
		if (!url) throw new Error('No CG thumb URL')
		entry.url = url
		entry.img = await loadImage(url)
		entry.error = false
		onReady()
	} catch {
		entry.error = true
		onReady()
	} finally {
		entry.loading = false
	}
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 * @param {object} scene
 * @param {{ onRepaint?: () => void }} [opts]
 */
export function drawCgOnlyLookDeckThumb(ctx, W, H, scene, opts = {}) {
	const onRepaint = typeof opts.onRepaint === 'function' ? opts.onRepaint : () => {}
	drawAlphaCheckerboard(ctx, W, H)
	const layers = Array.isArray(scene?.layers) ? [...scene.layers] : []
	if (!layers.length) return
	layers.sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

	const contentLayers = layers.filter((layer) => resolveLayerCgRenderPayload(layer))
	const singleLayerFill = contentLayers.length === 1

	for (const layer of layers) {
		const payload = resolveLayerCgRenderPayload(layer)
		if (!payload) continue
		const fill = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
		const pr = singleLayerFill
			? { x: 0, y: 0, w: W, h: H }
			: fillToPixelRect(fill, { width: W, height: H })
		const px = pr.x
		const py = pr.y
		const pw = Math.max(1, pr.w)
		const ph = Math.max(1, pr.h)
		const op = layer.opacity != null ? layer.opacity : 1
		const req = { ...payload, width: W, height: H }
		const key = cacheKey(req)
		const entry = layerThumbCache.get(key)

		const drawFn = () => {
			if (entry?.img) {
				ctx.save()
				ctx.beginPath()
				ctx.rect(px, py, pw, ph)
				ctx.clip()
				drawCgThumbContained(ctx, entry.img, px, py, pw, ph, singleLayerFill ? 0.04 : 0.06)
				ctx.restore()
				return
			}
			if (entry?.error) {
				ctx.fillStyle = 'rgba(15, 23, 42, 0.55)'
				ctx.fillRect(px, py, pw, ph)
				ctx.fillStyle = 'rgba(226, 232, 240, 0.85)'
				ctx.font = '600 10px sans-serif'
				ctx.fillText('CG', px + 6, py + 14)
			}
		}

		drawLayerWithBoundaryTransparency(ctx, W, H, op, drawFn)

		if (!entry || (!entry.img && !entry.loading && !entry.error)) {
			void ensureCgLayerThumb(req, onRepaint)
		}
	}
}

/** Test hook — clear in-memory deck thumb cache. */
export function clearCgOnlyLookDeckThumbCache() {
	layerThumbCache.clear()
}
