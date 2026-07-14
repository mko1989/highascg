/**
 * Template thumbnail resolver — CG/lower-third/countdown template snapshots.
 *
 * WO-187: Wire the server-side Puppeteer cg-look-thumb-render (already rendering
 * for deck thumbs) into the editor DOM + canvas by caching per (sourceValue + cgData).
 */

import { deriveTemplateId, resolveLayerLowerThirdCgData } from './lower-third-cg-data.js'
import { apiPost, resolveApiUrl } from './api-client.js'

/** @type {Map<string, { url?: string, img?: HTMLImageElement, loading?: boolean, error?: boolean, staticFallback?: string }>} */
const templateThumbCache = new Map()

/** @type {Map<string, Promise<void>>} */
const inFlightRequests = new Map()

/**
 * Type check: is this source a template/cg/html type that needs the cg-thumb renderer?
 * Mirrors thumbnail-url.js:93 type checks.
 * @param {object | null | undefined} source
 * @returns {boolean}
 */
export function isTemplateSourceType(source) {
	if (!source?.value) return false
	const t = String(source.type || '').toLowerCase()
	return t === 'template' || t === 'cg' || t === 'html'
}

/**
 * Build cache key from source value and cgData.
 * @param {string} sourceValue
 * @param {object | null | undefined} cgData
 * @returns {string}
 */
function cacheKeyForTemplate(sourceValue, cgData) {
	const key = JSON.stringify({
		sourceValue: String(sourceValue || ''),
		cgData: cgData && typeof cgData === 'object' ? cgData : null,
	})
	// Use a hash-like truncation to keep key shorter
	let hash = 0
	for (let i = 0; i < key.length; i++) {
		hash = ((hash << 5) - hash) + key.charCodeAt(i)
		hash = hash & hash // Convert to 32bit integer
	}
	return `tmpl_${Math.abs(hash).toString(16)}`
}

/**
 * Extract cgData from layer (lower-third, countdown, or explicit cgData).
 * Mirrors cg-only-look-deck-thumb.js resolveLayerCgRenderPayload logic.
 * @param {object | null | undefined} layer
 * @returns {object | null}
 */
function extractCgDataFromLayer(layer) {
	if (!layer || typeof layer !== 'object') return null
	let cgData = resolveLayerLowerThirdCgData(layer)
	if (!cgData && layer.cgData && typeof layer.cgData === 'object') {
		cgData = layer.cgData
	} else if (!cgData && layer.templateData && typeof layer.templateData === 'object') {
		cgData = layer.templateData
	} else if (!cgData && layer.source?.data && typeof layer.source.data === 'object') {
		cgData = layer.source.data
	}
	return cgData || null
}

/**
 * Build render payload for POST /api/cg-thumb/render.
 * Reuses the logic from cg-only-look-deck-thumb.js resolveLayerCgRenderPayload.
 * @param {object} layer
 * @returns {{ sourceValue: string, templateId: string, cgData: object | null } | null}
 */
function buildRenderPayload(layer) {
	if (!layer || typeof layer !== 'object') return null
	const src = layer.source
	const sourceValue = src?.value != null ? String(src.value) : String(layer.template || '').trim()
	if (!sourceValue) return null
	const cgData = extractCgDataFromLayer(layer)
	const templateId = deriveTemplateId(sourceValue) || sourceValue.toLowerCase()
	return { sourceValue, templateId, cgData }
}

/**
 * Probe for static poster image at /templates/<dir>/thumbnails/<basename>.png.
 * Cached on first call (success or failure).
 * @param {string} sourceValue
 * @returns {Promise<string | null>}
 */
async function probePosterFallback(sourceValue) {
	const cacheKey = `poster_${sourceValue}`
	const entry = templateThumbCache.get(cacheKey)
	if (entry?.staticFallback !== undefined) {
		return entry.staticFallback
	}

	const parts = String(sourceValue || '').split('/').filter(Boolean)
	if (!parts.length) return null

	const basename = parts[parts.length - 1]
	const posterUrl = `/templates/${parts.slice(0, -1).join('/')}/thumbnails/${basename}.png`

	try {
		const res = await fetch(posterUrl, { method: 'HEAD' })
		if (res.ok) {
			if (!templateThumbCache.has(cacheKey)) {
				templateThumbCache.set(cacheKey, {})
			}
			const entry = templateThumbCache.get(cacheKey)
			entry.staticFallback = posterUrl
			return posterUrl
		}
	} catch {
		// Silently fail
	}

	// Cache the failure
	if (!templateThumbCache.has(cacheKey)) {
		templateThumbCache.set(cacheKey, {})
	}
	templateThumbCache.get(cacheKey).staticFallback = null
	return null
}

