/**
 * HTTP handlers for live thumbnail cache routes.
 */
'use strict'

const fs = require('fs')
const crypto = require('crypto')
const { JSON_HEADERS, jsonBody } = require('../api/response')
const { defaultProgramChannel } = require('../config/operator-gui-first')
const {
	getLiveThumbnailCacheDir,
	cachePngPath,
	cacheMetaPath,
	readMeta,
} = require('./live-thumbnail-cache-store')
const { captureLiveThumbnailToCache } = require('./live-thumbnail-cache-capture')
const {
	ensureSessionLiveThumbnail,
	recaptureLiveThumbnails,
	markSessionThumbnailFresh,
} = require('./live-thumbnail-session')

/**
 * WO-887 response headers: which session state the served bytes are in.
 *   X-Live-Thumb-Session  fresh | custom | capturing | waiting | gave_up | idle | no_picture
 *   X-Live-Thumb-Retry-Ms (capturing / waiting only) when a re-fetch may see this session's capture.
 * @param {{ phase: string, retryInMs?: number } | null} session
 */
function sessionHeaders(session) {
	if (!session) return {}
	const h = { 'X-Live-Thumb-Session': session.phase }
	if (Number.isFinite(session.retryInMs)) h['X-Live-Thumb-Retry-Ms'] = String(Math.round(session.retryInMs))
	return h
}

/** @param {string} dest */
async function statPng(dest) {
	try {
		const st = await fs.promises.stat(dest)
		return st.size > 32 ? st : null
	} catch {
		return null
	}
}

/**
 * GET /api/thumbnail/live/:channel — PNG bytes. The first GET of a node session starts that channel's one
 * session capture (WO-887, live-thumbnail-session.js); until it lands the previous session's PNG is served
 * as a placeholder. `?refresh=1` / `?force=1` is a raw manual PRINT (stored even when black).
 * @param {object} ctx
 * @param {number} channel
 * @param {Record<string, string>} query
 * @returns {Promise<{ status: number, headers: Record<string, string>, body?: Buffer|string }>}
 */
async function handleLiveThumbnailGet(ctx, channel, query = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const cfg = ctx.config || {}
	const force = query.refresh === '1' || query.refresh === 'true' || query.force === '1' || query.force === 'true'
	const dest = cachePngPath(cfg, ch)

	if (force) {
		const cap = await captureLiveThumbnailToCache(ctx, ch, { force: true })
		if (!cap.ok || !cap.path) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: cap.error || 'Capture failed', channel: ch }) }
		}
		markSessionThumbnailFresh(ch)
		const st2 = await fs.promises.stat(cap.path)
		return {
			status: 200,
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'private, no-cache',
				ETag: `W/"${Math.floor(st2.mtimeMs)}-${st2.size}"`,
				...sessionHeaders({ phase: 'fresh' }),
			},
			body: await fs.promises.readFile(cap.path),
		}
	}

	const before = await statPng(dest)
	const session = await ensureSessionLiveThumbnail(ctx, ch, { customCache: !!before && readMeta(cfg, ch)?.isCustom === true })
	const stat = await statPng(dest)
	if (!stat) {
		return {
			status: 404,
			headers: { ...JSON_HEADERS, 'X-Live-Thumb-No-Signal': '1', 'Cache-Control': 'no-store', ...sessionHeaders(session) },
			body: jsonBody({
				error: 'No cached live thumbnail',
				hint: 'POST /api/thumbnail/live/recapture with { "channel": N } (or {} for every live channel)',
				channel: ch,
				session: session.phase,
			}),
		}
	}

	// WO-392: clients use STABLE (un-busted) URLs, so the browser must revalidate on each use — `no-cache` +
	// ETag/304 keeps that cheap and picks up the session capture / a manual recapture immediately.
	const etag = `W/"${Math.floor(stat.mtimeMs)}-${stat.size}"`
	const headers = { 'Cache-Control': 'private, no-cache', ETag: etag, ...sessionHeaders(session) }
	const inm = String(query?.ifNoneMatch || '').trim()
	if (inm && inm === etag) return { status: 304, headers, body: '' }
	return { status: 200, headers: { 'Content-Type': 'image/png', ...headers }, body: await fs.promises.readFile(dest) }
}

/**
 * POST /api/thumbnail/live/recapture — WO-887 manual recapture (API only, no GUI control by owner request):
 * `{ "channel": N }`, `{ "channels": [N, …] }` or `{}` for every live channel. Re-runs the session flow
 * (non-black frame, bounded retries); answers once the captures settle or after a bounded wait.
 * @param {object} bodyObj
 * @param {object} ctx
 */
async function handleLiveThumbnailRecapturePost(bodyObj, ctx) {
	const raw = Array.isArray(bodyObj?.channels) ? bodyObj.channels : bodyObj?.channel != null ? [bodyObj.channel] : null
	const channels = raw ? raw.map((c) => parseInt(String(c), 10)).filter((c) => Number.isFinite(c) && c > 0) : null
	if (raw && !channels.length) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'channel: positive integer required' }) }
	}
	const results = await recaptureLiveThumbnails(ctx, channels)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, channels: results }) }
}

