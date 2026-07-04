'use strict'

const fs = require('fs')
const path = require('path')
const { canonicalMediaBasenameKey } = require('../utils/media-browser-dedupe')
const { resolveSafe } = require('./local-media-paths')
const {
	expandMediaIdToMediaRoot,
	getActiveProjectSlug,
	getProjectMediaRoot,
	isProjectScopedMediaEnabled,
	normalizeMediaIdForProject,
} = require('./project-media-root')

/** Last-segment extensions Caspar strips from CLS media ids. */
const MEDIA_FILE_EXT = /\.(mov|qt|mp4|mxf|mkv|avi|webm|m4v|mpg|mpeg|png|jpe?g|tga|gif|bmp|svg|wav|mp3|aac|m4a|flac|ts|m2ts|mts)$/i

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

/**
 * Clips that must not be rewritten for LOADBG/PLAY (routes, HTML, templates, URLs).
 * @param {string} id
 * @returns {boolean}
 */
function isPassthroughAmcpClip(id) {
	const s = normalizeCasparMediaPath(id)
	if (!s) return true
	if (/^route:\/\//i.test(s)) return true
	if (/^alsa:/i.test(s)) return true
	if (/^v4l2:/i.test(s)) return true
	if (/^udp:/i.test(s)) return true
	if (/^dshow:/i.test(s)) return true
	if (/^iec61883:/i.test(s)) return true
	if (/^rtsp:/i.test(s)) return true
	if (/^rtmp:/i.test(s)) return true
	if (/^\[HTML\]/i.test(s)) return true
	if (/^https?:\/\//i.test(s)) return true
	if (/^ndi:\/\//i.test(s)) return true
	if (/^CASPARCG-/i.test(s)) return true
	return false
}

/**
 * True when the clip file is on disk under media/projects/<slug>/ (not just media root).
 * @param {string} raw
 * @param {string} slug
 * @param {{ config?: object, persistence?: object } | null | undefined} ctx
 * @returns {boolean}
 */
function clipFileExistsUnderProjectRoot(raw, slug, ctx) {
	if (!raw || !slug || !ctx?.config) return false
	const projectRoot = getProjectMediaRoot(ctx.config, ctx.persistence, slug)
	if (!projectRoot) return false
	const rel = normalizeMediaIdForProject(raw, slug, ctx.config)
	if (rel) {
		const abs = resolveSafe(projectRoot, rel)
		if (abs) {
			try {
				if (fs.statSync(abs).isFile()) return true
			} catch {
				/* try extension / stem resolution below */
			}
		}
	}
	const { resolveMediaFileOnDisk } = require('./local-media-paths')
	const expanded = expandMediaIdToMediaRoot(raw, slug, ctx.config)
	const abs =
		resolveMediaFileOnDisk(ctx.config, expanded) ||
		resolveMediaFileOnDisk(ctx.config, raw) ||
		null
	if (!abs) return false
	const relToProject = path.relative(projectRoot, abs)
	return Boolean(relToProject && !relToProject.startsWith('..') && !path.isAbsolute(relToProject))
}

/**
 * Locate clip on disk under media/ and return its Caspar CLS id (handles basename-only refs
 * and project paths when active slug or CLS catalog disagree with on-disk layout).
 * @param {string} raw
 * @param {object} [config]
 * @returns {string | null}
 */
function resolveClipFromMediaDisk(raw, config) {
	if (!raw || !config) return null
	const { resolveMediaFileOnDisk, getMediaIngestBasePath } = require('./local-media-paths')
	const attempts = []
	const seen = new Set()
	const add = (id) => {
		const s = normalizeCasparMediaPath(id)
		if (!s || seen.has(s)) return
		seen.add(s)
		attempts.push(s)
	}
	add(raw)
	const norm = normalizeCasparMediaPath(raw)
	if (norm.includes('/')) add(stripMediaFileExtension(norm))
	const leaf = stripMediaFileExtension(norm).split('/').pop()
	if (leaf) add(leaf)
	for (const attempt of attempts) {
		const abs = resolveMediaFileOnDisk(config, attempt)
		if (!abs) continue
		const mediaRoot = getMediaIngestBasePath(config)
		const rel = path.relative(mediaRoot, abs).replace(/\\/g, '/')
		if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
		return toCasparClsMediaId(rel)
	}
	return null
}

/**
 * Scene/project clip value → Caspar CLS id for LOADBG/PLAY/CINF.
 * Basenames like `252166.mp4` expand to `PROJECTS/<SLUG>/252166` when the file lives
 * under that project folder. Clips at media root (e.g. preview renders) keep root CLS ids.
 * @param {string} id
 * @param {{ CHOICES_MEDIAFILES?: Array<{ id?: string, label?: string }>, config?: object, persistence?: object } | null | undefined} [ctx]
 * @returns {string}
 */
function resolveClipForAmcpLoad(id, ctx) {
	const raw = normalizeCasparMediaPath(id)
	if (!raw || isPassthroughAmcpClip(raw)) return raw

	// Prefer active project folder when the file is on disk there (WO-62). After restart,
	// CLS catalog basename matches (e.g. BRIDGE/…) must not override project-scoped refs.
	if (ctx?.config && isProjectScopedMediaEnabled(ctx.config)) {
		const slug = getActiveProjectSlug(ctx.persistence)
		if (slug) {
			const expanded = expandMediaIdToMediaRoot(raw, slug, ctx.config)
			const clsId = toCasparClsMediaId(expanded)
			if (clsId.includes('/') && clipFileExistsUnderProjectRoot(raw, slug, ctx)) {
				return clsId
			}
		}
	}

	const fromDisk = resolveClipFromMediaDisk(raw, ctx?.config)
	if (fromDisk) return fromDisk

	const fromCatalog = resolveCasparCinfMediaId(raw, ctx)
	if (isPassthroughAmcpClip(fromCatalog)) return fromCatalog
	return toCasparClsMediaId(fromCatalog)
}

module.exports = {
	normalizeCasparMediaPath,
	stripMediaFileExtension,
	toCasparClsMediaId,
	resolveCasparCinfMediaId,
	isPassthroughAmcpClip,
	resolveClipForAmcpLoad,
}
