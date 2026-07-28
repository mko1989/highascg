/**
 * WO-184: Thumbnail error handling with retry logic.
 * Prevents spam of failed thumbnail requests and implements delayed retry once.
 */

// Cache of URLs that have already been retried (avoid infinite retry loops)
const retriedUrls = new Set()

/**
 * Handle img load error with optional retry.
 * WO-184: single delayed retry (~1s) on img error for thumb URLs.
 * Cache failed URLs to avoid re-requesting every render.
 * @param {HTMLImageElement} img
 * @param {string} fallbackHtml - innerHTML to show on failure (e.g. '<i>🎬</i>')
 */
export function handleThumbnailError(img, fallbackHtml = '<i>🎬</i>') {
	const src = img.src
	if (!src) {
		// No src at all, just show fallback
		if (img.parentElement) img.parentElement.innerHTML = fallbackHtml
		return
	}

	// Check if we've already retried this URL
	if (retriedUrls.has(src)) {
		// Already retried, give up
		if (img.parentElement) img.parentElement.innerHTML = fallbackHtml
		return
	}

	// Mark as retried to prevent infinite loops
	retriedUrls.add(src)

	// Add cache-busting query param and retry after 1s delay
	setTimeout(() => {
		try {
			const url = new URL(src, window.location.origin)
			url.searchParams.set('_retry', Date.now().toString())
			const retriedSrc = url.toString()

			// Create new img element and try again
			const newImg = document.createElement('img')
			newImg.src = retriedSrc
			newImg.loading = 'lazy'

			// If retry fails, show fallback
			newImg.onerror = () => {
				if (img.parentElement) img.parentElement.innerHTML = fallbackHtml
			}

			// If retry succeeds, replace the original img
			newImg.onload = () => {
				if (img.parentElement) {
					img.parentElement.innerHTML = ''
					img.parentElement.appendChild(newImg)
				}
			}

			// Start loading
			newImg.src = retriedSrc
		} catch {
			// URL parsing failed, just show fallback
			if (img.parentElement) img.parentElement.innerHTML = fallbackHtml
		}
	}, 1000)
}

/**
 * Create an onerror handler function for thumbnail img tags.
 * @param {string} fallbackHtml
 * @returns {(ev: Event) => void}
 */
export function createThumbnailErrorHandler(fallbackHtml = '<i>🎬</i>') {
	return (ev) => {
		const img = ev.target
		if (img instanceof HTMLImageElement) {
			handleThumbnailError(img, fallbackHtml)
		}
	}
}
