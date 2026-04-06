/**
 * Parse CasparCG INFO CONFIG XML for per-channel video-mode → pixel size + fps.
 * Used so HighAsCG matches the running server (not hardcoded 1920×1080).
 */
'use strict'

const { getModeDimensions } = require('./config-modes')

/**
 * @param {string} videoMode - e.g. "1080p6000", "3072x1728"
 * @returns {{ w: number, h: number, fps: number }}
 */
function resolutionFromVideoModeString(videoMode) {
	const vm = String(videoMode || '').trim()
	const m = /^(\d+)\s*x\s*(\d+)$/i.exec(vm.replace(/\s/g, ''))
	if (m) {
		const w = parseInt(m[1], 10) || 1920
		const h = parseInt(m[2], 10) || 1080
		return { w, h, fps: 50 }
	}
	const d = getModeDimensions(vm, {}, 1)
	return { w: d.width, h: d.height, fps: d.fps }
}

/**
 * Fast parse — INFO CONFIG channel list (same shape as caspar log).
 * @param {string} xmlStr
 * @returns {Array<{ index: number, videoMode: string }>}
 */
function parseChannelVideoModesFromInfoConfigXml(xmlStr) {
	if (!xmlStr || typeof xmlStr !== 'string') return []
	const out = []
	const re = /<channel[^>]*>([\s\S]*?)<\/channel>/gi
	let block
	while ((block = re.exec(xmlStr)) !== null) {
		const inner = block[1]
		const vmMatch = /<video-mode>\s*([^<]+?)\s*<\/video-mode>/i.exec(inner)
		const videoMode = vmMatch ? vmMatch[1].trim() : ''
		out.push({ index: out.length + 1, videoMode })
	}
	return out
}

/**
 * @param {string} xmlStr
 * @returns {Record<number, { w: number, h: number, fps: number }>}
 */
function buildChannelResolutionMap(xmlStr) {
	const rows = parseChannelVideoModesFromInfoConfigXml(xmlStr)
	/** @type {Record<number, { w: number, h: number, fps: number }>} */
	const map = {}
	for (const row of rows) {
		if (!row.videoMode) continue
		map[row.index] = resolutionFromVideoModeString(row.videoMode)
	}
	return map
}

module.exports = {
	resolutionFromVideoModeString,
	parseChannelVideoModesFromInfoConfigXml,
	buildChannelResolutionMap,
}
