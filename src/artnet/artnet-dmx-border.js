'use strict'

const { DMX_HYST, PATCH_CHANNEL_COUNT } = require('./artnet-constants')
const { readByte } = require('./artnet-packet')

function parseHexColor(hex) {
	const s = String(hex || '#000000').replace(/^#/, '')
	if (s.length >= 6) {
		return {
			r: parseInt(s.slice(0, 2), 16) || 0,
			g: parseInt(s.slice(2, 4), 16) || 0,
			b: parseInt(s.slice(4, 6), 16) || 0,
		}
	}
	return { r: 0, g: 0, b: 0 }
}

function toHex(val) {
	const hex = Math.max(0, Math.min(255, Math.round(val))).toString(16)
	return hex.length === 1 ? '0' + hex : hex
}

function dmxEnabledSticky(val, prev, hyst = DMX_HYST) {
	if (val >= 128 + hyst) return true
	if (val < 128 - hyst) return false
	return !!prev
}

function dmxTypeSticky(val, prevType, hyst = DMX_HYST) {
	const v = val | 0
	const t = prevType || 'border'
	if (t === 'border') {
		if (v >= 192 + hyst) return 'shadow'
		if (v >= 128 + hyst) return 'edge_strip'
		if (v >= 64 + hyst) return 'glow'
		return 'border'
	}
	if (t === 'glow') {
		if (v < 64 - hyst) return 'border'
		if (v >= 192 + hyst) return 'shadow'
		if (v >= 128 + hyst) return 'edge_strip'
		return 'glow'
	}
	if (t === 'edge_strip') {
		if (v < 64 - hyst) return 'border'
		if (v < 128 - hyst) return 'glow'
		if (v >= 192 + hyst) return 'shadow'
		return 'edge_strip'
	}
	if (v < 192 - hyst) {
		if (v < 128 - hyst) return v < 64 - hyst ? 'border' : 'glow'
		return 'edge_strip'
	}
	return 'shadow'
}

function patchMappedBytesChanged(prevWindow, nextWindow, channelMap, channelCount = PATCH_CHANNEL_COUNT) {
	if (!nextWindow) return false
	for (let off = 0; off < channelCount; off++) {
		if (!channelMap[off]) continue
		const next = nextWindow[off] ?? 0
		const old = prevWindow ? prevWindow[off] : undefined
		if (old === undefined || next !== old) return true
	}
	return !prevWindow
}

function computeBorderFromDmx(data, start, channelMap, runtimeParams) {
	const prev = { ...runtimeParams }
	const map = channelMap
	const getHex = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`
	const dmxSegmentsToN = (byte) => Math.max(1, Math.min(32, Math.round((byte / 255) * 31) + 1))

	let enabled = prev.enabled
	if (map[0]) {
		enabled = dmxEnabledSticky(readByte(data, start), prev.enabled)
	}

	let type = prev.type || 'border'
	if (map[1]) {
		type = dmxTypeSticky(readByte(data, start + 1), prev.type)
	}

	const params = {
		...prev,
		side: 'inside',
		enabled,
		type,
	}

	if (map[2]) params.opacity = readByte(data, start + 2) / 255

	if (map[3] || map[4] || map[5]) {
		const c = parseHexColor(prev.color)
		const r = map[3] ? readByte(data, start + 3) : c.r
		const g = map[4] ? readByte(data, start + 4) : c.g
		const b = map[5] ? readByte(data, start + 5) : c.b
		params.color = getHex(r, g, b)
	}

	if (map[6]) {
		const wVal = readByte(data, start + 6)
		const w = (wVal / 255) * 50
		params.width = w
		params.intensity = w
	}

	if (map[7]) {
		const spd = 0.1 + (readByte(data, start + 7) / 255) * 9.9
		params.speed = spd
		params.pulseSpeed = spd
	}

	if (map[8]) {
		const spreadVal = readByte(data, start + 8)
		params.spread = (spreadVal / 255) * 20
		params.blur = (spreadVal / 255) * 50
	}

	if (map[9] || map[10] || map[11]) {
		const gc = parseHexColor(prev.glowColor)
		const r = map[9] ? readByte(data, start + 9) : gc.r
		const g = map[10] ? readByte(data, start + 10) : gc.g
		const b = map[11] ? readByte(data, start + 11) : gc.b
		params.glowColor = getHex(r, g, b)
	}

	if (map[12]) params.radius = (readByte(data, start + 12) / 255) * 50
	if (map[13]) params.count = Math.floor((readByte(data, start + 13) / 255) * 12) + 1
	if (map[14]) params.length = 5 + (readByte(data, start + 14) / 255) * 95

	if (map[15] || map[16] || map[17]) {
		let segmentMode = prev.segmentMode === 'uniform' || prev.segmentationMode === 'uniform' ? 'uniform' : 'full'
		if (map[17]) {
			const segModeVal = readByte(data, start + 17)
			segmentMode = segModeVal >= 128 ? 'uniform' : 'full'
			params.segmentMode = segmentMode
			params.segmentationMode = segmentMode
		}
		if (map[15]) {
			params.segmentsPerEdge =
				segmentMode === 'full' ? 1 : dmxSegmentsToN(readByte(data, start + 15))
			params.segmentation =
				segmentMode === 'full' ? 0 : Math.max(0, Math.min(1, readByte(data, start + 15) / 255))
		}
		if (map[16]) {
			params.segmentEase = Math.max(0, Math.min(1, readByte(data, start + 16) / 255))
		}
	}

	if (enabled && params.opacity === 0) params.opacity = 1

	const payloadParams = { ...params }
	if (!enabled) payloadParams.opacity = 0

	return { params, payloadParams, type }
}

function overlayApplyKey(type, payloadParams) {
	return JSON.stringify({
		type: type || 'border',
		enabled: !!payloadParams.enabled,
		opacity: Math.round((payloadParams.opacity ?? 0) * 1000) / 1000,
		color: payloadParams.color,
		width: Math.round((payloadParams.width ?? 0) * 10) / 10,
		intensity: Math.round((payloadParams.intensity ?? 0) * 10) / 10,
		glowColor: payloadParams.glowColor,
		radius: Math.round((payloadParams.radius ?? 0) * 10) / 10,
		speed: Math.round((payloadParams.speed ?? 0) * 100) / 100,
		spread: Math.round((payloadParams.spread ?? 0) * 10) / 10,
		segmentMode: payloadParams.segmentMode,
		segmentsPerEdge: payloadParams.segmentsPerEdge,
	})
}

module.exports = {
	parseHexColor,
	toHex,
	dmxEnabledSticky,
	dmxTypeSticky,
	patchMappedBytesChanged,
	computeBorderFromDmx,
	overlayApplyKey,
}
