import { getApiBase } from './api-client.js'

/** @type {Map<string, HTMLImageElement | 'loading' | 'error'>} */
const _thumbCache = new Map()

/**
 * Latest SUB-STATE mtime per button (from the companion.buttonPreview WS event). Used as the
 * cache-buster so a live Companion change re-fetches past the browser HTTP cache — without
 * it, thumbs only refreshed on a full page reload (todos06.08 "update live").
 * @type {Map<string, number>}
 */
const _latestMtime = new Map()

export function noteCompanionButtonPreviewUpdate(page, row, column, mtimeMs) {
	if (Number.isFinite(Number(mtimeMs))) _latestMtime.set(`${page}/${row}/${column}`, Number(mtimeMs))
}

function latestMtimeFor(page, row, column) {
	return _latestMtime.get(`${page}/${row}/${column}`)
}

/**
 * WO-535: the timeline flag thumb has always cache-busted with this mtime; the flag INSPECTOR built
 * its first `<img>` src with no buster at all, so the browser's cached copy of that jpg — from
 * whenever the button last looked different — was what the operator saw. Owner 14.08: *"the flag
 * correctly displays the current display of the button, but inside the inspector it shows a stale
 * button display."* Exported so both surfaces bust on the same value.
 * @param {number} page @param {number} row @param {number} column
 * @returns {number | undefined}
 */
export function latestCompanionButtonPreviewMtime(page, row, column) {
	return latestMtimeFor(page, row, column)
}

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
	const url = companionButtonPreviewUrl(page, row, column, latestMtimeFor(page, row, column))
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
	const url = companionButtonPreviewUrl(page, row, column, mtimeMs ?? latestMtimeFor(page, row, column))
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
