'use strict'

/**
 * WO-603 — server copy of client/lib/media-exists.js (WO-360): is a clip value known to Caspar? Case-insensitive,
 * extension-stripped, basename fallback — tolerant the same way playout is. Pure: callers pass the media list
 * (getRawMediaCatalog) and reuse the index while it is current.
 *
 * clipMissing(value, index):
 *   true  — a plain media value that is NOT in the media list (⚠)
 *   false — found (or basename-matched)
 *   null  — not a judgeable media value (templates/shaders, route://, live, html, color, placeholders) or no list
 */

const NON_MEDIA_RE = /^(route:\/\/|\[html\]|https?:\/\/|decklink|live|color|#)/i
const TEMPLATE_PATH_RE = /(^|\/)(shaders|lower-thirds|lower_thirds|studio|countdown|loop-io|html)\//i

function norm(v) {
	return String(v || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/\.[a-z0-9]{2,4}$/i, '')
		.toLowerCase()
}

function baseOf(v) {
	const n = norm(v)
	return n.split('/').filter(Boolean).pop() || n
}

/** @param {Array<{ id?: string, name?: string }>} media */
function buildMediaIndex(media) {
	const ids = new Set()
	const basenames = new Set()
	for (const m of media || []) {
		const id = norm(m?.id ?? m?.name)
		if (!id) continue
		ids.add(id)
		basenames.add(baseOf(id))
	}
	return { ids, basenames, ready: ids.size > 0 }
}

/** @returns {boolean|null} */
function clipMissing(value, index) {
	const raw = String(value || '').trim()
	if (!raw || !index?.ready) return null
	if (NON_MEDIA_RE.test(raw) || TEMPLATE_PATH_RE.test(raw)) return null
	const n = norm(raw)
	if (index.ids.has(n)) return false
	if (index.basenames.has(baseOf(n))) return false
	return true
}

module.exports = { buildMediaIndex, clipMissing }
