'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { JSON_HEADERS, jsonBody } = require('../api/response')
const { getMediaIngestBasePath, resolveMediaFileOnDisk } = require('../media/local-media')
const { createSingleFlight, createBackoffGate } = require('./compose-preview-backpressure')

/**
 * WO-280: one stat/read per channel per frame no matter how many clients are asking.
 * Concurrent GETs of the same channel join the in-flight read instead of each issuing
 * their own `readFile` of the whole JPEG.
 */
const _previewSingleFlight = createSingleFlight()
/** WO-280: capped exponential backoff per channel; logs once per health transition. */
const _previewBackoff = createBackoffGate()
/**
 * WO-280: last successfully read frame per channel, keyed by etag. Bounded to one
 * buffer per channel (and hard-capped below) so it can never grow with client count.
 * @type {Map<number, { etag: string, buf: Buffer, format: 'jpeg' | 'png' }>}
 */
const _frameMemo = new Map()
/** Hard ceiling on memo entries — a client asking for bogus channels cannot grow it. */
const FRAME_MEMO_MAX = 32

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string}
 */
function getBasename(config, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const prefix = String(config?.composePreview?.basenamePrefix || 'highascg_preview').trim() || 'highascg_preview'
	return `${prefix}/ch${ch}`
}

/**
 * Target JPG path for ffmpeg receiver (file may not exist yet).
 * @param {object} config
 * @param {number} channel
 * @returns {string | null}
 */
function resolvePreviewJpgOutputPath(config, channel) {
	const { getComposePreviewJpgBasename } = require('./compose-preview-ffmpeg-args')
	const { getMediaIngestBasePath, resolveSafe } = require('../media/local-media-paths')
	const base = getComposePreviewJpgBasename(config, channel)
	return resolveSafe(getMediaIngestBasePath(config), base)
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string | null}
 */
function resolvePreviewJpgPath(config, channel) {
	return resolveMediaFileOnDisk(config, require('./compose-preview-ffmpeg-args').getComposePreviewJpgBasename(config, channel))
}

/**
 * Prefer JPG (ffmpeg_jpeg) then legacy PNG (caspar_image).
 * @param {object} config
 * @param {number} channel
 * @returns {{ path: string, format: 'jpeg' | 'png' } | null}
 */
function resolvePreviewImagePath(config, channel) {
	const jpg = resolvePreviewJpgPath(config, channel)
	if (jpg) return { path: jpg, format: 'jpeg' }
	const png = resolvePreviewPngPath(config, channel)
	if (png) return { path: png, format: 'png' }
	return null
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string | null}
 */
function resolvePreviewPngPath(config, channel) {
	const base = getBasename(config, channel)
	return resolveMediaFileOnDisk(config, base) || resolveMediaFileOnDisk(config, `${base}.png`)
}

/**
 * @param {string} fp
 * @returns {Promise<string | null>}
 */
async function sha256File(fp) {
	try {
		const buf = await fs.promises.readFile(fp)
		return crypto.createHash('sha256').update(buf).digest('hex')
	} catch {
		return null
	}
}

/**
 * @param {string} fp
 * @param {number} sinceMs
 * @param {{ timeoutMs?: number, intervalMs?: number, minBytes?: number }} [opts]
 * @returns {Promise<{ path: string, stat: fs.Stats } | null>}
 */
async function waitForPngStable(fp, sinceMs, opts = {}) {
	const timeoutMs = Math.max(100, opts.timeoutMs ?? 2500)
	const intervalMs = Math.max(5, opts.intervalMs ?? 25)
	const minBytes = Math.max(256, opts.minBytes ?? 4096)
	const deadline = Date.now() + timeoutMs
	let lastSize = 0
	let stableReads = 0
	while (Date.now() <= deadline) {
		try {
			const st = await fs.promises.stat(fp)
			if (st.size >= minBytes && st.mtimeMs >= sinceMs - 50) {
				if (st.size === lastSize) {
					stableReads += 1
					if (stableReads >= 2) return { path: fp, stat: st }
				} else {
					stableReads = 0
					lastSize = st.size
				}
			} else {
				stableReads = 0
				lastSize = 0
			}
		} catch {
			stableReads = 0
			lastSize = 0
		}
		await new Promise((r) => setTimeout(r, intervalMs))
	}
	try {
		const st = await fs.promises.stat(fp)
		if (st.size >= minBytes) return { path: fp, stat: st }
	} catch {
		/* ignore */
	}
	return null
}

/**
 * Ensure preview scratch folder exists under media ingest.
 * @param {object} config
 */
async function ensurePreviewDir(config) {
	const prefix = String(config?.composePreview?.basenamePrefix || 'highascg_preview').trim() || 'highascg_preview'
	const dir = path.join(getMediaIngestBasePath(config), prefix.split('/')[0])
	await fs.promises.mkdir(dir, { recursive: true })
}

