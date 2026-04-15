/**
 * Local media: safe paths, ffprobe, ffmpeg thumbnails/waveform, GET /api/local-media/...
 * @see companion-module-casparcg-server/src/local-media.js
 */

'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const { JSON_HEADERS, jsonBody } = require('../api/response')
const {
	probeMedia,
	extractWaveform,
	parseWaveformBars,
	waveformCacheKey,
	getWaveformCacheDir,
	readWaveformCacheFile,
	writeWaveformCacheFile,
	extractThumbnailPng,
	tryLocalThumbnailPng,
	WAVEFORM_VERSION,
} = require('./local-media-ffmpeg')

function resolveSafe(basePath, filename) {
	if (!basePath || typeof basePath !== 'string') return null
	const cleanFilename = (filename || '')
		.replace(/\.\./g, '')
		.split(/[/\\]/)
		.filter(Boolean)
		.join(path.sep)
	if (!cleanFilename) return null
	const full = path.resolve(path.join(basePath, cleanFilename))
	const baseResolved = path.resolve(basePath)
	if (full === baseResolved) return null
	const rel = path.relative(baseResolved, full)
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
	return full
}

/**
 * @param {string} filename - relative media id / path
 * @returns {string}
 */
function contentTypeForFilename(filename) {
	const ext = path.extname(filename).toLowerCase()
	const M = {
		'.mp4': 'video/mp4',
		'.mov': 'video/quicktime',
		'.mxf': 'application/mxf',
		'.mkv': 'video/x-matroska',
		'.webm': 'video/webm',
		'.avi': 'video/x-msvideo',
		'.m4v': 'video/x-m4v',
		'.mpg': 'video/mpeg',
		'.mpeg': 'video/mpeg',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.bmp': 'image/bmp',
		'.svg': 'image/svg+xml',
		'.tga': 'image/tga',
		'.wav': 'audio/wav',
		'.mp3': 'audio/mpeg',
		'.aac': 'audio/aac',
		'.m4a': 'audio/mp4',
		'.flac': 'audio/flac',
	}
	return M[ext] || 'application/octet-stream'
}

/** ASCII-only filename for Content-Disposition (avoid header injection). */
function contentDispositionBasename(filename) {
	const base = path.basename(String(filename || 'download'))
	return base.replace(/[\r\n"]/g, '_').replace(/[^\x20-\x7E]/g, '_') || 'download'
}

const HANDLERS = {
	waveform: async (filePath, query, config) => {
		const bars = parseWaveformBars(query)
		const stat = fs.statSync(filePath)
		const cacheDir = getWaveformCacheDir(config)
		const key = waveformCacheKey(filePath, stat, bars)
		const hit = readWaveformCacheFile(cacheDir, key, stat, bars)
		if (hit) return hit

		const probe = await probeMedia(filePath)
		const durationMs = probe.durationMs > 0 ? probe.durationMs : undefined
		if (!probe.hasAudio) {
			writeWaveformCacheFile(cacheDir, key, stat, bars, { peaks: [], hasAudio: false, durationMs })
			return { peaks: [], hasAudio: false, ...(durationMs ? { durationMs } : {}) }
		}
		const peaks = await extractWaveform(filePath, bars)
		writeWaveformCacheFile(cacheDir, key, stat, bars, { peaks, hasAudio: true, durationMs })
		return { peaks, hasAudio: true, ...(durationMs ? { durationMs } : {}) }
	},
	probe: async (filePath) => probeMedia(filePath),
}

/**
 * GET /api/local-media/:filenameEnc/:type — filename may include slashes (encoded).
 */
async function handleLocalMedia(reqPath, config, query) {
	const m = reqPath.match(/^\/api\/local-media\/(.+)\/([^/]+)$/)
	if (!m) return null
	const [, filenameEnc, type] = m
	let filename
	try {
		filename = decodeURIComponent(filenameEnc)
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid path encoding' }) }
	}
	if (!filename || filename.includes('..')) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid filename' }) }
	}
	const filePath = resolveMediaFileOnDisk(config, filename)
	if (!filePath) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'File not found' }) }
	}
	/** Binary download to the browser (same tree as CLS / media browser). Must run before HANDLERS[type]. */
	if (type === 'file') {
		const stat = await fs.promises.stat(filePath)
		if (!stat.isFile()) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Not a file' }) }
		}
		const stream = fs.createReadStream(filePath)
		// Use resolved disk filename (has real extension) — CLS ids often lack extensions.
		const diskName = path.basename(filePath)
		const disp = contentDispositionBasename(diskName)
		return {
			status: 200,
			headers: {
				'Content-Type': contentTypeForFilename(diskName),
				'Content-Disposition': `attachment; filename="${disp}"`,
				'Content-Length': String(stat.size),
			},
			stream,
		}
	}
	const handler = HANDLERS[type]
	if (!handler) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: `Unknown type: ${type}` }) }
	}
	try {
		const data = await handler(filePath, query || {}, config)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
	} catch (e) {
		return {
			status: 502,
			headers: JSON_HEADERS,
			body: jsonBody({ error: e?.message || 'Waveform extraction failed' }),
		}
	}
}

