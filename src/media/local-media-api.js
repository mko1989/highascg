/**
 * Local media HTTP handlers and file mutations.
 */
'use strict'

const path = require('path')
const fs = require('fs')

const { JSON_HEADERS, jsonBody } = require('../api/response')
const {
	probeMedia,
	extractWaveform,
	parseWaveformBars,
	waveformCacheKey,
	getWaveformCacheDir,
	readWaveformCacheFile,
	writeWaveformCacheFile,
} = require('./local-media-ffmpeg')
const {
	resolveSafe,
	getMediaIngestBasePath,
	normalizeMediaIdKey,
	resolveMediaFileOnDisk,
} = require('./local-media-paths')

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
	if (type === 'file') {
		const stat = await fs.promises.stat(filePath)
		if (!stat.isFile()) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Not a file' }) }
		}
		const stream = fs.createReadStream(filePath)
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

async function unlinkMediaById(config, rawId) {
	if (rawId == null || String(rawId).trim() === '' || String(rawId).includes('..')) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid id' }) }
	}
	let filePath = resolveMediaFileOnDisk(config, rawId)
	if (!filePath) {
		const base = getMediaIngestBasePath(config)
		const safe = resolveSafe(base, rawId)
		if (safe && fs.existsSync(safe) && fs.statSync(safe).isDirectory()) {
			filePath = safe
		}
	}
	if (!filePath) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'File not found' }) }
	}
	try {
		const stat = await fs.promises.stat(filePath)
		if (stat.isDirectory()) {
			await fs.promises.rm(filePath, { recursive: true, force: true })
		} else {
			await fs.promises.unlink(filePath)
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, id: normalizeMediaIdKey(String(rawId)).trim() }) }
	} catch (e) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || 'Delete failed' }) }
	}
}

function normalizeTargetFolderId(targetId) {
	return String(targetId ?? '')
		.replace(/\\/g, '/')
		.trim()
		.replace(/^MEDIA\//i, '')
		.replace(/\/+$/, '')
}

function mediaParentId(sourceId) {
	const norm = normalizeMediaIdKey(sourceId).replace(/\/+$/, '')
	const idx = norm.lastIndexOf('/')
	if (idx <= 0) return ''
	return norm.slice(0, idx)
}

function isDescendantFolderPath(ancestorId, maybeChildId) {
	const a = normalizeMediaIdKey(ancestorId).replace(/\/+$/, '')
	const c = normalizeMediaIdKey(maybeChildId).replace(/\/+$/, '')
	if (!a || !c) return false
	return c === a || c.startsWith(`${a}/`)
}

function resolveTargetFolderOnDisk(base, targetId) {
	const norm = normalizeTargetFolderId(targetId)
	if (!norm) return path.resolve(base)
	const dest = resolveSafe(base, norm)
	if (!dest) return null
	if (fs.existsSync(dest) && !fs.statSync(dest).isDirectory()) return null
	return dest
}

function resolveDestinationFilePath(base, sourceId, targetId, srcPath) {
	const folder = resolveTargetFolderOnDisk(base, targetId)
	if (!folder) return { error: 'Invalid target path', status: 400 }
	const dest = path.join(folder, path.basename(srcPath))
	const relUnderBase = path.relative(path.resolve(base), dest).split(path.sep).join('/')
	if (!relUnderBase || relUnderBase.startsWith('..')) {
		return { error: 'Invalid target path', status: 400 }
	}
	return { dest, relUnderBase }
}

function validateFileTransfer(sourceId, targetId, srcPath) {
	const parent = mediaParentId(sourceId)
	const targetNorm = normalizeTargetFolderId(targetId)
	if (targetNorm === parent) {
		return { error: 'Source is already in target folder', status: 400 }
	}
	if (isDescendantFolderPath(sourceId, targetNorm)) {
		return { error: 'Cannot move or copy into a descendant folder', status: 400 }
	}
	try {
		if (fs.statSync(srcPath).isDirectory()) {
			return { error: 'Folder transfer is not supported via file ops', status: 400 }
		}
	} catch {
		return { error: 'Source not found', status: 404 }
	}
	return null
}

async function createMediaFolder(config, rawPath) {
	const base = getMediaIngestBasePath(config)
	const full = resolveSafe(base, rawPath)
	if (!full) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid folder path' }) }
	try {
		if (fs.existsSync(full)) {
			const st = fs.statSync(full)
			if (st.isDirectory()) {
				return {
					status: 409,
					headers: JSON_HEADERS,
					body: jsonBody({ error: 'Folder already exists', path: normalizeMediaIdKey(rawPath) }),
				}
			}
			return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'Path exists as a file' }) }
		}
		await fs.promises.mkdir(full, { recursive: true })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, path: normalizeMediaIdKey(rawPath) }) }
	} catch (e) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || 'Mkdir failed' }) }
	}
}

