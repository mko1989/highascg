'use strict'

const { calculateLayoutPositions } = require('./os-layout-calculator')
const {
	createDestinationWiringContext,
} = require('../config/device-graph-destination-wiring')
const {
	resolvePhysicalPortIndexForDestination,
} = require('../config/screen-consumer-port-resolve')
const { resolveOperatorMonitorPort } = require('./operator-monitor-resolve')

/**
 * @typedef {{ x: number, y: number, width: number, height: number, sysId: string|null, kind: 'multiview'|'screen', index: number, interactive: boolean }} OperatorDisplayRect
 */

function readCasparSetting(config, key) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	if (config && Object.prototype.hasOwnProperty.call(config, key)) return config[key]
	return undefined
}

function screenConsumerEnabled(config, n) {
	const v = readCasparSetting(config, `screen_${n}_screen_consumer`)
	return v !== false && v !== 'false' && v !== 0 && v !== '0'
}

/**
 * WO-235 T235.4: `casparServer.multiview_enabled` / `multiview_screen_consumer` are legacy
 * booleans that only get refreshed when the Caspar XML config is (re)generated
 * (config/build-caspar-generator-layout-sync.js:34,63 / device-graph-destination-wiring.js:179)
 * — they go stale once a multiview output is added/edited via screenDestinations (Device Graph)
 * without a regenerate, even though the multiview channel is genuinely wired up and its screen
 * consumer is running (confirmed live: `INFO <multiview channel>` shows a real
 * `<consumer>screen</consumer>` entry). routing-map.js already ignores these legacy flags and
 * derives `multiviewEnabled`/`multiviewCh` straight from `screenDestinations` (mode: "multiview"
 * destinations are real consumer/output entries, not just an internal compositing channel) —
 * mirror that here as a fallback so the operator-fullscreen / interactive-zone detection
 * (host-operator-fullscreen.js resolveOperatorRouteTarget) doesn't 400 "No interactive operator
 * display configured" just because the legacy flags never got resynced. Only ever widens
 * detection (never narrows an existing true legacy result).
 * @param {object} config
 * @returns {boolean}
 */
function multiviewScreenConsumerEnabled(config) {
	const cs = config?.casparServer || config
	const mvOn = cs.multiview_enabled !== false && cs.multiview_enabled !== 'false'
	if (mvOn) {
		const { multiviewGeneratedConfigIncludesScreen } = require('../config/multiview-helpers')
		if (multiviewGeneratedConfigIncludesScreen(cs)) return true
	}
	try {
		const { getChannelMap } = require('../config/routing')
		const map = getChannelMap(config)
		return !!(map && map.multiviewEnabled && map.multiviewCh != null)
	} catch (_) {
		return false
	}
}

function screenInteractiveEnabled(config, n) {
	const v = readCasparSetting(config, `screen_${n}_interactive`)
	return v === true || v === 'true'
}

function multiviewPhysicalPortIndex(config) {
	const ctx = createDestinationWiringContext(config || {})
	for (let i = 0; i < ctx.destinations.length; i++) {
		const dest = ctx.destinations[i]
		if (String(dest?.mode || '').toLowerCase() !== 'multiview') continue
		const port = resolvePhysicalPortIndexForDestination(dest, i, ctx)
		if (port) return port
	}
	return null
}

function multiviewInteractiveEnabled(config) {
	const v =
		readCasparSetting(config, 'multiview_1_interactive') ?? readCasparSetting(config, 'multiview_interactive')
	if (v === true || v === 'true') return true
	// Legacy: Device View stored interactive on screen_${port}_interactive for multiview GPU jacks.
	const port = multiviewPhysicalPortIndex(config)
	return !!(port && screenInteractiveEnabled(config, port))
}

function portFlagEnabled(config, key) {
	const v = readCasparSetting(config, key)
	return v === true || v === 'true'
}