/**
 * Unlink one media file by Caspar/media-browser id (same resolution as GET …/local-media/…/file).
 * @param {object} [config]
 * @param {string} rawId
 */
async function unlinkMediaById(config, rawId) {
	if (rawId == null || String(rawId).trim() === '' || String(rawId).includes('..')) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid id' }) }
	}
	const filePath = resolveMediaFileOnDisk(config, rawId)
	if (!filePath) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'File not found' }) }
	}
	try {
		await fs.promises.unlink(filePath)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, id: normalizeMediaIdKey(String(rawId)).trim() }) }
	} catch (e) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || 'Delete failed' }) }
	}
}

/**
 * DELETE /api/local-media/:filenameEnc — remove one file under the media tree (same lookup as GET …/file).
 * Prefer POST /api/media/delete with JSON { id } when paths contain slashes (some proxies mishandle %2F in URLs).
 * @param {string} reqPath - request path without query
 * @param {object} config
 * @returns {Promise<{ status: number, headers: object, body: string } | null>}
 */
async function handleDeleteLocalMedia(reqPath, config) {
	const m = reqPath.match(/^\/api\/local-media\/(.+)$/)
	if (!m) return null
	let filename
	try {
		filename = decodeURIComponent(m[1])
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid path encoding' }) }
	}
	return unlinkMediaById(config, filename)
}

/**
 * Same base directory as ingest (WeTransfer / URL download / upload).
 * When `local_media_path` is unset, matches default ingest: Linux `/opt/casparcg/media`, else `cwd/media`.
 * @param {object} [config]
 * @returns {string}
 */
function getMediaIngestBasePath(config) {
	const p = (config?.local_media_path || '').trim()
	if (p) return path.resolve(p)
	if (os.platform() === 'linux') return '/opt/casparcg/media'
	return path.join(process.cwd(), 'media')
}

/** @type {Set<string>} */
const _SCAN_EXT = new Set([
	'.mov',
	'.mp4',
	'.mxf',
	'.mkv',
	'.avi',
	'.webm',
	'.m4v',
	'.mpg',
	'.mpeg',
	'.png',
	'.jpg',
	'.jpeg',
	'.tga',
	'.gif',
	'.bmp',
	'.svg',
	'.wav',
	'.mp3',
	'.aac',
	'.m4a',
	'.flac',
	'.ts',
	'.m2ts',
	'.mts',
])

/**
 * Resolve a media id to an absolute file path on disk.
 * Tries configured folder, full ingest base, then platform default ingest folder.
 * If the basename has no extension (Caspar CLS often omits it), tries known media extensions.
 * @param {object} [config]
 * @param {string} filename - relative id (Caspar path)
 * @returns {string|null}
 */
