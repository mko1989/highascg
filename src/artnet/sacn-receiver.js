'use strict'

const { Receiver: SacnReceiverImpl } = require('sacn')
const { PATCH_CHANNEL_COUNT } = require('./artnet-constants')
const { copyPatchWindow } = require('./artnet-packet')
const { patchMappedBytesChanged, computeBorderFromDmx, overlayApplyKey } = require('./artnet-dmx-border')
const {
	slotListenEnabled,
	normalizeChannelMap,
	runtimeParamsFromSlot,
	resolveArtnetPatch,
	loadProjectScenesForLookup,
	globalBorderSlotFromScenes,
	resolveProgramChannel,
} = require('./artnet-slot-config')
const { broadcastGlobalBorderToClient, flushCasparBorder } = require('./artnet-output')
const { applyPatch, logListenState, getInputStatus } = require('./artnet-runtime')

class SacnReceiver {
	constructor(appCtx) {
		this.appCtx = appCtx
		this.log = appCtx.log || console.log
		this._sacnReceiver = null
		this.lastData = null
		this._stats = {
			udp: 0,
			dmx: 0,
			matched: 0,
			noTarget: 0,
			wrongUniverse: 0,
			parseFail: 0,
			listenOff: 0,
			unchanged: 0,
			handled: 0,
			errors: 0,
		}
		this._lastStatsLogMs = 0
		this._statsLogIntervalMs = 10_000
		this._inputUniverse = 0
		this._inputPort = 5568
		this._startChannel = 1
		this._portKey = 0
		this._lastPatchLogMs = 0
		this._logIntervalMs = 60_000
		this._runtimeParams = { side: 'inside', opacity: 1, type: 'border', enabled: false }
		this._addedTypeByChannel = new Map()
		this._lastAppliedKey = null
		this._casparFlushTimer = null
		this._pendingCaspar = null
		this._wsFlushTimer = null
		this._pendingWs = null
		this._lastWsBroadcastMs = 0
		this._wsBroadcastIntervalMs = 500
		this._targetScreenIndex = 0
		this._targetConfigured = false
		this._channelMap = Array(PATCH_CHANNEL_COUNT).fill(true)
		this._sacnListenEnabled = false
		this._projectScenesCache = null
		this._warnedNoGlobalBorder = new Set()
	}

	static PATCH_CHANNEL_COUNT = PATCH_CHANNEL_COUNT

	_resolveProgramChannel() {
		return resolveProgramChannel(this.appCtx, this._targetScreenIndex)
	}

	_resolveLogIntervalMs(dmx, options) {
		if (options.logIntervalMs != null) return Math.max(0, options.logIntervalMs)
		if (dmx.artnetInputLogIntervalMs != null) return Math.max(0, dmx.artnetInputLogIntervalMs)
		return 60_000
	}

	_resolveWsBroadcastIntervalMs(dmx, options) {
		if (options.wsBroadcastIntervalMs != null) return Math.max(50, options.wsBroadcastIntervalMs)
		if (dmx.artnetInputWsIntervalMs != null) return Math.max(50, dmx.artnetInputWsIntervalMs)
		return 500
	}

	_resolveStatsLogIntervalMs(dmx, options) {
		if (options.statsLogIntervalMs != null) return Math.max(0, options.statsLogIntervalMs)
		if (dmx.artnetInputStatsIntervalMs != null) return Math.max(0, dmx.artnetInputStatsIntervalMs)
		return 10_000
	}

	_bumpStat(key) {
		if (this._stats[key] != null) this._stats[key]++
	}

	_throttledDropLog(key, message) {
		const now = Date.now()
		const prev = this._warnThrottle?.get(key) || 0
		if (now - prev < 30_000) return
		if (!this._warnThrottle) this._warnThrottle = new Map()
		this._warnThrottle.set(key, now)
		this.log('warn', message)
	}

	_maybeLogStats() {
		if (this._statsLogIntervalMs <= 0) return
		const now = Date.now()
		if (this._lastStatsLogMs && now - this._lastStatsLogMs < this._statsLogIntervalMs) return
		this._lastStatsLogMs = now
		const s = this._stats
		this.log(
			'info',
			`[sACN] rx dmx=${s.dmx} matched=${s.matched} handled=${s.handled} ` +
				`unchanged=${s.unchanged} listenOff=${s.listenOff} wrongUni=${s.wrongUniverse} ` +
				`noTarget=${s.noTarget} parseFail=${s.parseFail} errors=${s.errors} ` +
				`listen=${this._effectiveListen()} target=${this._targetConfigured}`,
		)
	}

	_isMasterDmxEnabled() {
		return this.appCtx.config?.dmx?.artnetInputEnabled !== false
	}

