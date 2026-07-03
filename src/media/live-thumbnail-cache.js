/**
 * Cached still frames from CasparCG AMCP PRINT for live preview / compose thumbnails.
 * PRINT writes an RGBA PNG into the server's media folder; we copy into data/live-thumbnails
 * so GET /api/thumbnail/live/:ch can serve a stable URL without re-printing every request.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { JSON_HEADERS, jsonBody } = require('../api/response')
const { getMediaIngestBasePath, resolveMediaFileOnDisk } = require('./local-media')

/** @type {Map<number, Promise<{ ok: boolean, error?: string }>>} */
const _captureLocks = new Map()

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const _refreshTimers = new Map()

/**
 * @param {object} [config]
 * @returns {number}
 */
function resolveLiveThumbnailTtlMs(config) {
	const n = parseInt(String(config?.live_thumbnail_ttl_ms ?? config?.liveThumbnail?.ttlMs ?? 30000), 10)
	return Number.isFinite(n) ? Math.max(0, Math.min(600000, n)) : 30000
}

/**
 * @param {{ capturedAt?: string } | null | undefined} meta
 * @param {number} ttlMs
 * @returns {boolean}
 */
function isLiveThumbnailMetaStale(meta, ttlMs) {
	if (ttlMs <= 0) return false
	if (!meta?.capturedAt) return true
	const t = Date.parse(meta.capturedAt)
	if (!Number.isFinite(t)) return true
	return Date.now() - t > ttlMs
}

/**
 * @param {object} [config]
 * @param {number} channel
 */
function invalidateLiveThumbnailCache(config, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const dest = cachePngPath(config || {}, ch)
	const metaDest = cacheMetaPath(config || {}, ch)
	try {
		if (fs.existsSync(dest)) fs.unlinkSync(dest)
	} catch {
		/* ok */
	}
	try {
		if (fs.existsSync(metaDest)) fs.unlinkSync(metaDest)
	} catch {
		/* ok */
	}
}

/**
 * Debounced PRINT refresh after bus/scene activity (WO-110).
 * @param {object} ctx
 * @param {number} channel
 * @param {number} [delayMs]
 */
function scheduleLiveThumbnailRefresh(ctx, channel, delayMs) {
	const cfg = ctx?.config || {}
	if (cfg.live_thumbnail_refresh_on_bus === false) return
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	if (!ctx?.amcp?.isConnected) return
	const delay = Math.max(150, parseInt(String(delayMs ?? cfg.live_thumbnail_refresh_delay_ms ?? 600), 10) || 600)
	const prev = _refreshTimers.get(ch)
	if (prev) clearTimeout(prev)
	_refreshTimers.set(
		ch,
		setTimeout(() => {
			_refreshTimers.delete(ch)
			void captureLiveThumbnailToCache(ctx, ch, { force: true }).catch(() => {})
		}, delay),
	)
}

/**
 * @param {object} [config]
 * @returns {string}
 */
function getLiveThumbnailCacheDir(config) {
	const raw = (config?.live_thumbnail_cache_path || '').trim()
	if (raw) return path.resolve(raw)
	return path.join(process.cwd(), 'data', 'live-thumbnails')
}

/**
 * @param {number} channel
 * @returns {string}
 */
function cachePngPath(config, channel) {
	return path.join(getLiveThumbnailCacheDir(config), `ch-${channel}.png`)
}

/**
 * @param {number} channel
 * @returns {string}
 */