/**
 * @param {object} config
 * @returns {number|null} 1-based physical GPU port index
 */
function operatorMonitorPortIndex(config) {
	for (let n = 1; n <= 4; n++) {
		if (portFlagEnabled(config, `screen_${n}_operator_monitor`)) return n
	}
	return null
}

/**
 * @param {object} config
 * @returns {number|null} 1-based physical GPU port index
 */
function nvidiaSyncToDisplayPortIndex(config) {
	for (let n = 1; n <= 4; n++) {
		if (portFlagEnabled(config, `screen_${n}_nvidia_sync_to_display`)) return n
	}
	return null
}

/**
 * @param {ReturnType<typeof calculateLayoutPositions>} layout
 * @param {string} sysId
 */
function findLayoutRectBySysId(layout, sysId) {
	const id = String(sysId || '').trim()
	if (!id || !layout) return null
	for (const [idx, sc] of Object.entries(layout.screens || {})) {
		if (String(sc?.sysId || '') === id && sc.width > 0 && sc.height > 0) {
			return { ...sc, kind: 'screen', index: parseInt(idx, 10) || 1 }
		}
	}
	for (const [idx, mv] of Object.entries(layout.multiview || {})) {
		if (String(mv?.sysId || '') === id && mv.width > 0 && mv.height > 0) {
			return { ...mv, kind: 'multiview', index: parseInt(idx, 10) || 1 }
		}
	}
	return null
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @param {number} portN
 * @returns {OperatorDisplayRect|null}
 */
function resolveLayoutRectForOperatorPort(config, layout, portN) {
	const plan = layout || calculateLayoutPositions(config)
	const sysId = String(readCasparSetting(config, `screen_${portN}_system_id`) || '').trim()
	if (sysId) {
		const hit = findLayoutRectBySysId(plan, sysId)
		if (hit) {
			const interactive =
				hit.kind === 'multiview'
					? multiviewInteractiveEnabled(config)
					: screenInteractiveEnabled(config, hit.index)
			return {
				x: hit.x,
				y: hit.y,
				width: hit.width,
				height: hit.height,
				sysId,
				kind: hit.kind,
				index: hit.index,
				interactive,
			}
		}
	}
	const ctx = createDestinationWiringContext(config || {})
	for (let destIndex = 0; destIndex < ctx.destinations.length; destIndex++) {
		const dest = ctx.destinations[destIndex]
		const portIdx = resolvePhysicalPortIndexForDestination(dest, destIndex, ctx)
		if (portIdx !== portN) continue
		const mode = String(dest?.mode || '').toLowerCase()
		// operator_gui-bound jacks claim the multiview-style head (os-layout-calculator-assign.js)
		// — resolve them to the multiview rect, never to screen_<mainScreenIndex+1>.
		if (mode === 'multiview' || mode === 'operator_gui') {
			const mv = plan?.multiview?.[1]
			if (!mv || mv.width <= 0 || mv.height <= 0) continue
			return {
				x: mv.x,
				y: mv.y,
				width: mv.width,
				height: mv.height,
				sysId: mv.sysId ? String(mv.sysId) : sysId || null,
				kind: 'multiview',
				index: 1,
				interactive: multiviewInteractiveEnabled(config),
			}
		}
		const n = Math.max(1, (parseInt(String(dest?.mainScreenIndex ?? 0), 10) || 0) + 1)
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		return {
			x: sc.x,
			y: sc.y,
			width: sc.width,
			height: sc.height,
			sysId: sc.sysId ? String(sc.sysId) : sysId || null,
			kind: 'screen',
			index: n,
			interactive: screenInteractiveEnabled(config, n),
		}
	}
	// WO-243 follow-up: neither the screen_N_system_id keys (empty on boxes configured purely via
	// Device View) nor the destination wiring (multiview jacks are often not gpu_out-cabled in the
	// graph) resolved — ask the GPU physical map which xrandr output is live on this port and match
	// its name against the layout entries' sysIds. This is what actually places the window on the
	// operator/multiview monitor instead of falling back to 0,0 (= program screen 1).
	try {
		const { getDisplayDetails, getGpuConnectorInventory } = require('./hardware-info')
		const { buildGpuPhysicalMap } = require('./gpu-physical-map')
		const map = buildGpuPhysicalMap({
			config: config || {},
			displays: getDisplayDetails() || [],
			connectors: getGpuConnectorInventory() || [],
		})
		for (const entry of map?.ports || []) {
			const slot = Number(entry?.slotOrder)
			if (!Number.isFinite(slot) || slot + 1 !== portN) continue
			const xr = String(entry?.runtime?.xrandrName || '').trim()
			if (!xr) break
			const hit = findLayoutRectBySysId(plan, xr)
			if (!hit) break
			const interactive =
				hit.kind === 'multiview'
					? multiviewInteractiveEnabled(config)
					: screenInteractiveEnabled(config, hit.index)
			return { x: hit.x, y: hit.y, width: hit.width, height: hit.height, sysId: xr, kind: hit.kind, index: hit.index, interactive }
		}
	} catch (_) {
		/* detection unavailable (headless/tests) — keep the null fallback */
	}
	return null
}

/**
 * @param {object} config
 * @returns {boolean}
 */
function isOperatorPointerConfineDesired(config) {
	if (resolveOperatorMonitorPort(config).port != null) return true
	if (config?.operatorTools?.pointerConfineMultiview === true) return true
	return false
}

/**
 * Operator monitor rect only when explicitly configured (GPU port checkbox or legacy setting).
 * Used for primary, confine, and apply-layout — not for Firefox/GUI positioning fallback.
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {OperatorDisplayRect|null}
 */
function resolveOperatorMonitorRect(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	const operatorPort = resolveOperatorMonitorPort(config).port
	if (operatorPort) {
		return resolveLayoutRectForOperatorPort(config, plan, operatorPort)
	}
	if (config?.operatorTools?.pointerConfineMultiview === true) {
		const mv = plan?.multiview?.[1]
		if (multiviewScreenConsumerEnabled(config) && mv && mv.width > 0 && mv.height > 0) {
			return {
				x: mv.x,
				y: mv.y,
				width: mv.width,
				height: mv.height,
				sysId: mv.sysId ? String(mv.sysId) : null,
				kind: 'multiview',
				index: 1,
				interactive: multiviewInteractiveEnabled(config),
			}
		}
	}
	return null
}

/**
 * Operator-facing display for GUI tools (multiview fallback when no explicit operator monitor).
 * multiview screen consumer when enabled, else first PGM screen consumer head.
 * Interactive Caspar inputs use the same head only when multiview is off (see confine tick).
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {OperatorDisplayRect|null}
 */
function resolveOperatorDisplayRect(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	const fromMonitor = resolveOperatorMonitorRect(config, plan)
	if (fromMonitor) return fromMonitor

	const mv = plan?.multiview?.[1]
	if (multiviewScreenConsumerEnabled(config) && mv && mv.width > 0 && mv.height > 0) {
		return {
			x: mv.x,
			y: mv.y,
			width: mv.width,
			height: mv.height,
			sysId: mv.sysId ? String(mv.sysId) : null,
			kind: 'multiview',
			index: 1,
			interactive: multiviewInteractiveEnabled(config),
		}
	}

	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n)) continue
		return {
			x: sc.x,
			y: sc.y,
			width: sc.width,
			height: sc.height,
			sysId: sc.sysId ? String(sc.sysId) : null,
			kind: 'screen',
			index: n,
			interactive: screenInteractiveEnabled(config, n),
		}
	}
	return null
}

