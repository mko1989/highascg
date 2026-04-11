/**
 * Local media: safe paths, ffprobe, ffmpeg thumbnails/waveform, GET /api/local-media/...
 * @see companion-module-casparcg-server/src/local-media.js
 */

'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { JSON_HEADERS, jsonBody } = require('../api/response')

/** Bump when peak algorithm / bar semantics change (invalidates on-disk cache). */
const WAVEFORM_VERSION = 2

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
	if (!full.startsWith(baseResolved) || full === baseResolved) return null
	return full
}

async function probeMedia(filePath) {
	return new Promise((resolve) => {
		const ff = spawn(
			'ffprobe',
			['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		)
		let out = ''
		ff.stdout?.on('data', (chunk) => {
			out += chunk
		})
		ff.stderr?.on('data', () => {})
		ff.on('error', () => resolve({}))
		ff.on('close', (code) => {
			if (code !== 0) {
				resolve({})
				return
			}
			try {
				const json = JSON.parse(out)
				const out2 = {}
				if (json.format?.duration) {
					out2.durationMs = Math.round(parseFloat(json.format.duration) * 1000)
				}
				if (json.format?.size != null) {
					out2.fileSize = parseInt(json.format.size, 10) || 0
				}
				const aud = (json.streams || []).find((s) => s.codec_type === 'audio')
				out2.hasAudio = !!aud
				const vid = (json.streams || []).find((s) => s.codec_type === 'video')
				if (vid?.width && vid?.height) {
					out2.resolution = `${vid.width}×${vid.height}`
				}
				if (vid?.codec_name) out2.codec = String(vid.codec_name).toLowerCase()
				if (vid?.r_frame_rate) {
					const [num, den] = String(vid.r_frame_rate).split('/').map(Number)
					if (num > 0 && den > 0) out2.fps = Math.round((num / den) * 100) / 100
				}
				resolve(out2)
			} catch {
				resolve({})
			}
		})
	})
}

async function extractWaveform(filePath, bars = 24) {
	return new Promise((resolve, reject) => {
		const args = ['-i', filePath, '-vn', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '8000', '-f', 's16le', '-']
		const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
		const chunks = []
		ff.stdout.on('data', (chunk) => chunks.push(chunk))
		ff.stderr.on('data', () => {})
		ff.on('error', (err) => reject(err))
		ff.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`ffmpeg exited ${code}`))
				return
			}
			const buf = Buffer.concat(chunks)
			const samples = []
			for (let i = 0; i < buf.length; i += 2) {
				samples.push(buf.readInt16LE(i))
			}
			if (samples.length === 0) {
				resolve(Array(bars).fill(0.1))
				return
			}
			const samplesPerBar = Math.max(1, Math.floor(samples.length / bars))
			const peaks = []
			let maxPeak = 0.01
			for (let b = 0; b < bars; b++) {
				const start = b * samplesPerBar
				const end = Math.min(start + samplesPerBar, samples.length)
				let sumSq = 0
				let n = 0
				for (let i = start; i < end; i++) {
					const v = samples[i] / 32768
					sumSq += v * v
					n++
				}
				const rms = n > 0 ? Math.sqrt(sumSq / n) : 0
				peaks.push(rms)
				if (rms > maxPeak) maxPeak = rms
			}
			const normalized = peaks.map((p) => Math.min(1, p / maxPeak))
			resolve(normalized)
		})
	})
}

function parseWaveformBars(query) {
	const raw = query && typeof query === 'object' ? query.bars : undefined
	const n = parseInt(String(raw ?? ''), 10)
	if (!Number.isFinite(n) || n < 1) return 128
	return Math.min(512, Math.max(8, Math.floor(n)))
}

/**
 * @param {string} filePath
 * @param {import('fs').Stats} stat
 * @param {number} bars
 */
function waveformCacheKey(filePath, stat, bars) {
	const h = crypto.createHash('sha256')
	h.update(String(filePath).replace(/\\/g, '/'))
	h.update('\0')
	h.update(String(stat.mtimeMs))
	h.update('\0')
	h.update(String(stat.size))
	h.update('\0')
	h.update(String(bars))
	h.update('\0')
	h.update(String(WAVEFORM_VERSION))
	return h.digest('hex')
}

/**
 * @param {object} [config]
 * @returns {string}
 */
function getWaveformCacheDir(config) {
	const raw = (config?.waveform_cache_path || '').trim()
	if (raw) return path.resolve(raw)
	return path.join(process.cwd(), 'data', 'waveforms')
}

/**
 * @param {string} cacheDir
 * @param {string} key
 * @param {import('fs').Stats} stat
 * @param {number} bars
 * @returns {{ peaks: number[], hasAudio: boolean, durationMs?: number } | null}
 */
