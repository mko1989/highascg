'use strict'

const { MODULE_ID, normalizeHelloPreview } = require('./contract')

/**
 * Tracks connected companion-module-highpass-highascg WebSocket clients and
 * merged preview demand (what to encode / push over variable_update).
 */
class CompanionBridgeRegistry {
	constructor() {
		/** @type {Map<object, { moduleId: string, instanceId: string, preview: ReturnType<typeof normalizeHelloPreview>, at: number }>} */
		this._clients = new Map()
	}

	/**
	 * @param {object} ws
	 * @param {object} [hello]
	 */
	register(ws, hello) {
		if (!ws || !hello || typeof hello !== 'object') return false
		if (String(hello.moduleId ?? '') !== MODULE_ID) return false
		this._clients.set(ws, {
			moduleId: MODULE_ID,
			instanceId: String(hello.instanceId ?? '').trim(),
			preview: normalizeHelloPreview(hello.preview),
			at: Date.now(),
		})
		return true
	}

	/**
	 * @param {object} ws
	 */
	unregister(ws) {
		this._clients.delete(ws)
	}

	clear() {
		this._clients.clear()
	}

	/** @returns {number} */
	clientCount() {
		return this._clients.size
	}

	hasClients() {
		return this._clients.size > 0
	}

	/**
	 * Merged preview demand across all registered Companion clients.
	 * When no clients registered, returns null (legacy: follow server config only).
	 * @returns {{ enabled: boolean, channels: number[] | null, quadrants: boolean, lookAirFrames: boolean } | null}
	 */
	getMergedPreviewDemand() {
		if (this._clients.size === 0) return null

		let enabled = false
		let quadrants = false
		let lookAirFrames = false
		/** @type {Set<number>} */
		const channels = new Set()

		for (const entry of this._clients.values()) {
			const p = entry.preview
			if (!p.enabled) continue
			enabled = true
			if (p.quadrants) quadrants = true
			if (p.lookAirFrames) lookAirFrames = true
			for (const ch of p.channels) channels.add(ch)
		}

		return {
			enabled,
			channels: channels.size > 0 ? [...channels].sort((a, b) => a - b) : null,
			quadrants,
			lookAirFrames,
		}
	}

	/**
	 * Whether to push full-frame compose preview for a channel.
	 * Hello channel list is advisory; server monitored channels are authoritative.
	 * @param {number} channel
	 * @param {number[]} [monitoredChannels]
	 */
	shouldPushChannelImage(channel, monitoredChannels = []) {
		const demand = this.getMergedPreviewDemand()
		if (!demand) return true
		if (!demand.enabled) return false
		const ch = parseInt(String(channel), 10)
		if (!Number.isFinite(ch) || ch < 1) return false
		return monitoredChannels.includes(ch)
	}

	shouldPushQuadrants() {
		const demand = this.getMergedPreviewDemand()
		if (!demand) return true
		return demand.enabled && demand.quadrants
	}

	shouldPushLookAirFrames() {
		const demand = this.getMergedPreviewDemand()
		if (!demand) return true
		return demand.enabled && demand.lookAirFrames
	}

	shouldPushAnyPreview() {
		const demand = this.getMergedPreviewDemand()
		if (!demand) return true
		return demand.enabled
	}
}

/** @type {CompanionBridgeRegistry | null} */
let _singleton = null

function getCompanionBridgeRegistry() {
	if (!_singleton) _singleton = new CompanionBridgeRegistry()
	return _singleton
}

module.exports = {
	CompanionBridgeRegistry,
	getCompanionBridgeRegistry,
}