/**
 * Load image from URL and cache it.
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error('Template thumb image load failed'))
		img.src = url
	})
}

/**
 * Resolve template thumbnail URL asynchronously.
 *
 * Returns null immediately if already cached (via getCachedTemplateThumbUrl).
 * Otherwise fires onResolved(url) callback once resolved/failed.
 * Falls back to static poster path, then null.
 *
 * @param {object} layer — scene layer with source, cgData, etc.
 * @param {{ onResolved?: (url: string | null) => void }} [opts]
 * @returns {string | null} — cached URL if available, else null (use onResolved callback)
 */
export function getTemplateThumbUrl(layer, opts = {}) {
	if (!layer || typeof layer !== 'object') return null

	const onResolved = typeof opts.onResolved === 'function' ? opts.onResolved : () => {}
	const payload = buildRenderPayload(layer)
	if (!payload) return null

	const cacheKey = cacheKeyForTemplate(payload.sourceValue, payload.cgData)
	const entry = templateThumbCache.get(cacheKey)

	// Return cached URL if available
	if (entry?.url) {
		return entry.url
	}

	// If already loading, just register the callback (debounce in-flight requests)
	if (inFlightRequests.has(cacheKey)) {
		inFlightRequests.get(cacheKey).then(() => {
			const cached = templateThumbCache.get(cacheKey)
			onResolved(cached?.url || null)
		})
		return null
	}

	// Start new request
	const requestPromise = (async () => {
		try {
			// Try server renderer first
			const res = await apiPost('/api/cg-thumb/render', {
				sourceValue: payload.sourceValue,
				templateId: payload.templateId,
				cgData: payload.cgData,
			})

			if (res?.url) {
				const fullUrl = `${resolveApiUrl(res.url)}?t=${Date.now()}`

				// Cache and load image
				if (!templateThumbCache.has(cacheKey)) {
					templateThumbCache.set(cacheKey, {})
				}
				const cacheEntry = templateThumbCache.get(cacheKey)
				cacheEntry.url = fullUrl

				try {
					cacheEntry.img = await loadImage(fullUrl)
					cacheEntry.error = false
				} catch {
					cacheEntry.error = true
				}

				onResolved(fullUrl)
				return
			}
		} catch {
			// Silently fall through to poster fallback
		}

		// Try static poster fallback
		const posterUrl = await probePosterFallback(payload.sourceValue)
		if (posterUrl) {
			if (!templateThumbCache.has(cacheKey)) {
				templateThumbCache.set(cacheKey, {})
			}
			const cacheEntry = templateThumbCache.get(cacheKey)
			cacheEntry.url = posterUrl

			try {
				cacheEntry.img = await loadImage(posterUrl)
				cacheEntry.error = false
			} catch {
				cacheEntry.error = true
			}

			onResolved(posterUrl)
			return
		}

		// No URL found
		if (!templateThumbCache.has(cacheKey)) {
			templateThumbCache.set(cacheKey, {})
		}
		templateThumbCache.get(cacheKey).error = true
		onResolved(null)
	})()
		.finally(() => {
			inFlightRequests.delete(cacheKey)
		})

	inFlightRequests.set(cacheKey, requestPromise)

	return null
}

/**
 * Synchronous cached URL lookup for canvas rendering.
 * Returns null if not yet loaded or if loading failed.
 * @param {object} layer
 * @returns {string | null}
 */
export function getCachedTemplateThumbUrl(layer) {
	if (!layer || typeof layer !== 'object') return null
	const payload = buildRenderPayload(layer)
	if (!payload) return null
	const cacheKey = cacheKeyForTemplate(payload.sourceValue, payload.cgData)
	const entry = templateThumbCache.get(cacheKey)
	return entry?.url || null
}

/**
 * Get cached HTMLImageElement if available.
 * @param {object} layer
 * @returns {HTMLImageElement | null}
 */
export function getCachedTemplateThumbImage(layer) {
	if (!layer || typeof layer !== 'object') return null
	const payload = buildRenderPayload(layer)
	if (!payload) return null
	const cacheKey = cacheKeyForTemplate(payload.sourceValue, payload.cgData)
	const entry = templateThumbCache.get(cacheKey)
	return entry?.img || null
}

/**
 * Invalidate cached thumbnail for a layer (on cgData change).
 * @param {object} layer
 */
export function invalidateTemplateThumbForLayer(layer) {
	if (!layer || typeof layer !== 'object') return
	const payload = buildRenderPayload(layer)
	if (!payload) return
	const cacheKey = cacheKeyForTemplate(payload.sourceValue, payload.cgData)
	templateThumbCache.delete(cacheKey)
}

/** Test hook — clear in-memory template thumb cache. */
export function clearTemplateThumbCache() {
	templateThumbCache.clear()
	inFlightRequests.clear()
}
