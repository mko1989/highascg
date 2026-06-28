import { getApiBase } from './api-client.js'

/** @type {Map<string, HTMLImageElement | 'loading' | 'error'>} */
const _thumbCache = new Map()

/** @type {(() => void) | null} */
let _invalidateDraw = null

export function setCompanionFlagThumbInvalidate(fn) {
	_invalidateDraw = typeof fn === 'function' ? fn : null
}

export function invalidateCompanionFlagThumbs() {
	_thumbCache.clear()
	_invalidateDraw?.()
}

/**
 * @param {number} page
 * @param {number} row
 * @param {number} column
 * @param {number} [mtimeMs]
 */
export function companionButtonPreviewUrl(page, row, column, mtimeMs) {
	const base = `${getApiBase()}/api/companion/button-preview/${page}/${row}/${column}.jpg`
	if (mtimeMs) return `${base}?t=${Math.round(mtimeMs)}`
	return base
}

/**
 * @param {number} page
 * @param {number} row
 * @param {number} column
 */
export function getCachedCompanionFlagThumb(page, row, column) {
	const url = companionButtonPreviewUrl(page, row, column)
	const hit = _thumbCache.get(url)
	return hit instanceof HTMLImageElement ? hit : null
}

/**
 * @param {number} page
 * @param {number} row
 * @param {number} column
 * @param {(img: HTMLImageElement | null) => void} onLoaded
 * @param {number} [mtimeMs]
 */
export function loadCompanionFlagThumb(page, row, column, onLoaded, mtimeMs) {
	const url = companionButtonPreviewUrl(page, row, column, mtimeMs)
	const cached = _thumbCache.get(url)
	if (cached instanceof HTMLImageElement) {
		onLoaded(cached)
		return
	}
	if (cached === 'loading') return
	if (cached === 'error') {
		onLoaded(null)
		return
	}
	_thumbCache.set(url, 'loading')
	const img = new Image()
	img.onload = () => {
		_thumbCache.set(url, img)
		onLoaded(img)
	}
	img.onerror = () => {
		_thumbCache.set(url, 'error')
		onLoaded(null)
	}
	img.src = url
}