async function moveFileAcrossDevices(src, dest) {
	try {
		await fs.promises.rename(src, dest)
		return { removedSource: true }
	} catch (e) {
		if (e?.code !== 'EXDEV') throw e
	}
	const st = await fs.promises.stat(src)
	if (st.isDirectory()) {
		throw new Error(
			'Cannot move a folder across volumes (squashfs/overlay ↔ exFAT). Move files individually or copy the folder on the stick.',
		)
	}
	await fs.promises.mkdir(path.dirname(dest), { recursive: true })
	await fs.promises.copyFile(src, dest)
	try {
		await fs.promises.unlink(src)
		return { removedSource: true, crossDevice: true }
	} catch (unlinkErr) {
		if (unlinkErr?.code === 'EROFS' || unlinkErr?.code === 'EPERM') {
			return {
				removedSource: false,
				crossDevice: true,
				warning:
					'File copied to exFAT but the original could not be removed (read-only main media). Delete it manually or boot Live with persistence.',
			}
		}
		throw unlinkErr
	}
}

async function moveMediaFile(config, sourceId, targetId) {
	const base = getMediaIngestBasePath(config)
	const src = resolveMediaFileOnDisk(config, sourceId)
	if (!src) return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Source not found' }) }

	const invalid = validateFileTransfer(sourceId, targetId, src)
	if (invalid) {
		return { status: invalid.status, headers: JSON_HEADERS, body: jsonBody({ error: invalid.error }) }
	}

	const resolved = resolveDestinationFilePath(base, sourceId, targetId, src)
	if (resolved.error) {
		return { status: resolved.status, headers: JSON_HEADERS, body: jsonBody({ error: resolved.error }) }
	}
	const { dest, relUnderBase } = resolved

	if (fs.existsSync(dest)) {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'Destination file already exists' }) }
	}

	try {
		await fs.promises.mkdir(path.dirname(dest), { recursive: true })
		const moveResult = await moveFileAcrossDevices(src, dest)
		const body = {
			ok: true,
			source: sourceId,
			target: targetId,
			id: relUnderBase,
			...(moveResult.crossDevice ? { crossDevice: true } : {}),
			...(moveResult.warning ? { warning: moveResult.warning } : {}),
			...(moveResult.removedSource === false ? { copiedOnly: true } : {}),
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(body) }
	} catch (e) {
		const msg = e?.message || 'Move failed'
		const hint =
			msg.includes('EXDEV') || msg.includes('cross')
				? ' Move between main media and exFAT uses copy; ensure HIGHASCGEXF is mounted (Settings → media).'
				: ''
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: msg + hint }) }
	}
}

async function copyMediaFile(config, sourceId, targetId) {
	const base = getMediaIngestBasePath(config)
	const src = resolveMediaFileOnDisk(config, sourceId)
	if (!src) return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Source not found' }) }

	const invalid = validateFileTransfer(sourceId, targetId, src)
	if (invalid) {
		return { status: invalid.status, headers: JSON_HEADERS, body: jsonBody({ error: invalid.error }) }
	}

	const resolved = resolveDestinationFilePath(base, sourceId, targetId, src)
	if (resolved.error) {
		return { status: resolved.status, headers: JSON_HEADERS, body: jsonBody({ error: resolved.error }) }
	}
	const { dest, relUnderBase } = resolved

	if (fs.existsSync(dest)) {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'Destination file already exists' }) }
	}

	try {
		await fs.promises.mkdir(path.dirname(dest), { recursive: true })
		await fs.promises.copyFile(src, dest)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, source: sourceId, target: targetId, id: relUnderBase }),
		}
	} catch (e) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || 'Copy failed' }) }
	}
}

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

module.exports = {
	handleLocalMedia,
	handleDeleteLocalMedia,
	unlinkMediaById,
	createMediaFolder,
	moveMediaFile,
	copyMediaFile,
	normalizeTargetFolderId,
	mediaParentId,
	isDescendantFolderPath,
}
