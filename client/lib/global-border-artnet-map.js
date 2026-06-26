/**
 * Global border Art-Net DMX channel map (18 offsets from artnetPatch.startChannel).
 * @see client/fixtures/global-border.txt
 */

export const GLOBAL_BORDER_DMX_CHANNEL_COUNT = 18

/** @typedef {{ offset: number, label: string, field: string }} GlobalBorderArtnetChannelDef */

/** @type {GlobalBorderArtnetChannelDef[]} */
export const GLOBAL_BORDER_ARTNET_CHANNEL_DEFS = [
	{ offset: 0, label: 'On/Off', field: 'enabled' },
	{ offset: 1, label: 'Effect type', field: 'type' },
	{ offset: 2, label: 'Opacity', field: 'params.opacity' },
	{ offset: 3, label: 'Color red', field: 'params.color.r' },
	{ offset: 4, label: 'Color green', field: 'params.color.g' },
	{ offset: 5, label: 'Color blue', field: 'params.color.b' },
	{ offset: 6, label: 'Width / thickness', field: 'params.width' },
	{ offset: 7, label: 'Speed', field: 'params.speed' },
	{ offset: 8, label: 'Spread / blur', field: 'params.spread' },
	{ offset: 9, label: 'Glow red', field: 'params.glowColor.r' },
	{ offset: 10, label: 'Glow green', field: 'params.glowColor.g' },
	{ offset: 11, label: 'Glow blue', field: 'params.glowColor.b' },
	{ offset: 12, label: 'Radius', field: 'params.radius' },
	{ offset: 13, label: 'Count (edge strip)', field: 'params.count' },
	{ offset: 14, label: 'Length (edge strip)', field: 'params.length' },
	{ offset: 15, label: 'Segments per edge', field: 'params.segments' },
	{ offset: 16, label: 'Segment ease', field: 'params.segmentEase' },
	{ offset: 17, label: 'Segmentation mode', field: 'params.segmentationMode' },
]

export function defaultArtnetChannelMap() {
	return Array(GLOBAL_BORDER_DMX_CHANNEL_COUNT).fill(true)
}

/** @param {boolean[] | undefined} map */
export function normalizeArtnetChannelMap(map) {
	const out = defaultArtnetChannelMap()
	if (!Array.isArray(map)) return out
	for (let i = 0; i < GLOBAL_BORDER_DMX_CHANNEL_COUNT; i++) {
		out[i] = map[i] !== false
	}
	return out
}

function parseHexRgb(color) {
	const s = String(color || '').trim()
	const m = /^#?([0-9a-f]{6})$/i.exec(s)
	if (!m) return null
	const n = parseInt(m[1], 16)
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(r, g, b) {
	const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
	return `#${[clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

function mergeColorChannel(localColor, remoteColor, map, rOff, gOff, bOff) {
	const l = parseHexRgb(localColor) || { r: 230, g: 57, b: 70 }
	const r = parseHexRgb(remoteColor) || l
	return rgbToHex(
		map[rOff] ? r.r : l.r,
		map[gOff] ? r.g : l.g,
		map[bOff] ? r.b : l.b,
	)
}

function pick(remoteVal, localVal, channelEnabled) {
	if (!channelEnabled) return localVal
	return remoteVal !== undefined ? remoteVal : localVal
}

/**
 * Merge Art-Net-driven runtime fields into local border using per-channel mask.
 * @param {object} local
 * @param {object} remote
 * @param {boolean[] | undefined} channelMap
 */
export function mergeArtnetBorderRuntime(local, remote, channelMap) {
	const map = normalizeArtnetChannelMap(channelMap)
	const lp = { ...(local.params || {}), side: 'inside' }
	const rp = remote.params && typeof remote.params === 'object' ? remote.params : {}
	const out = {
		enabled: pick(remote.enabled, local.enabled, map[0]),
		type: pick(remote.type, local.type, map[1]),
		fadeDuration: local.fadeDuration,
		params: { ...lp },
	}

	if (map[2] && rp.opacity !== undefined) out.params.opacity = rp.opacity
	if (map[3] || map[4] || map[5]) {
		out.params.color = mergeColorChannel(lp.color, rp.color, map, 3, 4, 5)
	}
	if (map[6] && rp.width !== undefined) out.params.width = rp.width
	if (map[6] && rp.thickness !== undefined) out.params.thickness = rp.thickness
	if (map[6] && rp.intensity !== undefined) out.params.intensity = rp.intensity
	if (map[7] && rp.speed !== undefined) out.params.speed = rp.speed
	if (map[7] && rp.pulseSpeed !== undefined) out.params.pulseSpeed = rp.pulseSpeed
	if (map[8] && rp.spread !== undefined) out.params.spread = rp.spread
	if (map[8] && rp.blur !== undefined) out.params.blur = rp.blur
	if (map[9] || map[10] || map[11]) {
		out.params.glowColor = mergeColorChannel(lp.glowColor, rp.glowColor, map, 9, 10, 11)
	}
	if (map[12] && rp.radius !== undefined) out.params.radius = rp.radius
	if (map[13] && rp.count !== undefined) out.params.count = rp.count
	if (map[14] && rp.length !== undefined) out.params.length = rp.length
	if (map[15] && rp.segments !== undefined) out.params.segments = rp.segments
	if (map[16] && rp.segmentEase !== undefined) out.params.segmentEase = rp.segmentEase
	if (map[17] && rp.segmentationMode !== undefined) out.params.segmentationMode = rp.segmentationMode

	return out
}