/**
 * @param {OperatorDisplayRect|null} rect
 * @returns {string}
 */
function formatOperatorDisplaySummary(rect) {
	if (!rect) return 'No operator monitor configured (Device View → GPU port → Operator monitor).'
	const port = rect.sysId || '(unknown port)'
	const role =
		rect.kind === 'multiview' ? `multiview ${rect.index}` : `screen consumer ${rect.index}`
	const interactive = rect.interactive ? ' · interactive (Caspar mouse input)' : ''
	return `Operator monitor: ${port} — ${role} @ ${rect.x},${rect.y} ${rect.width}×${rect.height}${interactive}`
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerInRect(x, y, rect) {
	return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

/**
 * Allowed pointer zones when confine is on: operator monitor + any interactive Caspar consumer.
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} layout
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerInConfineAllowance(config, layout, x, y) {
	const operator = resolveOperatorMonitorRect(config, layout)
	if (operator && pointerInRect(x, y, operator)) return true
	return pointerOverInteractiveConsumer(config, layout, x, y)
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerOverInteractiveConsumer(config, layout, x, y) {
	const plan = layout || calculateLayoutPositions(config)
	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		const mvPort = multiviewPhysicalPortIndex(config)
		if (mvPort && n === mvPort) continue
		if (x >= sc.x && x < sc.x + sc.width && y >= sc.y && y < sc.y + sc.height) return true
	}
	const mv = plan?.multiview?.[1]
	if (
		multiviewScreenConsumerEnabled(config) &&
		multiviewInteractiveEnabled(config) &&
		mv &&
		mv.width > 0 &&
		mv.height > 0 &&
		x >= mv.x &&
		x < mv.x + mv.width &&
		y >= mv.y &&
		y < mv.y + mv.height
	) {
		return true
	}
	return false
}
function listInteractiveConsumerSummaries(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	/** @type {string[]} */
	const out = []
	const mvPort = multiviewPhysicalPortIndex(config)
	const mv = plan?.multiview?.[1]
	if (multiviewScreenConsumerEnabled(config) && mv && mv.width > 0 && multiviewInteractiveEnabled(config)) {
		out.push(`${mv.sysId || '?'} multiview`)
	}
	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		// Skip legacy mis-filed port key (interactive on multiview jack stored as screen_${port}_interactive).
		if (mvPort && n === mvPort) continue
		out.push(`${sc.sysId || '?'} screen ${n}`)
	}
	return out
}