	_effectiveListen() {
		if (!this._isMasterDmxEnabled()) return false
		if (!this._targetConfigured) return false
		return this._sacnListenEnabled
	}

	_reloadSlotConfig(slot) {
		this._channelMap = normalizeChannelMap(slot)
		this._sacnListenEnabled = slotListenEnabled(slot)
		this._runtimeParams = runtimeParamsFromSlot(slot)
		this._lastAppliedKey = null
		this.lastData = null
	}

	_resolveArtnetPatch() {
		return resolveArtnetPatch(this.appCtx, null, this._projectScenesCache)
	}

	_projectScenesForLookup() {
		return loadProjectScenesForLookup(this.appCtx, this._projectScenesCache)
	}

	_globalBorderSlot(screenIdx) {
		return globalBorderSlotFromScenes(this._projectScenesForLookup(), screenIdx)
	}

	getInputStatus() {
		return getInputStatus(this)
	}

	_applyPatch(patch, source = 'config') {
		return applyPatch(this, patch, source)
	}

	reconfigureFromProject(project) {
		if (project?.scenes && typeof project.scenes === 'object') {
			this._projectScenesCache = project.scenes
		} else {
			this._projectScenesCache = null
		}
		return this.reconfigure()
	}

	reconfigure(patch = null) {
		const dmx = this.appCtx.config?.dmx || {}
		this._logIntervalMs = this._resolveLogIntervalMs(dmx, {})
		this._wsBroadcastIntervalMs = this._resolveWsBroadcastIntervalMs(dmx, {})
		this._statsLogIntervalMs = this._resolveStatsLogIntervalMs(dmx, {})
		const resolved = patch || this._resolveArtnetPatch()
		const source = patch ? 'explicit' : this._projectScenesCache ? 'project' : 'disk'
		const screenIdx = resolved.screenIndex ?? 0
		const slot = this._globalBorderSlot(screenIdx)
		this._targetConfigured = !!slot
		if (!slot) {
			this._sacnListenEnabled = false
			this._channelMap = Array(PATCH_CHANNEL_COUNT).fill(true)
			if (!this._warnedNoGlobalBorder.has(screenIdx)) {
				this._warnedNoGlobalBorder.add(screenIdx)
				this.log(
					'warn',
					`[sACN] globalBorders[${screenIdx}] is null — sACN input paused until a global border exists on main screen ${screenIdx + 1}`,
				)
			}
			return false
		}
		this._warnedNoGlobalBorder.delete(screenIdx)
		this._reloadSlotConfig(slot)
		const changed = this._applyPatch(resolved, source)
		if (this._effectiveListen()) {
			this.lastData = null
			this._lastAppliedKey = null
		}
		logListenState(this, screenIdx, slot, source)
		this._projectScenesCache = null
		this._ensureSacnListening()
		return changed
	}

	init(options = {}) {
		if (this._sacnReceiver) return

		const dmx = this.appCtx.config?.dmx || {}
		this._inputPort = options.port ?? dmx.artnetInputPort ?? 5568
		this._logIntervalMs = this._resolveLogIntervalMs(dmx, options)
		this._wsBroadcastIntervalMs = this._resolveWsBroadcastIntervalMs(dmx, options)
		this._statsLogIntervalMs = this._resolveStatsLogIntervalMs(dmx, options)

		const resolved = this._resolveArtnetPatch()
		if (options.universe != null) resolved.universe = options.universe
		if (options.startChannel != null) resolved.startChannel = options.startChannel
		if (options.screenIndex != null) resolved.screenIndex = options.screenIndex

		const screenIdx = resolved.screenIndex ?? 0
		const slot = this._globalBorderSlot(screenIdx)
		this._targetConfigured = !!slot
		if (!slot) {
			this.log(
				'warn',
				`[sACN] globalBorders[${screenIdx}] is null (main screen ${screenIdx + 1}) — ` +
					'no sACN target. Create a global border on that screen in the UI, or set dmx.artnetInputScreenIndex.',
			)
			return
		}

		this._reloadSlotConfig(slot)
		this._applyPatch(resolved, 'init')
		this._ensureSacnListening()
	}

	_ensureSacnListening() {
		if (!this._effectiveListen()) return

		if (this._sacnReceiver) return

		try {
			this._sacnReceiver = new SacnReceiverImpl({
				universes: [this._inputUniverse],
				port: this._inputPort,
				reuseAddr: true,
			})

			this._sacnReceiver.on('packet', (packet) => {
				this._bumpStat('udp')
				this._handleSacnPacket(packet)
			})

			this._sacnReceiver.on('error', (err) => {
				this._bumpStat('errors')
				this._throttledDropLog('sacn-error', `[sACN] Error: ${err?.message || err}`)
			})

			this.log('info', `[sACN] Receiver listening on universe ${this._inputUniverse}, port ${this._inputPort}`)
		} catch (err) {
			this._bumpStat('errors')
			this.log('error', `[sACN] Failed to initialize receiver: ${err?.message || err}`)
		}
	}

