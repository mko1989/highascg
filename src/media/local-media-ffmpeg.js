'use strict'

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { spawn } = require('child_process')

/** Bump when peak algorithm / bar semantics change (invalidates on-disk cache). */
const WAVEFORM_VERSION = 2

/** Bump when thumbnail ffmpeg args or quality change (invalidates on-disk thumbnail cache). */
const THUMBNAIL_VERSION = 1

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
 * @param {object} [config]
 * @returns {string}
 */
function getThumbnailCacheDir(config) {
	const raw = (config?.thumbnail_cache_path || '').trim()
	if (raw) return path.resolve(raw)
	return path.join(process.cwd(), 'data', 'thumbnails')
}

/**
 * @param {string} filePath
 * @param {import('fs').Stats} stat
 * @param {number} maxW
 * @param {number} seekSec
 * @returns {string}
 */
function thumbnailCacheKey(filePath, stat, maxW, seekSec) {
	const h = crypto.createHash('sha256')
	h.update(String(filePath).replace(/\\/g, '/'))
	h.update('\0')
	h.update(String(stat.mtimeMs))
	h.update('\0')
	h.update(String(stat.size))
	h.update('\0')
	h.update(String(maxW))
	h.update('\0')
	h.update(String(seekSec))
	h.update('\0')
	h.update(String(THUMBNAIL_VERSION))
	return h.digest('hex')
}

/**
 * @param {string} cacheDir
 * @param {string} key
 * @returns {Buffer | null}
 */
function readThumbnailCacheFile(cacheDir, key) {
	const fp = path.join(cacheDir, `${key}.png`)
	try {
		if (!fs.existsSync(fp)) return null
		const buf = fs.readFileSync(fp)
		return buf.length > 0 ? buf : null
	} catch {
		return null
	}
}

/**
 * @param {string} cacheDir
 * @param {string} key
 * @param {Buffer} data
 */
function writeThumbnailCacheFile(cacheDir, key, data) {
	try {
		fs.mkdirSync(cacheDir, { recursive: true })
		fs.writeFileSync(path.join(cacheDir, `${key}.png`), data)
	} catch {
		/* non-fatal: cache write failure is OK */
	}
}

/**
 * Extract a single PNG frame from a video/image file via ffmpeg.
 * @param {string} filePath
 * @param {number} [maxW=960] - maximum width in pixels
 * @param {number} [seekSec=2] - seek this many seconds into the file before grabbing the frame
 */
function extractThumbnailPng(filePath, maxW = 960, seekSec = 2) {
	const mw = Math.min(1920, Math.max(64, parseInt(String(maxW), 10) || 960))
	const ss = Math.max(0, Number.isFinite(Number(seekSec)) ? Number(seekSec) : 2)
	return new Promise((resolve) => {
		// Use input-side seek (-ss before -i) for fast seeking — ffmpeg seeks to the nearest
		// keyframe before the requested time, then decodes forward. For very short files or
		// still images this is harmless (just grabs the first/only frame).
		const args = [
			'-hide_banner',
			'-loglevel', 'error',
			...(ss > 0 ? ['-ss', String(ss)] : []),
			'-i', filePath,
			'-vf', `scale=${mw}:-2:flags=lanczos`,
			'-frames:v', '1',
			'-f', 'image2pipe',
			'-vcodec', 'png',
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
 * PNG thumbnail via ffmpeg from the same tree Caspar uses for media (when paths match this host).
 * Uses `local_media_path` when set; otherwise default ingest path (Linux `/opt/casparcg/media`, etc.)
 * — avoids Caspar’s HTTP media-server hop that can throw “Invalid Response” on :8000.
 * PNG thumbnail via ffmpeg from the same tree Caspar uses for media (when paths match this host).
 * Uses `local_media_path` when set; otherwise default ingest path (Linux `/opt/casparcg/media`, etc.)
 * — avoids Caspar's HTTP media-server hop that can throw "Invalid Response" on :8000.
 * Results are cached to disk (keyed by file path, mtime, size, maxW, seekSec).
 * @param {object} [config]
 * @param {string} filename
 * @param {number} [maxW=960]
 * @param {number} [seekSec=2]
 */
async function tryLocalThumbnailPng(config, filename, maxW = 960, seekSec = 2) {
	const { resolveSafe, getMediaIngestBasePath } = require('./local-media')
	if (!filename) return null
	const basePathRaw = (config?.local_media_path || '').trim()
	const basePath = basePathRaw || getMediaIngestBasePath(config)
	if (!basePath) return null
	const filePath = resolveSafe(basePath, filename)
	if (!filePath || !fs.existsSync(filePath)) return null
	try {
		const stat = fs.statSync(filePath)
		const cacheDir = getThumbnailCacheDir(config)
		const key = thumbnailCacheKey(filePath, stat, maxW, seekSec)
		const cached = readThumbnailCacheFile(cacheDir, key)
		if (cached) return cached
		const buf = await extractThumbnailPng(filePath, maxW, seekSec)
		if (buf && buf.length > 0) writeThumbnailCacheFile(cacheDir, key, buf)
		return buf
	} catch {
		return null
	}
}

module.exports = {
	WAVEFORM_VERSION,
	THUMBNAIL_VERSION,
	probeMedia,
	extractWaveform,
	parseWaveformBars,
	waveformCacheKey,
	getWaveformCacheDir,
	readWaveformCacheFile,
	writeWaveformCacheFile,
	getThumbnailCacheDir,
	thumbnailCacheKey,
	readThumbnailCacheFile,
	writeThumbnailCacheFile,
	extractThumbnailPng,
	tryLocalThumbnailPng,
}
