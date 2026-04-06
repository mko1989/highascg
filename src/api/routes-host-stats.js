/**
 * GET /api/host-stats — CPU load, RAM, media volume + optional folder size, GPU probe (no Caspar AMCP by default).
 *
 * - **Preshow (offline_mode):** no host probing — returns a small stub (laptop / draft).
 * - **Production:** `os` + one `statfs` + optional `nvidia-smi` (cached a few seconds).
 * - **Caspar `GL INFO`:** only when `HIGHASCG_HOST_STATS_GL_INFO=1` (or `host_stats.gl_info_via_amcp`) — hits AMCP and spams Caspar logs.
 * - **Folder size (`du`):** off by default; opt-in via `host_stats.scan_folder` or `HIGHASCG_HOST_STATS_DU=1` — can be IO-heavy.
 */

'use strict'

const os = require('os')
const fs = require('fs')
const fsPromises = fs.promises
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

const { JSON_HEADERS, jsonBody } = require('./response')
const { getMediaIngestBasePath } = require('../media/local-media')

/** @type {{ text: string|null, at: number, utilizationPct?: number|null, source?: string|null }} */
let _gpuCache = { text: null, at: 0, utilizationPct: null, source: null }
/** @type {{ text: string|null, at: number }} */
let _glCache = { text: null, at: 0 }
/** @type {{ path: string, bytes: number|null, at: number }} */
let _duCache = { path: '', bytes: null, at: 0 }

const GPU_TTL_MS = 5000
const GL_TTL_MS = 5000
const DU_TTL_MS = 90_000

/**
 * @param {string} mediaPath
 * @returns {Promise<number|null>}
 */
async function gatherMediaDirSizeOnce(mediaPath) {
	if (!mediaPath || !fs.existsSync(mediaPath)) return null
	try {
		if (process.platform === 'win32') return null
		const args = process.platform === 'darwin' ? ['-sk', mediaPath] : ['-sb', mediaPath]
		const { stdout } = await execFileAsync('du', args, { timeout: 8000, maxBuffer: 2e6 })
		const line = String(stdout).trim().split('\n').pop() || ''
		const first = line.split(/\s|\t/)[0]
		const n = parseInt(first, 10)
		if (Number.isNaN(n)) return null
		return process.platform === 'darwin' ? n * 1024 : n
	} catch {
		return null
	}
}

/**
 * @param {string} mediaPath
 * @param {boolean} wantDu
 */
async function gatherMediaDirSizeCached(mediaPath, wantDu) {
	if (!wantDu) return null
	const now = Date.now()
	if (_duCache.path === mediaPath && now - _duCache.at < DU_TTL_MS && _duCache.bytes != null) {
		return _duCache.bytes
	}
	const bytes = await gatherMediaDirSizeOnce(mediaPath)
	_duCache = { path: mediaPath, bytes, at: now }
	return bytes
}

/**
 * @param {string} mediaPath
 * @returns {Promise<object|null>}
 */
async function diskForPath(mediaPath) {
	if (!mediaPath || !fs.existsSync(mediaPath)) return null
	try {
		const s = await fsPromises.statfs(mediaPath)
		const bsize = s.bsize || 512
		const blocks = s.blocks || 0
		const bavail = s.bavail != null ? s.bavail : s.bfree || 0
		const totalBytes = blocks * bsize
		const freeBytes = bavail * bsize
		const usedBytes = Math.max(0, totalBytes - freeBytes)
		return { totalBytes, freeBytes, usedBytes }
	} catch {
		return null
	}
}

function normalizeAmcpData(data) {
	if (data == null) return ''
	if (Array.isArray(data)) return data.join('\n')
	return String(data)
}

/**
 * NVIDIA GPU utilization + VRAM from the host (no Caspar).
 * @returns {Promise<{ text: string, utilizationPct: number, source: string }|null>}
 */
