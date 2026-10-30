/**
 * Caspar PRINT capture → live thumbnail cache.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { getMediaIngestBasePath, resolveMediaFileOnDisk } = require('./local-media')
const {
	getLiveThumbnailCacheDir,
	cachePngPath,
	cacheMetaPath,
	readMeta,
	resolveLiveThumbnailTtlMs,
	isLiveThumbnailMetaStale,
} = require('./live-thumbnail-cache-store')
const { swallow } = require('../utils/swallow')

/** @type {Map<number, Promise<{ ok: boolean, error?: string }>>} */
const _captureLocks = new Map()

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const _refreshTimers = new Map()

/**
 * WO-845: Caspar's PRINT reply names no file — it drops a timestamp-named PNG (`YYYYMMDDTHHMMSS.png`, no channel in
 * the name) into the media root and we find it as "the newest PNG since t0". The per-channel lock does not stop two
 * channels capturing together (two DeckLink look cards): both PRINTs landed in the same window, both jobs picked
 * the same newest PNG, so ch A's thumbnail showed ch B's picture and the first job to finish deleted the file under
 * the other ("PRINT produced no PNG"). One PRINT + file pickup in flight at a time makes "newest since t0" mean
 * "the one this channel just printed".
 * @type {Promise<unknown>}
 */
let _printChain = Promise.resolve()
function serializePrint(fn) {
	const run = _printChain.then(fn, fn)
	_printChain = run.catch(() => {})
	return run
}

/**
 * Debounced cache invalidation after bus/scene activity (WO-110).
 * Does not run Caspar PRINT — use POST /api/thumbnail/live/capture or the Sources ↻ button.
 * @param {object} ctx
 * @param {number} channel
 * @param {number} [delayMs]
 */
function scheduleLiveThumbnailRefresh(ctx, channel, delayMs) {
	const cfg = ctx?.config || {}
	if (cfg.live_thumbnail_refresh_on_bus === false) return
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const delay = Math.max(150, parseInt(String(delayMs ?? cfg.live_thumbnail_refresh_delay_ms ?? 600), 10) || 600)
	const prev = _refreshTimers.get(ch)
	if (prev) clearTimeout(prev)
	_refreshTimers.set(
		ch,
		setTimeout(() => {
			_refreshTimers.delete(ch)
			const { invalidateLiveThumbnailCache } = require('./live-thumbnail-cache-store')
			invalidateLiveThumbnailCache(cfg, ch)
		}, delay),
	)
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
		if (/\.png$/i.test(line) && !/\s/.test(line)) return line.replace(/^["']|["']$/g, '')
		const m = line.match(/([\w\-./]+\.png)$/i)
		if (m) return m[1].replace(/^["']|["']$/g, '')
	}
	return null
}

/**
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

	const job = serializePrint(async () => {
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
			// WO-845: copy to a temp name, validate, then rename — a concurrent GET /api/thumbnail/live/:ch (size > 32)
			// used to be able to serve a half-copied PNG, and a bad PRINT destroyed the previous good thumbnail.
			const tmpDest = `${dest}.tmp`
			await fs.promises.copyFile(srcAbs, tmpDest)
			const buf = await fs.promises.readFile(tmpDest)
			if (buf.length < 256) {
				try {
					await fs.promises.unlink(tmpDest)
				} catch {
					/* ignore */
				}
				return { ok: false, error: 'PRINT PNG was empty or incomplete (retry capture)' }
			}
			await fs.promises.rename(tmpDest, dest)
			const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
			const fileMeta = {
				channel: ch,
				capturedAt: new Date().toISOString(),
				sha256: sha,
				sourcePrint: path.basename(srcAbs),
			}
			const tmpMeta = `${metaDest}.tmp`
			await fs.promises.writeFile(tmpMeta, JSON.stringify(fileMeta, null, 0), 'utf8')
			await fs.promises.rename(tmpMeta, metaDest)

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
	})

	_captureLocks.set(ch, job)
	try {
		return await job
	} finally {
		if (_captureLocks.get(ch) === job) _captureLocks.delete(ch)
	}
}

module.exports = {
	captureLiveThumbnailToCache,
	scheduleLiveThumbnailRefresh,
	/* WO-272: reused by routes-pgm-capture.js (operator capture button). */
	parsePrintFilenameFromAmcpData,
}