function etagFromStat(st) {
	return `W/"${Math.floor(st.mtimeMs)}-${st.size}"`
}

/** Staleness gate: generous multiple of the mtime poll interval, floored at 60 s. */
const STALE_POLL_MULTIPLIER = 10
const STALE_MIN_AGE_MS = 60_000

/**
 * Defense-in-depth against serving a frozen frame forever (WO-159 T159.1): only when
 * the channel is expected to be live-writing — ffmpeg_jpeg mode with the FILE consumer
 * attached (the image2 consumer rewrites chN.jpg continuously at >= 1 fps). Detached /
 * blocklisted channels are exempt so a legitimately-paused preview never 404s here
 * (the settle-gate in compose-preview-activity only defers WS broadcasts, not writes).
 * @param {object} config
 * @param {number} channel
 * @param {import('fs').Stats} st
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function isComposePreviewFrameStale(config, channel, st, nowMs = Date.now()) {
	try {
		const { isFfmpegJpegComposePreview } = require('./compose-preview-mode')
		if (!isFfmpegJpegComposePreview(config)) return false
		const { isComposeConsumerAttached } = require('./compose-preview-consumer')
		if (!isComposeConsumerAttached(channel)) return false
		const { resolveMtimePollMs } = require('./compose-preview-ffmpeg-jpeg')
		const maxAgeMs = Math.max(STALE_POLL_MULTIPLIER * resolveMtimePollMs(config), STALE_MIN_AGE_MS)
		return nowMs - st.mtimeMs > maxAgeMs
	} catch {
		return false
	}
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @returns {Promise<{ status: number, headers: Record<string, string>, body?: Buffer|string }>}
 */
async function handleComposePreviewMetaGet(ctx, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const cfg = ctx.config || {}
	const resolved = resolvePreviewImagePath(cfg, ch)
	if (!resolved) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'No compose preview captured yet', channel: ch }),
		}
	}
	try {
		// WO-280: concurrent meta polls from N clients collapse into one stat().
		const st = await _previewSingleFlight.run(`meta:${ch}`, () => fs.promises.stat(resolved.path))
		if (st.size <= 32) {
			return {
				status: 404,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Compose preview file empty', channel: ch }),
			}
		}
		if (resolved.format === 'jpeg' && isComposePreviewFrameStale(cfg, ch, st)) {
			return {
				status: 404,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Compose preview frame stale', channel: ch }),
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				channel: ch,
				format: resolved.format,
				etag: etagFromStat(st),
				mtimeMs: st.mtimeMs,
				size: st.size,
				basename: getBasename(cfg, ch),
			}),
		}
	} catch {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'No compose preview captured yet', channel: ch }),
		}
	}
}

/**
 * Read one compose preview frame from disk. Always called through
 * {@link _previewSingleFlight}, so at most one execution per channel is in progress and
 * every concurrent caller shares its result. Re-reads are skipped when the memoized
 * frame's etag still matches the current stat.
 *
 * @param {object} config
 * @param {number} ch
 * @returns {Promise<{ etag: string, buf: Buffer, format: 'jpeg' | 'png' }>}
 * @throws {Error} when the file is missing / empty — the caller records the failure
 */
async function readComposePreviewFrame(config, ch) {
	const resolved = resolvePreviewImagePath(config, ch)
	if (!resolved) throw new Error('No compose preview captured yet')
	const st = await fs.promises.stat(resolved.path)
	if (st.size <= 32) throw new Error('Compose preview file empty')
	const etag = etagFromStat(st)
	const memo = _frameMemo.get(ch)
	if (memo && memo.etag === etag && memo.format === resolved.format) return memo
	const buf = await fs.promises.readFile(resolved.path)
	// Bounded: one entry per channel, hard-capped so a client requesting arbitrary
	// channel numbers can never grow this map without limit.
	if (_frameMemo.size >= FRAME_MEMO_MAX && !_frameMemo.has(ch)) _frameMemo.clear()
	const entry = { etag, buf, format: resolved.format }
	_frameMemo.set(ch, entry)
	return entry
}

/**
 * One log line per health transition — never per frame (WO-280 req. 3).
 * @param {object} ctx
 * @param {number} ch
 * @param {{ changed: boolean, failures?: number, delayMs?: number }} res
 * @param {string} [reason]
 */
function logComposePreviewHealth(ctx, ch, res, reason) {
	if (!res?.changed || typeof ctx?.log !== 'function') return
	if (res.delayMs != null) {
		ctx.log(
			'warn',
			`[compose-preview] ch${ch} frame read failing — backing off (${reason || 'unknown'}); retry in ${res.delayMs}ms`,
		)
	} else {
		ctx.log('info', `[compose-preview] ch${ch} frame read recovered after ${res.failures} failure(s)`)
	}
}

