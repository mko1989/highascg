/**
 * HTTP handlers for live thumbnail cache routes.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { JSON_HEADERS, jsonBody } = require('../api/response')
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
	const ch = Math.max(1, parseInt(String(bodyObj?.channel ?? bodyObj?.ch ?? 1), 10) || 1)
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

/**
 * POST /api/thumbnail/live/upload
 * @param {import('http').IncomingMessage} req
 * @param {object} query
 * @param {object} ctx
 */
async function handleLiveThumbnailUploadPost(req, query, ctx) {
	const ch = Math.max(1, parseInt(String(query?.channel ?? query?.ch ?? 1), 10) || 1)
	const cfg = ctx.config || {}
	const dir = getLiveThumbnailCacheDir(cfg)
	await fs.promises.mkdir(dir, { recursive: true })

	const dest = cachePngPath(cfg, ch)
	const metaDest = cacheMetaPath(cfg, ch)

	const writeStream = fs.createWriteStream(dest)
	req.pipe(writeStream)

	await new Promise((resolve, reject) => {
		writeStream.on('finish', resolve)
		writeStream.on('error', reject)
	})

	const buf = await fs.promises.readFile(dest)
	const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
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