/**
 * @param {object} config
 * @param {{ layout?: object }} [opts]
 * @returns {object}
 */
function describeOperatorDisplay(config, opts = {}) {
	const layout = opts.layout || calculateLayoutPositions(config)
	const monitorRect = resolveOperatorMonitorRect(config, layout)
	const guiRect = resolveOperatorDisplayRect(config, layout)
	const interactiveAllowance = listInteractiveConsumerSummaries(config, layout)
	return {
		rect: monitorRect,
		guiRect,
		summary: formatOperatorDisplaySummary(monitorRect),
		guiSummary: guiRect ? formatOperatorDisplaySummary(guiRect).replace('Operator monitor:', 'GUI tools target:') : null,
		interactiveAllowance,
		confineDesired: isOperatorPointerConfineDesired(config),
	}
}

module.exports = {
	readCasparSetting,
	operatorMonitorPortIndex,
	nvidiaSyncToDisplayPortIndex,
	resolveLayoutRectForOperatorPort,
	resolveOperatorMonitorRect,
	resolveOperatorDisplayRect,
	isOperatorPointerConfineDesired,
	formatOperatorDisplaySummary,
	describeOperatorDisplay,
	pointerOverInteractiveConsumer,
	pointerInConfineAllowance,
	// WO-290: the operator-monitor picker hit-tests the click against the connected outputs with
	// the SAME half-open rect test the confinement uses — no second opinion about "which screen".
	pointerInRect,
	screenConsumerEnabled,
	screenInteractiveEnabled,
	multiviewScreenConsumerEnabled,
	multiviewInteractiveEnabled,
	multiviewPhysicalPortIndex,
}
