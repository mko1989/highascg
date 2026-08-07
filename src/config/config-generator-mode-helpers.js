'use strict'

const { STANDARD_VIDEO_MODES } = require('./config-modes')

/**
 * @param {Record<string, unknown>} config
 * @param {number} n - 1-based screen index
 * @returns {string}
 */
function screenModeString(config, n) {
	const raw = config[`screen_${n}_mode`]
	const s = raw == null || raw === '' ? '1080p5000' : String(raw).trim()
	return s || '1080p5000'
}

/**
 * Caspar `<video-mode>` id for channels that only accept registered standard modes
 * (inputs host, streaming channel fallback).
 * @param {unknown} mode
 * @returns {string}
 */
function effectiveStandardVideoModeId(mode) {
	const m = mode == null || String(mode).trim() === '' ? '1080p5000' : String(mode).trim()
	return STANDARD_VIDEO_MODES[m] ? m : '1080p5000'
}

module.exports = { screenModeString, effectiveStandardVideoModeId }
