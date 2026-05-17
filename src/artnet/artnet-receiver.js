'use strict'

const dmxnet = require('dmxnet')
const { buildPipOverlayCgPayload } = require('../engine/pip-overlay-utils')

const GLOBAL_BORDER_LAYER = 998

class ArtnetReceiver {
	constructor(appCtx) {
		this.appCtx = appCtx
		this.log = appCtx.log || console.log
		this.artnet = null
		this.receiver = null
		this.lastData = null
		// Per-channel: which border template (type) is currently loaded on the CG slot,
		// so we know to send CG ADD on first activation / type change vs CG UPDATE otherwise.
		this._addedTypeByChannel = new Map()
	}

	_resolveProgramChannel() {
		// Mirror the routing/config logic that the take pipeline uses, so DMX targets
		// the same Caspar channel that the global border is actually being rendered on.
		try {
			const { getChannelMap } = require('../config/routing')
			const cm = getChannelMap(this.appCtx.config || {}, this.appCtx.switcherOutputBusByChannel)
			const ch = cm?.programChannels?.[0]
			if (Number.isFinite(ch) && ch >= 1) return ch
		} catch (_) {}
		return 1
	}

	init(options = {}) {
		if (this.artnet) return
		
		try {
			this.artnet = new dmxnet.dmxnet({
				log: { level: 'error' },
				...options
			})

			const universe = options.universe || 0
			this.receiver = this.artnet.newReceiver({
				universe: universe
			})

			this.receiver.on('data', (data) => {
				this.handleData(data)
			})

			this.log('info', `[ArtNet] Receiver started on universe ${universe}`)
		} catch (e) {
			this.log('error', `[ArtNet] Failed to start receiver: ${e.message}`)
		}
	}