function readWaveformCacheFile(cacheDir, key, stat, bars) {
	const fp = path.join(cacheDir, `${key}.json`)
	if (!fs.existsSync(fp)) return null
	try {
		const j = JSON.parse(fs.readFileSync(fp, 'utf8'))
		if (j.v !== WAVEFORM_VERSION) return null
		if (j.mtimeMs !== stat.mtimeMs || j.size !== stat.size || j.bars !== bars) return null
		const durationMs = typeof j.durationMs === 'number' && j.durationMs > 0 ? j.durationMs : undefined
		if (j.hasAudio === false) return { peaks: [], hasAudio: false, durationMs }
		if (!Array.isArray(j.peaks)) return null
		return { peaks: j.peaks, hasAudio: true, durationMs }
	} catch {
		return null
	}
}

/**
 * @param {string} cacheDir
 * @param {string} key
 * @param {import('fs').Stats} stat
 * @param {number} bars
 * @param {{ peaks: number[], hasAudio: boolean, durationMs?: number }} data
 */
function writeWaveformCacheFile(cacheDir, key, stat, bars, data) {
	fs.mkdirSync(cacheDir, { recursive: true })
	const fp = path.join(cacheDir, `${key}.json`)
	const payload = {
		v: WAVEFORM_VERSION,
		mtimeMs: stat.mtimeMs,
		size: stat.size,
		bars,
		hasAudio: data.hasAudio,
		peaks: data.peaks,
		...(typeof data.durationMs === 'number' && data.durationMs > 0 ? { durationMs: data.durationMs } : {}),
	}
	fs.writeFileSync(fp, JSON.stringify(payload))
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
async function handleLocalMedia(path, config, query) {
	const m = path.match(/^\/api\/local-media\/(.+)\/([^/]+)$/)
	if (!m) return null
	const [, filenameEnc, type] = m
	const filename = decodeURIComponent(filenameEnc)
	if (!filename || filename.includes('..')) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid filename' }) }
	}
	// Same default as ingest / GET /api/media disk scan — ffprobe works without explicit config on Linux.
	const basePathRaw = (config?.local_media_path || '').trim()
	const basePath = basePathRaw || getMediaIngestBasePath(config)
	const filePath = resolveSafe(basePath, filename)
	if (!filePath) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid path' }) }
	}
	if (!fs.existsSync(filePath)) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'File not found' }) }
	}
	/** Binary download to the browser (same tree as CLS / media browser). Must run before HANDLERS[type]. */
	if (type === 'file') {
		const stat = await fs.promises.stat(filePath)
		if (!stat.isFile()) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Not a file' }) }
		}
		const stream = fs.createReadStream(filePath)
		const disp = contentDispositionBasename(filename)
		return {
			status: 200,
			headers: {
				'Content-Type': contentTypeForFilename(filename),
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

function extractThumbnailPng(filePath, maxW = 720) {
	const mw = Math.min(1920, Math.max(64, parseInt(String(maxW), 10) || 720))
	return new Promise((resolve) => {
		const args = [
			'-hide_banner',
			'-loglevel',
			'error',
			'-i',
			filePath,
			'-vf',
			`scale=${mw}:-1:flags=lanczos`,
			'-frames:v',
			'1',
			'-f',
			'image2pipe',
			'-vcodec',
			'png',
			'pipe:1',
		]
		const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
		const chunks = []
		ff.stdout.on('data', (c) => chunks.push(c))
		ff.stderr.on('data', () => {})
		ff.on('error', () => resolve(null))
		ff.on('close', (code) => {
			if (code !== 0 || chunks.length === 0) return resolve(null)
			resolve(Buffer.concat(chunks))
		})
	})
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
])

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
	return String(id || '').replace(/\\/g, '/')
}

/**
 * PNG thumbnail via ffmpeg from the same tree Caspar uses for media (when paths match this host).
 * Uses `local_media_path` when set; otherwise default ingest path (Linux `/opt/casparcg/media`, etc.)
 * — avoids Caspar’s HTTP media-server hop that can throw “Invalid Response” on :8000.
 */
async function tryLocalThumbnailPng(config, filename, maxW = 720) {
	if (!filename) return null
	const basePathRaw = (config?.local_media_path || '').trim()
	const basePath = basePathRaw || getMediaIngestBasePath(config)
	if (!basePath) return null
	const filePath = resolveSafe(basePath, filename)
	if (!filePath || !fs.existsSync(filePath)) return null
	try {
		return await extractThumbnailPng(filePath, maxW)
	} catch {
		return null
	}
}

module.exports = {
	handleLocalMedia,
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
