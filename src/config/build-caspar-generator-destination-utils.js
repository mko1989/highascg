'use strict'

const { destinationsFromConfig } = require('./screen-destinations')

function getDestinationList(appConfig) {
	const list = destinationsFromConfig(appConfig || {})
	return list.filter((d) => d && typeof d === 'object')
}

function parseCustomVideoModeString(modeRaw) {
	const s = String(modeRaw || '').trim().toLowerCase()
	if (!s) return null
	const m = s.match(/^(\d{2,5})x(\d{2,5})(?:p|@)?(\d+(?:\.\d+)?)?$/i)
	if (!m) return null
	const w = Math.max(64, parseInt(m[1], 10) || 0)
	const h = Math.max(64, parseInt(m[2], 10) || 0)
	const fps = Math.max(1, parseFloat(m[3] || '50') || 50)
	if (!w || !h) return null
	return { w, h, fps }
}

module.exports = {
	getDestinationList,
	parseCustomVideoModeString,
}
