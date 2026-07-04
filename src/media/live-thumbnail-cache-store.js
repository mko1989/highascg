/**
 * Live thumbnail disk cache paths and metadata.
 */
'use strict'

const fs = require('fs')
const path = require('path')

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

module.exports = {
	getLiveThumbnailCacheDir,
	cachePngPath,
	cacheMetaPath,
	readMeta,
	resolveLiveThumbnailTtlMs,
	isLiveThumbnailMetaStale,
	invalidateLiveThumbnailCache,
}
