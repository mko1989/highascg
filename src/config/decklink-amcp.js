'use strict'

const { getChannelMap, resolveDecklinkInputDeviceIndex } = require('./routing-map')

const PLAY_DECKLINK_RE = /^PLAY\s+(\d+)-(\d+)\s+DECKLINK\s+(\d+)\s*$/i

/**
 * Resolve DeckLink input slot + Caspar device index from a dedicated input host channel/layer.
 * @param {object} config
 * @param {number} channel
 * @param {number} layer
 * @returns {{ slot: number, device: number, channel: number, layer: number } | null}
 */
function resolveDecklinkInputFromChannelLayer(config, channel, layer) {
	const map = getChannelMap(config || {})
	const ch = parseInt(String(channel), 10)
	const ly = parseInt(String(layer), 10)
	if (!Number.isFinite(ch) || ch < 1 || !Number.isFinite(ly) || ly < 1) return null
	const entry = (Array.isArray(map.inputChannels) ? map.inputChannels : []).find(
		(e) => e && e.kind === 'decklink' && Number(e.channel) === ch && Number(e.layer) === ly,
	)
	if (!entry) {
		// Legacy: layer number often equals slot on the shared inputs host.
		const byLayer = (Array.isArray(map.inputChannels) ? map.inputChannels : []).find(
			(e) => e && e.kind === 'decklink' && Number(e.layer) === ly,
		)
		if (!byLayer) return null
		const slot = Number(byLayer.slot) || ly
		return {
			slot,
			device: resolveDecklinkInputDeviceIndex(config, slot),
			channel: Number(byLayer.channel) || ch,
			layer: Number(byLayer.layer) || ly,
		}
	}
	const slot = Number(entry.slot) || ly
	return {
		slot,
		device: resolveDecklinkInputDeviceIndex(config, slot),
		channel: ch,
		layer: ly,
	}
}

/**
 * Caspar rejects `DECKLINK 0`; map auto/unassigned (0) to the resolved 1-based device index.
 * @param {string} line
 * @param {object} [config]
 * @returns {string}
 */
function normalizeDecklinkPlayAmcpLine(line, config) {
	const raw = String(line || '').trim()
	const m = raw.match(PLAY_DECKLINK_RE)
	if (!m) return raw
	const channel = parseInt(m[1], 10)
	const layer = parseInt(m[2], 10)
	const device = parseInt(m[3], 10)
	if (Number.isFinite(device) && device > 0) return raw
	const resolved = resolveDecklinkInputFromChannelLayer(config, channel, layer)
	const dev = resolved?.device
	if (!Number.isFinite(dev) || dev <= 0) return raw
	return `PLAY ${channel}-${layer} DECKLINK ${dev}`
}

/**
 * @param {string[]} lines
 * @param {object} [config]
 * @returns {string[]}
 */
function normalizeDecklinkPlayAmcpLines(lines, config) {
	if (!Array.isArray(lines) || !lines.length) return lines || []
	return lines.map((line) => normalizeDecklinkPlayAmcpLine(line, config))
}

module.exports = {
	PLAY_DECKLINK_RE,
	resolveDecklinkInputFromChannelLayer,
	normalizeDecklinkPlayAmcpLine,
	normalizeDecklinkPlayAmcpLines,
}
