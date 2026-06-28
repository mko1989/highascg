'use strict'

/**
 * Normalized Companion settings (HTTP press + Satellite preview).
 * @param {object} [cfg] — ctx.config
 */
function resolveCompanionConfig(cfg) {
	const c = cfg?.companion || {}
	const host = String(c.host || '127.0.0.1').trim() || '127.0.0.1'
	const port = parseInt(String(c.port), 10) || 8000
	const satelliteHostRaw = String(c.satelliteHost ?? '').trim()
	return {
		host,
		port,
		satelliteEnabled: c.satelliteEnabled !== false,
		satelliteHost: satelliteHostRaw || host,
		satellitePort: parseInt(String(c.satellitePort ?? 16622), 10) || 16622,
		previewBitmapSize: clampInt(c.previewBitmapSize, 72, 32, 512),
		pickerGridSize: clampInt(c.pickerGridSize, 8, 1, 16),
	}
}

/** @param {object} [partial] */
function companionDefaults(partial) {
	const base = {
		host: '127.0.0.1',
		port: 8000,
		satelliteEnabled: true,
		satelliteHost: '',
		satellitePort: 16622,
		previewBitmapSize: 72,
		pickerGridSize: 8,
	}
	return { ...base, ...(partial && typeof partial === 'object' ? partial : {}) }
}

/**
 * @param {object} settings — POST /api/settings companion block
 * @param {object} [prev]
 */
function mergeCompanionSettings(settings, prev) {
	const p = companionDefaults(prev)
	const s = settings && typeof settings === 'object' ? settings : {}
	return {
		host: String(s.host ?? p.host).trim() || '127.0.0.1',
		port: parseInt(String(s.port ?? p.port), 10) || 8000,
		satelliteEnabled: s.satelliteEnabled !== false,
		satelliteHost: String(s.satelliteHost ?? p.satelliteHost ?? '').trim(),
		satellitePort: parseInt(String(s.satellitePort ?? p.satellitePort), 10) || 16622,
		previewBitmapSize: clampInt(s.previewBitmapSize ?? p.previewBitmapSize, 72, 32, 512),
		pickerGridSize: clampInt(s.pickerGridSize ?? p.pickerGridSize, 8, 1, 16),
	}
}

function clampInt(v, fallback, min, max) {
	const n = parseInt(String(v ?? fallback), 10)
	if (!Number.isFinite(n)) return fallback
	return Math.max(min, Math.min(max, n))
}

function locationKey(page, row, column) {
	return `${page}/${row}/${column}`
}

function subIdForLocation(page, row, column) {
	return `highascg/${page}/${row}/${column}`
}

function parseSubId(subId) {
	const m = String(subId || '').match(/^highascg\/(-?\d+)\/(-?\d+)\/(-?\d+)$/)
	if (!m) return null
	return { page: parseInt(m[1], 10), row: parseInt(m[2], 10), column: parseInt(m[3], 10) }
}

module.exports = {
	resolveCompanionConfig,
	companionDefaults,
	mergeCompanionSettings,
	locationKey,
	subIdForLocation,
	parseSubId,
}