function resolveMediaFileOnDisk(config, filename) {
	const idNorm = normalizeMediaIdKey(filename).trim()
	if (!idNorm || idNorm.includes('..')) return null
	/** NFC/NFD can differ between Caspar id and filesystem (esp. Polish/diacritics). */
	const rawVariants = [...new Set([idNorm, idNorm.normalize('NFC'), idNorm.normalize('NFD')].filter((s) => s && !s.includes('..')))]
	const seenBase = new Set()
	const candidates = []
	for (const idv of rawVariants) {
		/** Caspar CLS often lists files as MEDIA/foo.mp4 while the file on disk is foo.mp4 (media root is already MEDIA). */
		const baseIds = [idv]
		if (/^MEDIA\//i.test(idv)) {
			baseIds.push(idv.replace(/^MEDIA\//i, ''))
		} else {
			baseIds.push('MEDIA/' + idv)
		}
		for (const base of baseIds) {
			if (seenBase.has(base)) continue
			seenBase.add(base)
			const leaf = base.split('/').pop() || base
			candidates.push(base)
			if (!path.extname(leaf)) {
				for (const ext of _SCAN_EXT) {
					candidates.push(base + ext)
				}
			}
		}
	}
	const cfg = config || {}
	const bases = []
	const cfgPath = (cfg.local_media_path || '').trim()
	if (cfgPath) bases.push(path.resolve(cfgPath))
	bases.push(getMediaIngestBasePath(cfg))
	bases.push(getMediaIngestBasePath({ ...cfg, local_media_path: '' }))
	const seenBases = new Set()
	for (const b of bases) {
		const r = path.resolve(b)
		if (seenBases.has(r)) continue
		seenBases.add(r)
		for (const cand of candidates) {
			const fp = resolveSafe(r, cand)
			if (!fp) continue
			try {
				if (!fs.existsSync(fp)) continue
				const st = fs.statSync(fp)
				if (st.isFile()) return fp
			} catch {
				/* ignore */
			}
		}
	}
	/** CLS id may omit subfolders (e.g. file under MEDIA/RECORDINGS/) or differ slightly from disk layout. */
	const leafHints = new Set()
	for (const idv of rawVariants) {
		const a = idv.split('/').pop()
		if (a) leafHints.add(a)
		const b = idv.replace(/^MEDIA\//i, '').split('/').pop()
		if (b) leafHints.add(b)
	}
	const leafHintsArr = [...leafHints]
	for (const b of bases) {
		const r = path.resolve(b)
		if (!fs.existsSync(r)) continue
		try {
			if (!fs.statSync(r).isDirectory()) continue
		} catch {
			continue
		}
		for (const stem of leafHintsArr) {
			if (!stem) continue
			const hit = findFileByStemUnderDir(r, stem)
			if (hit) return hit
		}
	}
	return null
}

/**
 * Depth-first search for a file whose basename (without extension) matches stemHint (case-insensitive).
 * Caps work so huge media trees do not block the server.
 * @param {string} dir
 * @param {string} stemHint
 * @returns {string|null}
 */
function findFileByStemUnderDir(dir, stemHint) {
	const want = String(stemHint || '')
		.normalize('NFC')
		.toLowerCase()
	if (!want) return null
	let scanned = 0
	const maxScan = 8000
	const maxDepth = 12
	function walk(d, depth) {
		if (depth > maxDepth || scanned > maxScan) return null
		let entries
		try {
			entries = fs.readdirSync(d, { withFileTypes: true })
		} catch {
			return null
		}
		for (const ent of entries) {
			if (scanned > maxScan) return null
			scanned++
			const full = path.join(d, ent.name)
			if (ent.isDirectory()) {
				if (ent.name.startsWith('.')) continue
				const hit = walk(full, depth + 1)
				if (hit) return hit
			} else if (ent.isFile()) {
				const stem = path.parse(ent.name).name.normalize('NFC').toLowerCase()
				if (stem === want) return full
			}
		}
		return null
	}
	return walk(dir, 0)
}

/**
 * Recursive scan for browser list — relative paths with `/` (Caspar CLS style).
 * Skips dotfiles / dotdirs. Caps file count for very large trees.
 * @param {string} basePath
 * @param {number} [maxFiles]
 * @returns {string[]}
 */
function scanMediaRecursiveForBrowser(basePath, maxFiles = 2500) {
	const out = []
	if (!basePath || !fs.existsSync(basePath)) return out
	const stat = fs.statSync(basePath)
	if (!stat.isDirectory()) return out

	function walk(relDir) {
		if (out.length >= maxFiles) return
		const full = path.join(basePath, relDir)
		let entries
		try {
			entries = fs.readdirSync(full, { withFileTypes: true })
		} catch {
			return
		}
		for (const ent of entries) {
			if (out.length >= maxFiles) return
			const name = ent.name
			if (name.startsWith('.')) continue
			const rel = relDir ? `${relDir}/${name}` : name
			if (ent.isDirectory()) {
				walk(rel)
			} else {
				const ext = path.extname(name).toLowerCase()
				if (_SCAN_EXT.has(ext)) out.push(rel.replace(/\\/g, '/'))
			}
		}
	}
	walk('')
	return out.sort((a, b) => a.localeCompare(b))
}

/**
 * Normalize id for deduping CLS vs disk (slashes only; preserve case).
 * @param {string} id
 */
function normalizeMediaIdKey(id) {
	return String(id || '')
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
}

module.exports = {
	handleLocalMedia,
	handleDeleteLocalMedia,
	unlinkMediaById,
	resolveMediaFileOnDisk,
	probeMedia,
	resolveSafe,
	extractThumbnailPng,
	tryLocalThumbnailPng,
	extractWaveform,
	getMediaIngestBasePath,
	getWaveformCacheDir,
	scanMediaRecursiveForBrowser,
	normalizeMediaIdKey,
	WAVEFORM_VERSION,
}