	_handleSacnPacket(packet) {
		if (!packet || !packet.payload) return
		if (packet.universe !== this._inputUniverse) {
			this._bumpStat('wrongUniverse')
			return
		}

		this._bumpStat('dmx')

		// Convert sACN payload object to a byte buffer
		// sACN payload is { 1: value, 2: value, ... } where keys are 1-based channel numbers
		const buffer = Buffer.alloc(512, 0)
		for (const [ch, val] of Object.entries(packet.payload)) {
			const chNum = parseInt(ch, 10)
			if (chNum >= 1 && chNum <= 512) {
				buffer[chNum - 1] = Math.min(255, Math.max(0, Math.round(val)))
			}
		}

		this.handleData(buffer)
	}

	handleData(data) {
		if (!data || data.length === 0) return
		if (!this._effectiveListen()) return

		const start = this._startChannel - 1
		const window = copyPatchWindow(data, start)
		const prev = this.lastData
		if (!patchMappedBytesChanged(prev, window, this._channelMap)) {
			this._bumpStat('unchanged')
			this.lastData = window
			return
		}

		this.lastData = window
		this._bumpStat('handled')

		const { params, payloadParams, type } = computeBorderFromDmx(data, start, this._channelMap, this._runtimeParams)
		const applyKey = overlayApplyKey(type, payloadParams)

		const channel = this._resolveProgramChannel()
		const prevType = this._addedTypeByChannel.get(channel)
		const typeChanged = prevType != null && String(type) !== String(prevType)
		const needsAdd = prevType == null || typeChanged

		this._runtimeParams = params
		if (applyKey !== this._lastAppliedKey) {
			this._lastAppliedKey = applyKey
		}

		if (needsAdd) {
			this.log('info', `[sACN] Border load ch${channel} type=${type}`)
		}

		this._scheduleWsBroadcast(channel, params, type)
		const slot = this._globalBorderSlot(this._targetScreenIndex)
		const slices = Array.isArray(slot?.slices) ? slot.slices : []
		this._scheduleCasparBorder(channel, payloadParams, needsAdd, slices, type)
		this._addedTypeByChannel.set(channel, String(type))
	}

	_scheduleWsBroadcast(channel, params, type) {
		this._pendingWs = { channel, params, type }
		const now = Date.now()
		const due = now - this._lastWsBroadcastMs >= this._wsBroadcastIntervalMs
		if (due && !this._wsFlushTimer) {
			this._flushWsBroadcast()
			return
		}
		if (this._wsFlushTimer) return
		const wait = Math.max(0, this._wsBroadcastIntervalMs - (now - this._lastWsBroadcastMs))
		this._wsFlushTimer = setTimeout(() => {
			this._wsFlushTimer = null
			this._flushWsBroadcast()
		}, wait)
	}

	_flushWsBroadcast() {
		const pending = this._pendingWs
		this._pendingWs = null
		if (!pending) return
		this._lastWsBroadcastMs = Date.now()
		broadcastGlobalBorderToClient(
			this.appCtx,
			pending.channel,
			this._targetScreenIndex,
			pending.params,
			pending.type,
		)
	}

	_scheduleCasparBorder(channel, params, forceAdd, slices, type) {
		this._pendingCaspar = { channel, params, forceAdd, slices, type }
		if (forceAdd) {
			if (this._casparFlushTimer) {
				clearTimeout(this._casparFlushTimer)
				this._casparFlushTimer = null
			}
			this._flushCasparBorder()
			return
		}
		if (this._casparFlushTimer) {
			clearTimeout(this._casparFlushTimer)
		}
		this._casparFlushTimer = setTimeout(() => {
			this._casparFlushTimer = null
			this._flushCasparBorder()
		}, 16)
	}

	_flushCasparBorder() {
		const pending = this._pendingCaspar
		this._pendingCaspar = null
		flushCasparBorder(pending, this.appCtx, this.log)
	}

	stop() {
		if (this._sacnReceiver) {
			try {
				this._sacnReceiver.close()
			} catch (_) {}
			this._sacnReceiver = null
		}
		this.lastData = null
		this._lastAppliedKey = null
		if (this._casparFlushTimer) {
			clearTimeout(this._casparFlushTimer)
			this._casparFlushTimer = null
		}
		if (this._wsFlushTimer) {
			clearTimeout(this._wsFlushTimer)
			this._wsFlushTimer = null
		}
		this._pendingCaspar = null
		this._pendingWs = null
		this.log('info', '[sACN] Receiver stopped')
	}
}

module.exports = { SacnReceiver }
