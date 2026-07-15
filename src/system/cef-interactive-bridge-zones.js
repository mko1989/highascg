'use strict'

const { getChannelMap } = require('../config/routing')
const { calculateLayoutPositions } = require('../utils/os-layout-calculator')
const {
	multiviewScreenConsumerEnabled,
	multiviewInteractiveEnabled,
	screenConsumerEnabled,
	screenInteractiveEnabled,
	multiviewPhysicalPortIndex,
} = require('../utils/x-display-session')
const { getModeDimensions } = require('../config/config-modes')
const { readCefDebugPortFromCasparXml } = require('./cef-interactive-cdp')
const { resolveOperatorGuiChannel } = require('./operator-gui-channel')
const { resolveOperatorMonitorPort } = require('../utils/operator-monitor-resolve')
const { resolveLayoutRectForOperatorPort } = require('../utils/x-display-session-layout')

function envDisabled() {
	const v = String(process.env.HIGHASCG_CEF_INTERACTIVE_BRIDGE || '').trim().toLowerCase()
	return v === '0' || v === 'false' || v === 'no'
}

function resolveInteractiveLayer(config) {
	const fromEnv = parseInt(String(process.env.HIGHASCG_CEF_INTERACTIVE_LAYER || ''), 10)
	if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv
	const ot = config?.operatorTools
	const fromCfg = parseInt(String(ot?.cefInteractiveLayer ?? ''), 10)
	if (Number.isFinite(fromCfg) && fromCfg >= 0) return fromCfg
	return 999
}

/**
 * Cheap config-only check: is any screen/multiview marked interactive at all?
 * Must run before {@link listInteractiveZones} — zone listing walks the OS layout
 * calculator into live xrandr queries, far too expensive for per-AMCP hooks.
 * @param {object} config
 * @returns {boolean}
 */
function anyInteractiveConfigured(config) {
	if (multiviewInteractiveEnabled(config)) return true
	for (let n = 1; n <= 8; n++) {
		if (screenInteractiveEnabled(config, n)) return true
	}
	return false
}

function bridgeEnabledInConfig(config) {
	if (envDisabled()) return false
	const ot = config?.operatorTools
	if (ot?.cefInteractiveBridge === false || ot?.cefInteractiveBridge === 'false') return false
	if (!anyInteractiveConfigured(config)) return false
	if (readCefDebugPortFromCasparXml() <= 0) return false
	return listInteractiveZones(config).length > 0
}

/**
 * @param {object} config
 * @returns {Array<{ id: string, x: number, y: number, width: number, height: number, channel: number, layer: number }>}
 */
function listInteractiveZones(config) {
	const layout = calculateLayoutPositions(config)
	const map = getChannelMap(config)
	const layer = resolveInteractiveLayer(config)
	/** @type {Array<{ id: string, x: number, y: number, width: number, height: number, channel: number, layer: number }>} */
	const zones = []
	const mv = layout?.multiview?.[1]
	if (multiviewScreenConsumerEnabled(config) && multiviewInteractiveEnabled(config) && mv?.width > 0 && map.multiviewCh != null) {
		zones.push({
			id: 'multiview',
			x: mv.x,
			y: mv.y,
			width: mv.width,
			height: mv.height,
			channel: map.multiviewCh,
			layer,
		})
	}
	// WO-243 T243.2: operator_gui zone, gated on the destination existing — the GUI page itself
	// (the CEF layer) becomes the focusable CDP target via arm-input; this zone is what lets the
	// raw-CDP X11 bridge map operator-monitor pointer coords onto that target.
	const ogResolved = resolveOperatorGuiChannel(config)
	if (ogResolved) {
		const dest = ogResolved.dest
		const explicitPort = Number.isFinite(Number(dest?.physicalPort)) && Number(dest.physicalPort) >= 1 && Number(dest.physicalPort) <= 4
			? Number(dest.physicalPort)
			: null
		const ogPort = explicitPort != null ? explicitPort : resolveOperatorMonitorPort(config).port
		const ogRect = ogPort != null ? resolveLayoutRectForOperatorPort(config, layout, ogPort) : null
		if (ogRect && ogRect.width > 0 && ogRect.height > 0) {
			zones.push({
				id: 'operator_gui',
				x: ogRect.x,
				y: ogRect.y,
				width: ogRect.width,
				height: ogRect.height,
				channel: ogResolved.ch,
				layer,
			})
		}
	}
	const mvPort = multiviewPhysicalPortIndex(config)
	for (let n = 1; n <= 8; n++) {
		const sc = layout?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		if (mvPort && n === mvPort) continue
		const ch = map.programCh?.(n)
		if (ch == null) continue
		zones.push({
			id: `screen-${n}`,
			x: sc.x,
			y: sc.y,
			width: sc.width,
			height: sc.height,
			channel: ch,
			layer,
		})
	}
	return zones
}

/**
 * @param {object} config
 * @param {number} channel
 */
function channelVideoSize(config, channel) {
	const map = getChannelMap(config)
	const cs = config?.casparServer || config
	let mode = cs.multiview_mode || '1080p5000'
	if (channel === map.multiviewCh) mode = cs.multiview_mode || mode
	else {
		const idx = (map.programChannels || []).indexOf(channel)
		if (idx >= 0) {
			mode = cs[`screen_${idx + 1}_mode`] || mode
		}
	}
	const dims = getModeDimensions(String(mode || '1080p5000'), config, 1)
	return { width: dims?.width || 1920, height: dims?.height || 1080 }
}

function zonesKey(zones) {
	return zones.map((z) => `${z.id}@${z.x},${z.y},${z.width}x${z.height},ch${z.channel},L${z.layer}`).join('|')
}

module.exports = {
	envDisabled,
	resolveInteractiveLayer,
	anyInteractiveConfigured,
	bridgeEnabledInConfig,
	listInteractiveZones,
	channelVideoSize,
	zonesKey,
}
