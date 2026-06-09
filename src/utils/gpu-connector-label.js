'use strict'

const { getDisplayDetails, getGpuConnectorInventory } = require('./hardware-info')
const { getChannelMap } = require('../config/routing')

/**
 * Format a human-readable GPU port label for test patterns / Device View.
 * @param {{ drmConnector?: string, xrandrName?: string, channel?: number }} parts
 */
function formatGpuConnectorLabel(parts) {
	const drm = String(parts?.drmConnector || '').trim()
	const xr = String(parts?.xrandrName || '').trim()
	if (drm && xr && drm.toUpperCase() !== xr.toUpperCase()) return `${drm} · ${xr}`
	if (drm) return drm
	if (xr) return xr
	if (Number.isFinite(parts?.channel)) return `ch ${parts.channel}`
	return ''
}

/**
 * Resolve modetest DRM connector id + xrandr output for a Caspar program channel.
 * @param {object} config
 * @param {number} channelIndex
 */
function resolveGpuConnectorLabelForChannel(config, channelIndex) {
	const ch = parseInt(String(channelIndex), 10)
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const cm = getChannelMap(config || {})
	const mainIdx = Array.isArray(cm.programChannels) ? cm.programChannels.indexOf(ch) : -1

	let xrandrName = ''
	if (mainIdx >= 0) {
		xrandrName = String(cs[`screen_${mainIdx + 1}_system_id`] || '').trim()
	}

	let drmConnector = ''
	let displays
	let connectors
	try {
		displays = getDisplayDetails() || []
		connectors = getGpuConnectorInventory() || []
	} catch {
		displays = []
		connectors = []
	}

	if (xrandrName) {
		const display = displays.find((d) => d?.name === xrandrName || d?.xrandrName === xrandrName)
		if (display?.drmConnector) drmConnector = String(display.drmConnector).trim()
	}
	if (!drmConnector && xrandrName) {
		const conn = connectors.find((c) => c?.xrandrName === xrandrName)
		if (conn?.shortName) drmConnector = String(conn.shortName).trim()
	}

	const gpuConnectorId = drmConnector || xrandrName || ''
	const connectorLabel = formatGpuConnectorLabel({ drmConnector, xrandrName, channel: ch })

	return {
		gpuConnectorId,
		drmConnector,
		xrandrName,
		connectorLabel,
		screenIndex: mainIdx >= 0 ? mainIdx + 1 : null,
	}
}

module.exports = {
	formatGpuConnectorLabel,
	resolveGpuConnectorLabelForChannel,
}
