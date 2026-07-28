'use strict'

const { getDisplayDetails, getGpuConnectorInventory } = require('./hardware-info')
const { buildGpuPhysicalMap } = require('./gpu-physical-map')

function readCasparSetting(config, key) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	if (config && Object.prototype.hasOwnProperty.call(config, key)) return config[key]
	return undefined
}

function portFlagEnabled(config, key) {
	const v = readCasparSetting(config, key)
	return v === true || v === 'true'
}

function isPseudoGpuConnectorName(name) {
	const s = String(name || '').trim().toLowerCase()
	if (!s) return true
	if (/^card\d+($|[\s:])/.test(s)) return true
	if (/^gpu\d+($|[\s:])/.test(s)) return true
	if (/^renderd\d+($|[\s:])/.test(s)) return true
	return false
}

/**
 * Resolve the operator monitor port using hardware detection + flag fallback.
 * Rules:
 * 1. Exactly one physical display connected → that port IS the operator monitor
 * 2. Multiple displays connected → explicit flag decides; if none set → null
 * 3. Detection unavailable → fall back to flag-only behavior ('fallback-flag' mode)
 *
 * @param {object} config
 * @param {object} [opts={}]
 * @param {Array} [opts.displays] injected for tests; defaults to getDisplayDetails()
 * @param {Array} [opts.connectors] injected for tests; defaults to filtered getGpuConnectorInventory()
 * @returns {{ port: number|null, mode: 'auto-single'|'flag'|'none'|'fallback-flag' }}
 */
function resolveOperatorMonitorPort(config, opts = {}) {
	let displays = opts.displays
	let connectors = opts.connectors

	// Try to get hardware info; fall back to flag-only if unavailable
	let fallbackMode = false
	if (displays == null || connectors == null) {
		try {
			if (!displays) {
				displays = getDisplayDetails() || []
			}
			if (!connectors) {
				const raw = getGpuConnectorInventory() || []
				connectors = raw.filter((c) => !isPseudoGpuConnectorName(c?.shortName || c?.name))
			}
		} catch (e) {
			// Detection threw; fall back to flag-only
			fallbackMode = true
			displays = []
			connectors = []
		}
	}

	// Ensure arrays
	displays = Array.isArray(displays) ? displays : []
	connectors = Array.isArray(connectors) ? connectors : []

	// If detection is unavailable or empty, use flag-only (fallback-flag mode)
	if (fallbackMode || (displays.length === 0 && connectors.length === 0)) {
		const flagPort = resolveFlagPort(config)
		return {
			port: flagPort,
			mode: 'fallback-flag',
		}
	}

	// Build the physical map to find connected ports
	let physicalMap
	try {
		physicalMap = buildGpuPhysicalMap({
			config: config || {},
			displays,
			connectors,
		})
	} catch (e) {
		// Map build failed; fall back to flag-only
		const flagPort = resolveFlagPort(config)
		return {
			port: flagPort,
			mode: 'fallback-flag',
		}
	}

	if (!physicalMap || !Array.isArray(physicalMap.ports)) {
		const flagPort = resolveFlagPort(config)
		return {
			port: flagPort,
			mode: 'fallback-flag',
		}
	}

	// Collect connected physical ports as 1-based flag indices. slotOrder is 0-based
	// (screen-consumer-port-resolve.js:39-40 is the canonical slotOrder+1 conversion);
	// unmapped rows get slotOrder 100+ and can never correspond to a screen_1..4 flag.
	const connectedPorts = []
	for (const entry of physicalMap.ports) {
		if (!entry || typeof entry !== 'object') continue
		const slot = Number(entry.slotOrder)
		if (!Number.isFinite(slot) || slot < 0 || slot > 3) continue
		if (entry.runtime?.connected) {
			connectedPorts.push(slot + 1)
		}
	}

	// Rule 1: Exactly one physical display connected
	if (connectedPorts.length === 1) {
		return {
			port: connectedPorts[0],
			mode: 'auto-single',
		}
	}

	// Rule 2: Multiple displays or none connected
	if (connectedPorts.length === 0) {
		// No displays at all; fall back to flag
		const flagPort = resolveFlagPort(config)
		return {
			port: flagPort,
			mode: flagPort != null ? 'fallback-flag' : 'none',
		}
	}

	// Multiple displays: use explicit flag, or null if not set
	const flagPort = resolveFlagPort(config)
	return {
		port: flagPort,
		mode: flagPort != null ? 'flag' : 'none',
	}
}

/**
 * Resolve the flag-only operator monitor port index.
 * @param {object} config
 * @returns {number|null} 1-based physical GPU port index
 */
function resolveFlagPort(config) {
	for (let n = 1; n <= 4; n++) {
		if (portFlagEnabled(config, `screen_${n}_operator_monitor`)) return n
	}
	return null
}

module.exports = {
	resolveOperatorMonitorPort,
	resolveFlagPort,
}
