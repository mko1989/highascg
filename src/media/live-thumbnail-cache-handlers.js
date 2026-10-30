/**
 * HTTP handlers for live thumbnail cache routes.
 */
'use strict'

const fs = require('fs')
const path = require('path')
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
const { ensureInputLiveThumbnail } = require('./live-thumbnail-input-capture')

/**
 * GET /api/thumbnail/live/:channel — PNG bytes or triggers lazy capture once.
 * @param {object} ctx
 * @param {number} channel
 * @param {Record<string, string>} query
 * @returns {Promise<{ status: number, headers: Record<string, string>, body?: Buffer|string }>}
 */
async function handleLiveThumbnailGet(ctx, channel, query = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const cfg = ctx.config || {}
	const force = query.refresh === '1' || query.refresh === 'true' || query.force === '1' || query.force === 'true'
	const lazy = false

	const dest = cachePngPath(cfg, ch)

	let stat
	try {
		stat = fs.existsSync(dest) ? await fs.promises.stat(dest) : null
	} catch {
		stat = null
	}

	// Dedicated capture inputs (DeckLink / V4L2) have no media file behind them, so a look card's
	// only possible thumbnail is a PRINT of the input channel. Capture lazily here ONLY when no
	// cached PNG exists (WO-392: capture-once — bus invalidation deletes the PNG, explicit
	// capture uses the force paths); backoff-gated, so a powered-off camera degrades to the 404
	// placeholder below instead of retrying per render. PGM/PRV buses are excluded and keep
	// their cache-or-404 behaviour.
	if (!force) {
		const hasCache = !!stat && stat.size > 32
		const r = await ensureInputLiveThumbnail(ctx, ch, { hasCache })
		if (r.captured) {
			try {
				stat = fs.existsSync(dest) ? await fs.promises.stat(dest) : stat
			} catch {
				/* fall through to whatever we already had */
			}
		}
	}

	const etag =
		stat && stat.size > 32 ? `W/"${Math.floor(stat.mtimeMs)}-${stat.size}"` : null

	if (stat && stat.size > 32 && !force) {
		// WO-392: clients use STABLE (un-busted) URLs now, so the browser must revalidate on
		// each use — `no-cache` + ETag/304 keeps that cheap and picks up recaptures immediately.
		const inm = String(query?.ifNoneMatch || '').trim()
		if (etag && inm && inm === etag) {
			return {
				status: 304,
				headers: { 'Cache-Control': 'private, no-cache', ETag: etag },
				body: '',
			}
		}
		const buf = await fs.promises.readFile(dest)
		return {
			status: 200,
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'private, no-cache',
				...(etag ? { ETag: etag } : {}),
			},
			body: buf,
		}
	}

	if (!lazy && (!stat || stat.size <= 32)) {
		return {
			status: 404,
			headers: { ...JSON_HEADERS, 'X-Live-Thumb-No-Signal': '1', 'Cache-Control': 'no-store' },
			body: jsonBody({
				error: 'No cached live thumbnail',
				hint: 'POST /api/thumbnail/live/capture with { "channel": N } or use the ↻ button in Sources → Live',
				channel: ch,
			}),
		}
	}

	if (force) {
		const cap = await captureLiveThumbnailToCache(ctx, ch, { force: true })
		if (!cap.ok || !cap.path) {
			return {
				status: 502,
				headers: JSON_HEADERS,
				body: jsonBody({ error: cap.error || 'Capture failed', channel: ch }),
			}
		}
		const buf = await fs.promises.readFile(cap.path)
		const st2 = await fs.promises.stat(cap.path)
		const etag2 = `W/"${Math.floor(st2.mtimeMs)}-${st2.size}"`
		return {
			status: 200,
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'private, no-cache',
				ETag: etag2,
			},
			body: buf,
		}
	}

	return {
		status: 404,
		headers: JSON_HEADERS,
		body: jsonBody({
			error: 'No cached live thumbnail',
			hint: 'POST /api/thumbnail/live/capture with { "channel": N }',
			channel: ch,
		}),
	}
}

/**
 * POST /api/thumbnail/live/capture
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
	handleLiveThumbnailUploadPost,
}
