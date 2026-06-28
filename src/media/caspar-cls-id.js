'use strict'

const { canonicalMediaBasenameKey } = require('../utils/media-browser-dedupe')

/** Last-segment extensions Caspar strips from CLS media ids. */
const MEDIA_FILE_EXT = /\.(mov|mp4|mxf|mkv|avi|webm|m4v|mpg|mpeg|png|jpe?g|tga|gif|bmp|svg|wav|mp3|aac|m4a|flac|ts|m2ts|mts)$/i

/**
 * @param {string} id
 * @returns {string}
 */
function normalizeCasparMediaPath(id) {
	const s = String(id || '')
		.replace(/^"(.*)"$/, '$1')
		.trim()
		.replace(/\\/g, '/')
		.normalize('NFC')
	if (/^route:/i.test(s)) return s
	return s.replace(/\/+/g, '/').replace(/^\/+/, '')
}

/**
 * Remove a trailing media file extension from the last path segment (Caspar CLS ids omit it).
 * @param {string} id
 * @returns {string}
 */
function stripMediaFileExtension(id) {
	const path = normalizeCasparMediaPath(id)
	if (!path) return ''
	const parts = path.split('/')
	const last = parts[parts.length - 1]
	if (!last || !MEDIA_FILE_EXT.test(last)) return path
	parts[parts.length - 1] = last.replace(MEDIA_FILE_EXT, '')
	return parts.join('/')
}

/**
 * Disk/browser id → Caspar CLS / CINF id (uppercase segments, no extension).
 * @param {string} id
 * @returns {string}
 */
function toCasparClsMediaId(id) {
	const path = stripMediaFileExtension(id)
	if (!path) return ''
	if (/^route:\/\//i.test(path)) return path
	if (/^CASPARCG-/i.test(path)) return path
	return path
		.split('/')
		.filter(Boolean)
		.map((seg) => seg.toUpperCase())
		.join('/')
}

/**
 * Resolve the best Caspar CINF id: exact CLS row when known, else normalized CLS form.
 * @param {string} id
 * @param {{ CHOICES_MEDIAFILES?: Array<{ id?: string, label?: string }> } | null | undefined} [ctx]
 * @returns {string}
 */
function resolveCasparCinfMediaId(id, ctx) {
	const raw = normalizeCasparMediaPath(id)
	if (!raw || /^route:\/\//i.test(raw)) return raw
	if (/^CASPARCG-/i.test(raw)) return raw

	const files = Array.isArray(ctx?.CHOICES_MEDIAFILES) ? ctx.CHOICES_MEDIAFILES : []
	for (const row of files) {
		const cid = String(row?.id || row?.label || '').trim()
		if (!cid) continue
		if (cid === raw) return cid
		if (normalizeCasparMediaPath(cid) === raw) return cid
	}

	const clsId = toCasparClsMediaId(raw)
	for (const row of files) {
		const cid = String(row?.id || row?.label || '').trim()
		if (!cid) continue
		if (cid === clsId || toCasparClsMediaId(cid) === clsId) return cid
	}

	const wantBase = canonicalMediaBasenameKey(raw)
	if (wantBase) {
		for (const row of files) {
			const cid = String(row?.id || row?.label || '').trim()
			if (!cid) continue
			if (canonicalMediaBasenameKey(cid) === wantBase) return cid
		}
	}

	return clsId
}

module.exports = {
	normalizeCasparMediaPath,
	stripMediaFileExtension,
	toCasparClsMediaId,
	resolveCasparCinfMediaId,
}
