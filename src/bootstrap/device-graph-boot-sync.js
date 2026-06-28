'use strict'

const { normalizeDeviceGraph, suggestConnectorsAndDevicesFromLive, mergeHardwareSync } = require('../config/device-graph')

/**
 * Minimal live snapshot for suggestConnectorsAndDevicesFromLive from startup inventory.
 * @param {object} payload
 */
function buildLiveFromInventoryPayload(payload) {
	return {
		gpu: payload?.gpu || {},
		decklink: payload?.decklink || { connectors: [] },
		audio: payload?.audio || {},
	}
}

function graphJson(graph) {
	return JSON.stringify(normalizeDeviceGraph(graph))
}

/**
 * Reconcile deviceGraph GPU/DeckLink connectors with probed hardware at startup
 * (same merge as Device View "sync from live", without operator action).
 *
 * @param {{ config: object, configManager?: { get: () => object, save: (c: object) => boolean } | null, payload: object, log?: (level: string, msg: string) => void }} opts
 * @returns {{ updated: boolean, saved?: boolean, skipped?: boolean }}
 */
function ensureDeviceGraphHardwareSyncFromLive(opts) {
	const raw = String(process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC ?? '1').trim().toLowerCase()
	if (raw === '0' || raw === 'false' || raw === 'off') {
		return { updated: false, skipped: true }
	}

	const config = opts?.config
	const payload = opts?.payload
	if (!config || !payload) return { updated: false }

	const live = buildLiveFromInventoryPayload(payload)
	const suggested = suggestConnectorsAndDevicesFromLive(live, config)
	const merged = mergeHardwareSync(config.deviceGraph, suggested)
	const before = graphJson(config.deviceGraph)
	const after = graphJson(merged)
	if (before === after) return { updated: false }

	config.deviceGraph = merged
	const cm = opts?.configManager
	const log = opts?.log
	if (cm && typeof cm.get === 'function' && typeof cm.save === 'function') {
		const saved = cm.save({ ...cm.get(), deviceGraph: merged })
		if (typeof log === 'function') {
			const gpuBefore = (normalizeDeviceGraph(JSON.parse(before)).connectors || []).filter((c) => c.kind === 'gpu_out').length
			const gpuAfter = (normalizeDeviceGraph(merged).connectors || []).filter((c) => c.kind === 'gpu_out').length
			if (saved) {
				log(
					'info',
					`[device-graph] boot hardware sync saved (${gpuBefore}→${gpuAfter} gpu_out ports from live probe)`,
				)
			} else {
				log('warn', '[device-graph] boot hardware sync applied in memory but failed to persist config')
			}
		}
		return { updated: true, saved: !!saved }
	}

	if (typeof log === 'function') {
		log('info', '[device-graph] boot hardware sync applied in memory (no configManager)')
	}
	return { updated: true, saved: false }
}

module.exports = {
	buildLiveFromInventoryPayload,
	ensureDeviceGraphHardwareSyncFromLive,
}