async function probeNvidiaSmi() {
	try {
		const { stdout } = await execFileAsync(
			'nvidia-smi',
			['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
			{ timeout: 4000, maxBuffer: 65536 },
		)
		const line = String(stdout).trim().split(/\r?\n/)[0] || ''
		const parts = line.split(',').map((s) => s.trim())
		const util = parseInt(parts[0], 10)
		const memUsed = parseInt(parts[1], 10)
		const memTot = parseInt(parts[2], 10)
		if (!Number.isFinite(util)) return null
		const text =
			Number.isFinite(memUsed) && Number.isFinite(memTot)
				? `${util}% · ${memUsed}/${memTot} MiB VRAM`
				: `${util}%`
		return { text, utilizationPct: util, source: 'nvidia-smi' }
	} catch {
		return null
	}
}

/**
 * @returns {Promise<{ text: string|null, utilizationPct: number|null, source: string|null }>}
 */
async function getGpuCached() {
	const now = Date.now()
	if (_gpuCache.text && now - _gpuCache.at < GPU_TTL_MS) {
		return {
			text: _gpuCache.text,
			utilizationPct: _gpuCache.utilizationPct ?? null,
			source: _gpuCache.source || null,
		}
	}
	const n = await probeNvidiaSmi()
	if (n) {
		_gpuCache = { text: n.text, at: now, utilizationPct: n.utilizationPct, source: n.source }
		return { text: n.text, utilizationPct: n.utilizationPct, source: n.source }
	}
	_gpuCache = { text: null, at: now, utilizationPct: null, source: null }
	return { text: null, utilizationPct: null, source: null }
}

/**
 * @param {object} ctx
 * @returns {Promise<string|null>}
 */
async function getGlInfoCached(ctx) {
	if (!ctx.amcp) return null
	const now = Date.now()
	if (_glCache.text && now - _glCache.at < GL_TTL_MS) return _glCache.text
	try {
		const gl = await ctx.amcp.query.glInfo()
		if (!gl?.ok) return null
		const raw = normalizeAmcpData(gl.data).trim()
		const text = raw ? raw.slice(0, 480) : null
		_glCache = { text, at: now }
		return text
	} catch {
		return null
	}
}

function wantGlInfoViaAmcp(ctx) {
	if (process.env.HIGHASCG_HOST_STATS_GL_INFO === '1' || process.env.HIGHASCG_HOST_STATS_GL_INFO === 'true') return true
	return ctx.config?.host_stats?.gl_info_via_amcp === true
}

/**
 * @param {object} ctx
 */
async function handleGet(ctx) {
	if (ctx.config?.offline_mode) {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				mode: 'preshow',
				message:
					'Host stats are off in preshow (offline) mode. On the production CasparCG machine they show load, GPU (nvidia-smi), and disk.',
				cpu: null,
				memory: null,
				media: { path: null, disk: null, folderUsedBytes: null },
				gpu: { text: null, utilizationPct: null, source: null },
				caspar: { glInfo: null },
			}),
		}
	}

	const cores = os.cpus()?.length || 0
	const load = os.loadavg()
	const memTotal = os.totalmem()
	const memFree = os.freemem()

	const mediaPath = getMediaIngestBasePath(ctx.config)
	const hs = ctx.config.host_stats || {}
	const wantDu =
		process.env.HIGHASCG_HOST_STATS_DU === '1' ||
		process.env.HIGHASCG_HOST_STATS_DU === 'true' ||
		hs.scan_folder === true

	const wantGl = wantGlInfoViaAmcp(ctx) && ctx.amcp

	const [disk, folderUsedBytes, gpu, glInfo] = await Promise.all([
		diskForPath(mediaPath),
		gatherMediaDirSizeCached(mediaPath, wantDu),
		getGpuCached(),
		wantGl ? getGlInfoCached(ctx) : Promise.resolve(null),
	])

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			mode: 'production',
			cpu: {
				load1: load[0],
				load5: load[1],
				load15: load[2],
				cores,
			},
			memory: {
				totalBytes: memTotal,
				freeBytes: memFree,
				usedBytes: memTotal - memFree,
			},
			media: {
				path: mediaPath,
				disk,
				folderUsedBytes,
				folderScanEnabled: wantDu,
			},
			gpu: {
				text: gpu.text,
				utilizationPct: gpu.utilizationPct,
				source: gpu.source,
			},
			caspar: {
				glInfo,
			},
		}),
	}
}

module.exports = { handleGet }