/**
 * @param {number} ch
 * @param {string} etag
 * @param {Buffer} buf
 * @param {'jpeg' | 'png'} format
 * @param {string} inm
 */
function composePreviewImageResponse(ch, etag, buf, format, inm) {
	if (inm && inm === etag) {
		return { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-cache' } }
	}
	return {
		status: 200,
		headers: {
			'Content-Type': format === 'jpeg' ? 'image/jpeg' : 'image/png',
			'Cache-Control': 'no-cache',
			ETag: etag,
		},
		body: buf,
	}
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {Record<string, string>} [query]
 */
async function handleComposePreviewImageGet(ctx, channel, query = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const cfg = ctx.config || {}
	const now = Date.now()
	const inm = String(query['if-none-match'] || query.ifNoneMatch || '').trim()

	// WO-280: a channel that is currently failing is answered straight from the backoff
	// window instead of re-stat/re-reading the disk on every request from every client.
	// The memoized frame is dropped on failure, so this never serves a frozen frame
	// (WO-159 T159.1) — it just stops the 404 path from doing I/O at push rate.
	if (!_previewBackoff.canAttempt(ch, now)) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'No compose preview captured yet', channel: ch, backoffMs: _previewBackoff.delayMs(ch) }),
		}
	}

	let frame
	try {
		frame = await _previewSingleFlight.run(`img:${ch}`, () => readComposePreviewFrame(cfg, ch))
	} catch (e) {
		const res = _previewBackoff.recordFailure(ch, now)
		logComposePreviewHealth(ctx, ch, res, e?.message)
		_frameMemo.delete(ch)
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: e?.message || 'No compose preview captured yet', channel: ch }),
		}
	}
	logComposePreviewHealth(ctx, ch, _previewBackoff.recordSuccess(ch))
	return composePreviewImageResponse(ch, frame.etag, frame.buf, frame.format, inm)
}

/**
 * Test / lifecycle hook — drops the memoized frames, the in-flight joins and the
 * per-channel backoff state.
 */
function resetComposePreviewServeState() {
	_frameMemo.clear()
	_previewSingleFlight.clear()
	_previewBackoff.clear()
}

/**
 * Introspection for `/api/compose-preview/stats` and the offline smoke test.
 */
function getComposePreviewServeStats() {
	return {
		memoChannels: _frameMemo.size,
		inFlight: _previewSingleFlight.size(),
		backingOff: _previewBackoff.size(),
	}
}

/** @deprecated use handleComposePreviewImageGet */
async function handleComposePreviewPngGet(ctx, channel, query = {}) {
	return handleComposePreviewImageGet(ctx, channel, query)
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {Record<string, string>} [query]
 */
async function handleComposePreviewCompanionGet(ctx, channel, query = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const cfg = ctx.config || {}
	const {
		isCompanionThumbEnabled,
		getCompanionPreviewJpegBuffer,
		onComposePreviewUpdated,
	} = require('./compose-preview-companion-thumb')
	if (!isCompanionThumbEnabled(cfg)) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Companion preview disabled', channel: ch }),
		}
	}
	let buf = getCompanionPreviewJpegBuffer(ch)
	if (!buf) {
		await onComposePreviewUpdated(ctx, ch)
		buf = getCompanionPreviewJpegBuffer(ch)
	}
	if (!buf || buf.length <= 32) {
		const { resolveCompanionThumbOutputPath } = require('./compose-preview-companion-thumb')
		const fp = resolveCompanionThumbOutputPath(cfg, ch)
		if (fp) {
			try {
				buf = await fs.promises.readFile(fp)
			} catch {
				buf = null
			}
		}
	}
	if (!buf || buf.length <= 32) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Companion preview not ready', channel: ch }),
		}
	}
	const etag = `"${crypto.createHash('md5').update(buf).digest('hex')}"`
	const inm = query['if-none-match'] || query.ifNoneMatch
	if (inm && String(inm).trim() === etag) {
		return { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-cache' } }
	}
		return {
			status: 200,
			headers: {
				'Content-Type': 'image/jpeg',
				'Cache-Control': 'no-cache',
				ETag: etag,
			},
			body: buf,
		}
}

module.exports = {
	getBasename,
	resolvePreviewPngPath,
	resolvePreviewJpgPath,
	resolvePreviewJpgOutputPath,
	resolvePreviewImagePath,
	waitForPngStable,
	ensurePreviewDir,
	sha256File,
	etagFromStat,
	isComposePreviewFrameStale,
	handleComposePreviewMetaGet,
	handleComposePreviewImageGet,
	handleComposePreviewPngGet,
	handleComposePreviewCompanionGet,
	readComposePreviewFrame,
	resetComposePreviewServeState,
	getComposePreviewServeStats,
}
