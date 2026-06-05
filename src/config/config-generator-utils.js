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
	isCustomLiveProfile,
}