	handleData(data) {
		if (!data || data.length === 0) return

		if (!this.lastData) {
			this.lastData = [...data]
			this.log('info', `[ArtNet] Initialized baseline data (first 10 channels: ${data.slice(0, 10).join(',')})`)
			return
		}

		// Find changed channels
		const changedIndices = new Set()
		for (let i = 0; i < data.length; i++) {
			if (data[i] !== this.lastData[i]) {
				changedIndices.add(i)
			}
		}

		if (changedIndices.size === 0) return

		this.log('info', `[ArtNet] Received data change. Changed DMX indices: ${[...changedIndices].join(',')}`)
		this.lastData = [...data]

		const liveSceneState = require('../state/live-scene-state')
		const channel = this._resolveProgramChannel()
		const live = liveSceneState.getChannel(channel)

		if (!live || !live.scene) return
		const scene = live.scene
		const gb = scene.globalBorder

		if (!gb || !gb.enabled) return
		
		const patch = gb.artnetPatch || { startChannel: 1, universe: 0 }
		const start = (patch.startChannel || 1) - 1 // DMX is 1-based, array is 0-based
		
		const params = { ...gb.params, side: 'inside' } // start with defaults and enforce inside
		if (params.opacity == null) params.opacity = 1
		
		// Helper to get hex color from 3 channels
		const getHex = (r, g, b) => `#${this._toHex(r)}${this._toHex(g)}${this._toHex(b)}`

		let updated = false

		// 1. On/Off
		if (changedIndices.has(start)) {
			const wasEnabled = params.enabled
			params.enabled = data[start] >= 128
			if (params.enabled && !wasEnabled && params.opacity === 0) {
				params.opacity = 1 // Auto-correct stuck opacity
			}
			updated = true
		}
		
		// 2. Type
		let typeChanged = false
		if (changedIndices.has(start + 1)) {
			const val = data[start + 1]
			let newType = 'border'
			if (val < 64) newType = 'border'
			else if (val < 128) newType = 'glow'
			else if (val < 192) newType = 'edge_strip'
			else newType = 'shadow'
			
			if (newType !== params.type) {
				typeChanged = true
				params.type = newType
			}
			updated = true
		}
		
		// 3. Opacity
		if (changedIndices.has(start + 2)) {
			params.opacity = data[start + 2] / 255
			updated = true
		}
		
		// 4-6. Color (RGB)
		if (changedIndices.has(start + 3) || changedIndices.has(start + 4) || changedIndices.has(start + 5)) {
			const r = (start + 3 < data.length) ? data[start + 3] : (this.lastData[start + 3] || 0)
			const g = (start + 4 < data.length) ? data[start + 4] : (this.lastData[start + 4] || 0)
			const b = (start + 5 < data.length) ? data[start + 5] : (this.lastData[start + 5] || 0)
			params.color = getHex(r, g, b)
			updated = true
		}
		
		// 7. Width / Thickness / Intensity
		if (changedIndices.has(start + 6)) {
			const val = data[start + 6]
			params.width = (val / 255) * 50
			params.intensity = (val / 255) * 50 // map to both width and intensity
			updated = true
		}
		
		// 8. Speed
		if (changedIndices.has(start + 7)) {
			params.speed = 0.1 + (data[start + 7] / 255) * 9.9
			updated = true
		}
		
		// 9. Spread / Blur
		if (changedIndices.has(start + 8)) {
			params.spread = (data[start + 8] / 255) * 20
			params.blur = (data[start + 8] / 255) * 50
			updated = true
		}
		
		// 10-12. Glow Color (RGB)
		if (changedIndices.has(start + 9) || changedIndices.has(start + 10) || changedIndices.has(start + 11)) {
			const r = (start + 9 < data.length) ? data[start + 9] : (this.lastData[start + 9] || 0)
			const g = (start + 10 < data.length) ? data[start + 10] : (this.lastData[start + 10] || 0)
			const b = (start + 11 < data.length) ? data[start + 11] : (this.lastData[start + 11] || 0)
			params.glowColor = getHex(r, g, b)
			updated = true
		}
		
		// 13. Radius
		if (changedIndices.has(start + 12)) {
			params.radius = (data[start + 12] / 255) * 50
			updated = true
		}
		
		// 14. Count
		if (changedIndices.has(start + 13)) {
			params.count = Math.floor((data[start + 13] / 255) * 12) + 1
			updated = true
		}
		
		// 15. Length
		if (changedIndices.has(start + 14)) {
			params.length = 5 + (data[start + 14] / 255) * 95
			updated = true
		}

		// 16–18: Glow/shadow segmentation (WO-44; templates may ignore until implemented)
		// Apply mode (Ch 18) before segment count (Ch 16) so one frame can enable uniform + set N.
		const dmxSegmentsToN = (byte) => Math.max(1, Math.min(32, Math.round((byte / 255) * 31) + 1))
		if (changedIndices.has(start + 17)) {
			const v = start + 17 < data.length ? data[start + 17] : 0
			params.segmentMode = v >= 128 ? 'uniform' : 'full'
			if (params.segmentMode === 'full') {
				params.segmentsPerEdge = 1
			} else if (start + 15 < data.length) {
				params.segmentsPerEdge = dmxSegmentsToN(data[start + 15])
			}
			updated = true
		}
		if (changedIndices.has(start + 15)) {
			if ((params.segmentMode || 'full') === 'uniform') {
				const v = start + 15 < data.length ? data[start + 15] : 0
				params.segmentsPerEdge = dmxSegmentsToN(v)
				updated = true
			}
		}
		if (changedIndices.has(start + 16)) {
			const v = start + 16 < data.length ? data[start + 16] : 0
			params.segmentEase = Math.max(0, Math.min(1, v / 255))
			updated = true
		}

		// If disabled via DMX, force opacity to 0 to hide it
		const payloadParams = { ...params }
		if (params.enabled === false) {
			payloadParams.opacity = 0
		}

		if (!updated) return

		this.log('debug', `[ArtNet] Dynamic Border update: ${JSON.stringify(payloadParams)}`)

		// Update state so UI reflects changes
		gb.params = params
		liveSceneState.setChannel(channel, live)
		liveSceneState.broadcastSceneLive(this.appCtx)

		// First DMX activation, or template type changed, requires CG ADD (UPDATE on a
		// missing CG silently does nothing — that's the "only width works" symptom).
		const currentType = String(payloadParams.type || 'border')
		const lastType = this._addedTypeByChannel.get(channel)
		const needsAdd = typeChanged || lastType !== currentType
		this.updateBorder(channel, payloadParams, needsAdd, gb.slices || [])
		this._addedTypeByChannel.set(channel, currentType)
	}

	updateBorder(channel, params, forceAdd = false, slices = []) {
		const amcp = this.appCtx.amcp
		if (!amcp?.isConnected) {
			this.log('warn', '[ArtNet] Cannot update border, AMCP not connected')
			return
		}

		const layer = GLOBAL_BORDER_LAYER
		const overlay = { type: params.type || 'border', params: params, slices: slices }

		const { buildGlobalBorderAmcpLines, buildGlobalBorderUpdateLines } = require('../engine/global-border')

		const lines = forceAdd
			? buildGlobalBorderAmcpLines(channel, layer, overlay, this.appCtx, { initialOpacity: 1 })
			: buildGlobalBorderUpdateLines(channel, layer, overlay)

		for (const line of lines) {
			amcp.raw(line).catch(e => {
				this.log('error', `[ArtNet] Failed to send AMCP: ${e.message}`)
			})
		}
		if (lines.some((l) => /\bDEFER\b/i.test(String(l)))) {
			void amcp.mixerCommit(channel).catch((e) => {
				this.log('error', `[ArtNet] MIXER COMMIT failed: ${e.message}`)
			})
		}
	}

	_toHex(val) {
		const hex = Math.max(0, Math.min(255, Math.round(val))).toString(16)
		return hex.length === 1 ? '0' + hex : hex
	}

	_isEqual(arr1, arr2) {
		if (arr1.length !== arr2.length) return false
		for (let i = 0; i < arr1.length; i++) {
			if (arr1[i] !== arr2[i]) return false
		}
		return true
	}

	stop() {
		this.receiver = null
		this.artnet = null
		this.log('info', '[ArtNet] Receiver stopped')
	}
}

module.exports = { ArtnetReceiver }