/**
 * POST /api/thumbnail/live/capture — raw PRINT into the cache (stored even when black).
 * @param {object} bodyObj
 * @param {object} ctx
 */
async function handleLiveThumbnailCapturePost(bodyObj, ctx) {
	const ch = Math.max(1, parseInt(String(bodyObj?.channel ?? bodyObj?.ch ?? defaultProgramChannel(ctx)), 10) || 1)
	const force = bodyObj?.force === true || bodyObj?.force === 1 || bodyObj?.force === '1'
	const r = await captureLiveThumbnailToCache(ctx, ch, { force })
	const meta = readMeta(ctx.config || {}, ch)
	if (!r.ok) {
		return {
			status: 502,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, channel: ch, error: r.error || 'capture failed' }),
		}
	}
	markSessionThumbnailFresh(ch) // WO-887: a manual capture wins for the rest of the session
	const bust = meta?.capturedAt ? String(new Date(meta.capturedAt).getTime() || Date.now()) : String(Date.now())
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			channel: ch,
			capturedAt: meta?.capturedAt || null,
			thumbUrl: `/api/thumbnail/live/${ch}?v=${encodeURIComponent(bust)}`,
			sha256: meta?.sha256 || null,
		}),
	}
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const UPLOAD_MAX_BYTES = 20 * 1024 * 1024

/** Collect a request body as raw bytes (size-capped; rejects on abort). */
function readBodyBytes(req, maxBytes) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let total = 0
		req.on('data', (c) => {
			const b = Buffer.isBuffer(c) ? c : Buffer.from(c)
			total += b.length
			if (total > maxBytes) {
				reject(Object.assign(new Error('Upload too large'), { code: 'BODY_TOO_LARGE' }))
				if (typeof req.destroy === 'function') req.destroy()
				return
			}
			chunks.push(b)
		})
		req.on('end', () => resolve(Buffer.concat(chunks)))
		req.on('error', reject)
		req.on('aborted', () => reject(new Error('Upload aborted')))
		req.on('close', () => {
			if (!req.readableEnded) reject(new Error('Upload aborted'))
		})
	})
}

/**
 * POST /api/thumbnail/live/upload
 *
 * WO-845: this used to `req.pipe(writeStream)`, but src/server/http-server.js reads (and utf8-decodes) the body of
 * every non-multipart request BEFORE routing, so the stream was already consumed: the pipe ended at once and the
 * handler truncated ch-N.png to 0 bytes (destroying the cached thumbnail) and answered `{ ok: true }`. Now the
 * bytes are read here, validated (PNG magic, size cap) and swapped in atomically; a consumed stream is refused
 * with 409 instead of silently wiping the cache. src/server/http-server.js skips its body pre-read for this path
 * (`isIngestUpload`), so the bytes reach this handler.
 * @param {import('http').IncomingMessage} req
 * @param {object} query
 * @param {object} ctx
 */
async function handleLiveThumbnailUploadPost(req, query, ctx) {
	const ch = Math.max(1, parseInt(String(query?.channel ?? query?.ch ?? defaultProgramChannel(ctx)), 10) || 1)
	const cfg = ctx.config || {}
	const fail = (status, error) => ({ status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error }) })
	if (!req || typeof req.on !== 'function' || req.readableEnded === true || req.destroyed === true) {
		return fail(409, 'Upload body was already consumed by the server (binary body path not exempted) — nothing written')
	}
	let bytes
	try {
		bytes = await readBodyBytes(req, UPLOAD_MAX_BYTES)
	} catch (e) {
		return fail(e?.code === 'BODY_TOO_LARGE' ? 413 : 400, e?.message || 'Upload failed')
	}
	if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
		return fail(415, 'Upload is not a PNG image — nothing written')
	}
	const dir = getLiveThumbnailCacheDir(cfg)
	await fs.promises.mkdir(dir, { recursive: true })

	const dest = cachePngPath(cfg, ch)
	const metaDest = cacheMetaPath(cfg, ch)

	const tmp = `${dest}.tmp`
	await fs.promises.writeFile(tmp, bytes)
	await fs.promises.rename(tmp, dest)

	const sha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
	const fileMeta = {
		channel: ch,
		capturedAt: new Date().toISOString(),
		sha256: sha,
		sourcePrint: 'custom_upload.png',
		isCustom: true,
	}
	await fs.promises.writeFile(metaDest, JSON.stringify(fileMeta, null, 0), 'utf8')
	markSessionThumbnailFresh(ch) // WO-887: the session capture never replaces an upload

	const meta = readMeta(cfg, ch)
	const bust = meta?.capturedAt ? String(new Date(meta.capturedAt).getTime() || Date.now()) : String(Date.now())
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			channel: ch,
			capturedAt: meta?.capturedAt || null,
			thumbUrl: `/api/thumbnail/live/${ch}?v=${encodeURIComponent(bust)}`,
			sha256: meta?.sha256 || null,
			isCustom: true,
		}),
	}
}

module.exports = {
	handleLiveThumbnailGet,
	handleLiveThumbnailCapturePost,
	handleLiveThumbnailRecapturePost,
	handleLiveThumbnailUploadPost,
}
