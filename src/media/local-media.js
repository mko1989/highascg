/**
 * Local media: safe paths, ffprobe, ffmpeg thumbnails/waveform, GET /api/local-media/...
 * @see companion-module-casparcg-server/src/local-media.js
 */

'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const { JSON_HEADERS, jsonBody } = require('../api/response')

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

const HANDLERS = {
	waveform: async (filePath) => {
		const peaks = await extractWaveform(filePath, 24)
		return { peaks }
	},
	probe: async (filePath) => probeMedia(filePath),
}

/**
 * GET /api/local-media/:filenameEnc/:type — filename may include slashes (encoded).
 */
async function handleLocalMedia(path, config) {
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
	const handler = HANDLERS[type]
	if (!handler) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: `Unknown type: ${type}` }) }
	}
	const filePath = resolveSafe(basePath, filename)
	if (!filePath) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid path' }) }
	}
	if (!fs.existsSync(filePath)) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'File not found' }) }
	}
	try {
		const data = await handler(filePath)
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
	scanMediaRecursiveForBrowser,
	normalizeMediaIdKey,
}