function cacheMetaPath(config, channel) {
	return path.join(getLiveThumbnailCacheDir(config), `ch-${channel}.json`)
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @returns {{ capturedAt?: string, sha256?: string } | null}
 */
function readMeta(config, channel) {
	const fp = cacheMetaPath(config, channel)
	try {
		if (!fs.existsSync(fp)) return null
		const j = JSON.parse(fs.readFileSync(fp, 'utf8'))
		return j && typeof j === 'object' ? j : null
	} catch {
		return null
	}
}

/**
 * @param {string|string[]|undefined} data
 * @returns {string | null}
 */
function parsePrintFilenameFromAmcpData(data) {
	const lines = []
	if (Array.isArray(data)) {
		for (const x of data) lines.push(String(x || '').trim())
	} else if (typeof data === 'string') {
		lines.push(data.trim())
		for (const sub of data.split(/\r?\n/)) lines.push(sub.trim())
	}
	for (const line of lines) {
		if (!line) continue
		// Typical: ok single-line relative id "20260214T120000.png" or "MEDIA/foo.png"
		if (/\.png$/i.test(line) && !/\s/.test(line)) return line.replace(/^["']|["']$/g, '')
		const m = line.match(/([\w\-./]+\.png)$/i)
		if (m) return m[1].replace(/^["']|["']$/g, '')
	}
	return null
}

/**
 * Find newest PNG at top-level of media folder modified after `sinceMs`.
 * Fallback when PRINT response omits filename (some builds).
 * @param {string} mediaBase
 * @param {number} sinceMs
 * @returns {Promise<string | null>}
 */
async function findNewestRootPngSince(mediaBase, sinceMs, minBytes = 0) {
	try {
		const entries = await fs.promises.readdir(mediaBase, { withFileTypes: true })
		let bestPath = null
		let bestMtime = 0
		for (const e of entries) {
			if (!e.isFile() || !e.name.toLowerCase().endsWith('.png')) continue
			const fp = path.join(mediaBase, e.name)
			const st = await fs.promises.stat(fp)
			if (st.size < minBytes) continue
			if (st.mtimeMs >= sinceMs && st.mtimeMs > bestMtime) {
				bestMtime = st.mtimeMs
				bestPath = fp
			}
		}
		return bestPath
	} catch {
		return null
	}
}

/**
 * Caspar returns PRINT OK before the PNG is fully written — poll until size is stable.
 * @param {string} mediaBase
 * @param {number} sinceMs
 * @param {{ timeoutMs?: number, intervalMs?: number, minBytes?: number }} [opts]
 * @returns {Promise<string | null>}
 */
async function waitForPrintPngSince(mediaBase, sinceMs, opts = {}) {
	const timeoutMs = Math.max(100, opts.timeoutMs ?? 2500)
	const intervalMs = Math.max(5, opts.intervalMs ?? 25)
	const minBytes = Math.max(256, opts.minBytes ?? 4096)
	const deadline = Date.now() + timeoutMs
	let lastPath = null
	let lastSize = 0
	let stableReads = 0
	while (Date.now() <= deadline) {
		const found = await findNewestRootPngSince(mediaBase, sinceMs, minBytes)
		if (found) {
			try {
				const st = await fs.promises.stat(found)
				if (st.size >= minBytes && found === lastPath && st.size === lastSize) {
					stableReads += 1
					if (stableReads >= 2) return found
				} else {
					stableReads = 0
					lastPath = found
					lastSize = st.size
				}
			} catch {
				stableReads = 0
				lastPath = null
				lastSize = 0
			}
		} else {
			stableReads = 0
			lastPath = null
			lastSize = 0
		}
		await new Promise((r) => setTimeout(r, intervalMs))
	}
	return lastPath && lastSize >= minBytes ? lastPath : null
}

/**
 * PRINT timestamp-style PNG names — safe to delete after copying into cache.
 * @param {string} basename
 */
function isLikelyPrintScratchFile(basename) {
	return /^\d{8}T\d{6}\.png$/i.test(basename)
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, error?: string, path?: string }>}
 */
async function captureLiveThumbnailToCache(ctx, channel, opts = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const force = opts.force === true
	const cfg = ctx.config || {}
	const dir = getLiveThumbnailCacheDir(cfg)
	await fs.promises.mkdir(dir, { recursive: true })

	const dest = cachePngPath(cfg, ch)
	const metaDest = cacheMetaPath(cfg, ch)
	const ttlMs = resolveLiveThumbnailTtlMs(cfg)
	if (!force && fs.existsSync(dest)) {
		try {
			const st = await fs.promises.stat(dest)
			const meta = readMeta(cfg, ch)
			if (st.size > 100 && !isLiveThumbnailMetaStale(meta, ttlMs)) {
				return { ok: true, path: dest, cached: true }
			}
		} catch {
			/* re-capture */
		}
	}

	if (!ctx.amcp || typeof ctx.amcp.basic?.print !== 'function') {
		return { ok: false, error: 'Caspar not connected' }
	}

	const existing = _captureLocks.get(ch)
	if (existing) return existing

	const job = (async () => {
		const mediaBase = getMediaIngestBasePath(cfg)
		const t0 = Date.now() - 500
		let printRes
		try {
			printRes = await ctx.amcp.basic.print(ch)
		} catch (e) {
			return { ok: false, error: e?.message || String(e) }
		}
		if (!printRes?.ok) {
			return { ok: false, error: 'PRINT failed' }
		}

		let rel = parsePrintFilenameFromAmcpData(printRes.data)
		let srcAbs = null
		/** Filename came from PRINT response — safe to delete from media ingest after cache copy */
		let resolvedFromPrintReply = false
		if (rel) {
			const rp = String(rel).trim()
			if (path.isAbsolute(rp) && fs.existsSync(rp)) srcAbs = rp
			else srcAbs = resolveMediaFileOnDisk(cfg, rp)
			if (srcAbs && fs.existsSync(srcAbs)) resolvedFromPrintReply = true
		}
		if (!srcAbs) {
			const guessed = await waitForPrintPngSince(mediaBase, t0)
			if (guessed) srcAbs = guessed
		}
		if (!srcAbs || !fs.existsSync(srcAbs)) {
			return { ok: false, error: 'PRINT produced no PNG (check media path / Caspar logs)' }
		}

		try {
			await fs.promises.copyFile(srcAbs, dest)
			const buf = await fs.promises.readFile(dest)
			if (buf.length < 256) {
				try {
					await fs.promises.unlink(dest)
				} catch {
					/* ignore */
				}
				return { ok: false, error: 'PRINT PNG was empty or incomplete (retry capture)' }
			}
			const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
			const fileMeta = {
				channel: ch,
				capturedAt: new Date().toISOString(),
				sha256: sha,
				sourcePrint: path.basename(srcAbs),
			}
			await fs.promises.writeFile(metaDest, JSON.stringify(fileMeta, null, 0), 'utf8')

			const delScratch = cfg.live_thumbnail_delete_print_stills !== false
			const mediaRoot = path.resolve(mediaBase)
			const underMedia = srcAbs === mediaRoot || srcAbs.startsWith(mediaRoot + path.sep)
			const shouldRemovePrintStill =
				delScratch &&
				underMedia &&
				(resolvedFromPrintReply || isLikelyPrintScratchFile(path.basename(srcAbs)))
			if (shouldRemovePrintStill) {
				try {
					await fs.promises.unlink(srcAbs)
				} catch {
					/* non-fatal */
				}
			}
			return { ok: true, path: dest }
		} catch (e) {
			return { ok: false, error: e?.message || String(e) }
		}
	})()

	_captureLocks.set(ch, job)
	try {
		return await job
	} finally {
		if (_captureLocks.get(ch) === job) _captureLocks.delete(ch)
	}
}

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
	// STOP automatic lazy capture completely! Only manual captures/uploads are permitted.
	const lazy = false

	const dest = cachePngPath(cfg, ch)

	let stat = null
	try {
		stat = fs.existsSync(dest) ? await fs.promises.stat(dest) : null
	} catch {
		stat = null
	}

	const etag =
		stat && stat.size > 32 ? `W/"${Math.floor(stat.mtimeMs)}-${stat.size}"` : null

	if (stat && stat.size > 32 && !force) {
		const meta = readMeta(cfg, ch)
		const ttlMs = resolveLiveThumbnailTtlMs(cfg)
		if (!isLiveThumbnailMetaStale(meta, ttlMs)) {
			const buf = await fs.promises.readFile(dest)
			return {
				status: 200,
				headers: {
					'Content-Type': 'image/png',
					'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
					...(etag ? { ETag: etag } : {}),
				},
				body: buf,
			}
		}
	}

	if (!lazy && (!stat || stat.size <= 32)) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'No cached live thumbnail',
				hint: 'POST /api/thumbnail/live/capture with { "channel": N } or GET with defaults (lazy capture)',
				channel: ch,
			}),
		}
	}

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
			'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
			ETag: etag2,
		},
		body: buf,
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
	getLiveThumbnailCacheDir,
	cachePngPath,
	captureLiveThumbnailToCache,
	handleLiveThumbnailGet,
	handleLiveThumbnailCapturePost,
	handleLiveThumbnailUploadPost,
	readMeta,
	resolveLiveThumbnailTtlMs,
	isLiveThumbnailMetaStale,
	invalidateLiveThumbnailCache,
	scheduleLiveThumbnailRefresh,
}
