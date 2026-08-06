'use strict'

const { PATCH_CHANNEL_COUNT } = require('./artnet-constants')
const { copyPatchWindow } = require('./artnet-packet')
const { patchMappedBytesChanged, computeBorderFromDmx, overlayApplyKey } = require('./artnet-dmx-border')
const {
	artnetScreenIndex,
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

/**
 * Shared core of the Art-Net and sACN global-border receivers (WO-446; the two classes were
 * line-for-line copies apart from the transport).
 *
 * Subclass contract — a transport provides:
 *   _tag()                                  log prefix ('[ArtNet]' / '[sACN]')
 *   _protocolName()                         name used in operator-facing warnings
 *   _defaultPort()                          input port when neither options nor config give one
 *   _statsHead(s)                           protocol-specific head of the periodic stats line
 *   _applyInitOverrides(resolved, options)  copy the init() overrides this protocol supports
 *   _initTransport()                        end of init() — first bind
 *   _ensureListening()                      end of reconfigure() — lazy (re-)bind
 *
 * The transport handle MUST live in `this._socket` (whatever its type — it only needs a
 * close()): artnet-runtime.js reads `_socket`, `_artnetListenEnabled`, `_inputNet`,
 * `_inputSubnet` and `_artnetScreenIndex()` by name on receivers of BOTH protocols, so those
 * stay on the base even where a protocol never varies them.
 */
class DmxBorderReceiverBase {
	constructor(appCtx) {
		this.appCtx = appCtx
		this.log = appCtx.log || console.log
		this._socket = null
		this.lastData = null
		this._stats = {
			udp: 0,
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
		this._inputNet = 0
		this._inputSubnet = 0
		this._inputUniverse = 0
		this._inputPort = this._defaultPort()
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
		this._artnetListenEnabled = false
		this._projectScenesCache = null
		/** screenIndex values we already logged “no global border” for (avoid periodic reconfigure spam). */
		this._warnedNoGlobalBorder = new Set()
	}

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
			`${this._tag()} ${this._statsHead(s)} matched=${s.matched} handled=${s.handled} ` +
				`unchanged=${s.unchanged} listenOff=${s.listenOff} wrongUni=${s.wrongUniverse} ` +
				`noTarget=${s.noTarget} parseFail=${s.parseFail} errors=${s.errors} ` +
				`listen=${this._effectiveListen()} target=${this._targetConfigured}`,
		)
	}

	_artnetScreenIndex(dmx = null) {
		return artnetScreenIndex(dmx || this.appCtx.config?.dmx || {})
	}

	_isMasterDmxEnabled() {
		return this.appCtx.config?.dmx?.artnetInputEnabled !== false
	}

	_effectiveListen() {
		if (!this._isMasterDmxEnabled()) return false
		if (!this._targetConfigured) return false
		return this._artnetListenEnabled
	}

	_reloadSlotConfig(slot) {
		this._channelMap = normalizeChannelMap(slot)
		this._artnetListenEnabled = slotListenEnabled(slot)
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
			this._artnetListenEnabled = false
			this._channelMap = Array(PATCH_CHANNEL_COUNT).fill(true)
			if (!this._warnedNoGlobalBorder.has(screenIdx)) {
				this._warnedNoGlobalBorder.add(screenIdx)
				this.log(
					'warn',
					`${this._tag()} globalBorders[${screenIdx}] is null — ${this._protocolName()} input paused until a global border exists on main screen ${screenIdx + 1}`,
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
		this._ensureListening()
		return changed
	}

	init(options = {}) {
		if (this._socket) return

		const dmx = this.appCtx.config?.dmx || {}
		this._inputPort = options.port ?? dmx.artnetInputPort ?? this._defaultPort()
		this._logIntervalMs = this._resolveLogIntervalMs(dmx, options)
		this._wsBroadcastIntervalMs = this._resolveWsBroadcastIntervalMs(dmx, options)
		this._statsLogIntervalMs = this._resolveStatsLogIntervalMs(dmx, options)

		const resolved = this._resolveArtnetPatch()
		this._applyInitOverrides(resolved, options)

		const screenIdx = resolved.screenIndex ?? 0
		const slot = this._globalBorderSlot(screenIdx)
		this._targetConfigured = !!slot
		if (!slot) {
			this.log(
				'warn',
				`${this._tag()} globalBorders[${screenIdx}] is null (main screen ${screenIdx + 1}) — ` +
					`no ${this._protocolName()} target. Create a global border on that screen in the UI, or set dmx.artnetInputScreenIndex.`,
			)
			return
		}

		this._reloadSlotConfig(slot)
		this._applyPatch(resolved, 'init')
		this._initTransport()
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
			this.log('info', `${this._tag()} Border load ch${channel} type=${type}`)
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
		if (this._socket) {
			try {
				this._socket.close()
			} catch (_) {}
			this._socket = null
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
		this.log('info', `${this._tag()} Receiver stopped`)
	}
}

module.exports = { DmxBorderReceiverBase }
