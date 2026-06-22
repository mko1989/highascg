'use strict'

/**
 * Parse optional pixel position from module config. Empty string uses fallback (auto layout or 0).
 * @param {unknown} raw
 * @param {number} fallback
 * @returns {number}
 */
function parseOptionalPixel(raw, fallback) {
	if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
	const n = parseInt(String(raw), 10)
	return Number.isFinite(n) ? n : fallback
}

/**
 * @param {string} s
 */
function escapeXml(s) {
	return String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/** @param {unknown} arr @param {number} len */
function padStringArray(arr, len) {
	const a = Array.isArray(arr) ? arr.map((x) => String(x ?? '').trim()) : []
	while (a.length < len) a.push('')
	return a.slice(0, len)
}

/** @param {unknown} arr @param {number} len */
function padBoolArray(arr, len) {
	const a = Array.isArray(arr) ? arr.map((x) => x === true || x === 'true') : []
	while (a.length < len) a.push(false)
	return a.slice(0, len)
}

/**
 * @param {unknown} id
 * @returns {string}
 */
function ffmpegPathFromAlsaId(id) {
	const s = String(id || '').trim()
	if (!s) return ''
	if (s.startsWith('-')) return s
	if (s.startsWith('pipewire:')) return `pulse://${s.slice('pipewire:'.length)}`
	return `-f alsa ${s}`
}

/**
 * Parse Caspar screen/multiview boolean from config JSON.
 * @param {unknown} raw
 * @param {boolean} [defaultWhenUnset=false]
 * @returns {boolean}
 */
function casparBoolEnabled(raw, defaultWhenUnset = false) {
	if (raw === undefined || raw === null) return defaultWhenUnset
	if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false
	return raw === true || raw === 'true' || raw === 1 || raw === '1'
}

/**
 * Multiview per-index setting with global `multiview_*` fallback (never PGM screen_1).
 * @param {Record<string, unknown>} config
 * @param {number} n - 1-based multiview index
 * @param {string} field - suffix after multiview_N_ / multiview_
 * @returns {unknown}
 */
function readMultiviewSetting(config, n, field) {
	return config[`multiview_${n}_${field}`] ?? config[`multiview_${field}`]
}

/**
 * Window chrome for multiview: per-index override, then PGM screen 1, then global multiview_*.
 * Matches operator expectation when UI sets borderless/windowed on program screens only.
 * @param {Record<string, unknown>} config
 * @param {number} n
 * @param {'windowed'|'borderless'} field
 * @param {boolean} [defaultWhenUnset=true]
 * @returns {boolean}
 */
function readMultiviewWindowChromeFlag(config, n, field, defaultWhenUnset = true) {
	const perIdx = config[`multiview_${n}_${field}`]
	if (perIdx !== undefined && perIdx !== null) return casparBoolEnabled(perIdx, defaultWhenUnset)
	const fromScreen = config[`screen_1_${field}`]
	if (fromScreen !== undefined && fromScreen !== null) return casparBoolEnabled(fromScreen, defaultWhenUnset)
	const global = config[`multiview_${field}`]
	if (global !== undefined && global !== null) return casparBoolEnabled(global, defaultWhenUnset)
	return defaultWhenUnset
}

/**
 * @param {Record<string, unknown>} config
 * @returns {boolean}
 */
function isCustomLiveProfile(config) {
	return String(config.caspar_build_profile || 'stock') === 'custom_live'
}

module.exports = {
	parseOptionalPixel,
	escapeXml,
	padStringArray,
	padBoolArray,
	ffmpegPathFromAlsaId,
	casparBoolEnabled,
	readMultiviewSetting,
	readMultiviewWindowChromeFlag,
	isCustomLiveProfile,
}
