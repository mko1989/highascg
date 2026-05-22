'use strict'

const fs = require('fs')
const path = require('path')
const dgram = require('dgram')

const GLOBAL_BORDER_LAYER = 998
const ARTNET_HEADER = 'Art-Net\u0000'
const OPCODE_ARTDMX = 0x5000

class ArtnetReceiver {
	constructor(appCtx) {
		this.appCtx = appCtx
		this.log = appCtx.log || console.log
		this._socket = null
		/** Last 18-channel patch window (relative offsets), not full 512 universe. */
		this.lastData = null
		this._stats = {
			udp: 0,
			artdmx: 0,
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
		this._inputPort = 6454
		this._startChannel = 1
		this._portKey = 0
		this._lastPatchLogMs = 0
		this._logIntervalMs = 60_000
		this._runtimeParams = { side: 'inside', opacity: 1, type: 'border', enabled: false }
		this._addedTypeByChannel = new Map()
		/** Last visual overlay sent to Caspar (skip duplicate AMCP). */
		this._lastAppliedKey = null
		/** Coalesced Caspar border flush (~60 Hz max). */
		this._casparFlushTimer = null
		this._pendingCaspar = null
		/** Throttled inspector WS sync (avoid client re-ADD on every DMX step). */
		this._wsFlushTimer = null
		this._pendingWs = null
		this._lastWsBroadcastMs = 0
		this._wsBroadcastIntervalMs = 500
		/** 0-based main screen index (globalBorders slot) for Art-Net + PGM border. */
		this._targetScreenIndex = 0
		this._targetConfigured = false
		/** Per-offset DMX apply mask from `globalBorders[].artnetChannelMap`. */
		this._channelMap = Array(ArtnetReceiver.PATCH_CHANNEL_COUNT).fill(true)
		this._artnetListenEnabled = true
		/** One-shot scenes from POST autosave/save (newest project before disk). */
		this._projectScenesCache = null
	}

	/** DMX channels mapped per global-border artnetPatch (1–18 relative to startChannel). */
	static PATCH_CHANNEL_COUNT = 18
	static DMX_HYST = 10

	_resolveProgramChannel() {
		const screenIdx = this._targetScreenIndex
		try {
			const { getChannelMap } = require('../config/routing')
			const cm = getChannelMap(this.appCtx.config || {}, this.appCtx.switcherOutputBusByChannel)
			const ch = cm?.programChannels?.[screenIdx] ?? cm?.programChannels?.[0]
			if (Number.isFinite(ch) && ch >= 1) return ch
		} catch (_) {}
		return 1
	}

	_portKeyFromPacket(msg) {
		if (!msg || msg.length < 16) return null
		const subuni = msg.readUInt8(14)
		const net = msg.readUInt8(15)
		return (subuni << 8) | net
	}

	_parseArtDmx(msg) {
		if (!msg || msg.length < 18) return null
		if (msg.toString('ascii', 0, 8) !== ARTNET_HEADER) return null
		const opcode = msg.readUInt16LE(8)
		if (opcode !== OPCODE_ARTDMX) return null
		// Many desks put a short value in the Length field (e.g. 2) but still send a full
		// DMX run in the UDP packet — match dmxnet: use actual packet size after the 18-byte header.
		const lengthField = msg.readUInt16LE(16)
		const packetPayload = Math.max(0, msg.length - 18)
		const payloadLen = Math.min(512, Math.max(lengthField, packetPayload))
		const data = []
		for (let i = 0; i < payloadLen; i++) {
			data.push(msg.readUInt8(18 + i))
		}
		return data
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
			`[ArtNet] rx udp=${s.udp} artdmx=${s.artdmx} matched=${s.matched} handled=${s.handled} ` +
				`unchanged=${s.unchanged} listenOff=${s.listenOff} wrongUni=${s.wrongUniverse} ` +
				`noTarget=${s.noTarget} parseFail=${s.parseFail} errors=${s.errors} ` +
				`listen=${this._effectiveListen()} target=${this._targetConfigured}`,
		)
	}

	/** Copy mapped patch window (18 bytes at startChannel) for stable diffs. */
	_copyPatchWindow(data, start) {
		const n = ArtnetReceiver.PATCH_CHANNEL_COUNT
		const out = new Array(n)
		for (let off = 0; off < n; off++) {
			const i = start + off
			out[off] = i >= 0 && i < data.length ? data[i] : 0
		}
		return out
	}

	/** Throttled patch snapshot (default once per minute). */
	_maybeLogPatchChannels(data) {
		if (this._logIntervalMs <= 0) return
		const now = Date.now()
		if (this._lastPatchLogMs && now - this._lastPatchLogMs < this._logIntervalMs) return
		this._lastPatchLogMs = now
		const start = this._startChannel - 1
		const n = ArtnetReceiver.PATCH_CHANNEL_COUNT
		const vals = []
		for (let i = 0; i < n; i++) vals.push(this._readByte(data, start + i))
		this.log(
			'info',
			`[ArtNet] universe=${this._inputUniverse} ch${this._startChannel}-${this._startChannel + n - 1}: ${vals.join(',')}`,
		)
	}

	_artnetScreenIndex(dmx = null) {
		const cfg = dmx || this.appCtx.config?.dmx || {}
		const idx = parseInt(String(cfg.artnetInputScreenIndex ?? 0), 10)
		return Number.isFinite(idx) && idx >= 0 && idx <= 3 ? idx : 0
	}

	_loadProjectScenes() {
		try {
			const { loadProjectScenes } = require('../engine/project-scenes')
			return loadProjectScenes()
		} catch (_) {
			return null
		}
	}

	_isMasterDmxEnabled() {
		return this.appCtx.config?.dmx?.artnetInputEnabled !== false
	}

	/**
	 * Per-screen listen flag from `globalBorders[i].artnetListenEnabled` (not DMX).
	 * Missing / legacy → true. Also accepts top-level or mistaken `params` nesting.
	 */
	_slotListenEnabled(slot) {
		if (!slot || typeof slot !== 'object') return false
		const raw = slot.artnetListenEnabled ?? slot.params?.artnetListenEnabled
		if (raw === false || raw === 0 || raw === 'false' || raw === '0') return false
		return true
	}

	/** 18 booleans; missing/invalid → all enabled. */
	_normalizeChannelMap(slot) {
		const raw = slot?.artnetChannelMap
		if (!Array.isArray(raw)) return Array(ArtnetReceiver.PATCH_CHANNEL_COUNT).fill(true)
		const out = []
		for (let i = 0; i < ArtnetReceiver.PATCH_CHANNEL_COUNT; i++) {
			out.push(raw[i] !== false)
		}
		return out
	}

	_effectiveListen() {
		if (!this._isMasterDmxEnabled()) return false
		if (!this._targetConfigured) return false
		return this._artnetListenEnabled
	}

	_parseHexColor(hex) {
		const s = String(hex || '#000000').replace(/^#/, '')
		if (s.length >= 6) {
			return {
				r: parseInt(s.slice(0, 2), 16) || 0,
				g: parseInt(s.slice(2, 4), 16) || 0,
				b: parseInt(s.slice(4, 6), 16) || 0,
			}
		}
		return { r: 0, g: 0, b: 0 }
	}

	/** Reload listen flag, channel map, and runtime baseline from project slot. */
	_reloadSlotConfig(slot) {
		this._channelMap = this._normalizeChannelMap(slot)
		this._artnetListenEnabled = this._slotListenEnabled(slot)
		if (!slot) return
		const p = slot.params && typeof slot.params === 'object' ? slot.params : {}
		this._runtimeParams = {
			side: 'inside',
			enabled: slot.enabled !== false,
			type: slot.type || 'border',
			opacity: p.opacity != null ? Number(p.opacity) : 1,
			color: p.color != null ? String(p.color) : '#e63946',
			width: p.width != null ? Number(p.width) : 4,
			intensity: p.intensity != null ? Number(p.intensity) : p.width != null ? Number(p.width) : 15,
			speed: p.speed != null ? Number(p.speed) : 0.1,
			pulseSpeed: p.pulseSpeed != null ? Number(p.pulseSpeed) : 2,
			spread: p.spread != null ? Number(p.spread) : 0,
			blur: p.blur != null ? Number(p.blur) : 0,
			glowColor: p.glowColor != null ? String(p.glowColor) : '#000000',
			radius: p.radius != null ? Number(p.radius) : 0,
			count: p.count != null ? Number(p.count) : 1,
			length: p.length != null ? Number(p.length) : 5,
			segmentMode: p.segmentMode || p.segmentationMode || 'full',
			segmentationMode: p.segmentationMode || p.segmentMode || 'full',
			segmentsPerEdge: p.segmentsPerEdge != null ? Number(p.segmentsPerEdge) : 1,
			segmentEase: p.segmentEase != null ? Number(p.segmentEase) : 0,
			segmentation: p.segmentation != null ? Number(p.segmentation) : 0,
		}
		this._lastAppliedKey = null
		this.lastData = null
	}

	/** True if any enabled artnetChannelMap offset changed vs previous patch window. */
	_patchMappedBytesChanged(prevWindow, nextWindow) {
		if (!nextWindow) return false
		const map = this._channelMap
		for (let off = 0; off < ArtnetReceiver.PATCH_CHANNEL_COUNT; off++) {
			if (!map[off]) continue
			const next = nextWindow[off] ?? 0
			const old = prevWindow ? prevWindow[off] : undefined
			if (old === undefined || next !== old) return true
		}
		return !prevWindow
	}

	/**
	 * Universe/start channel from globalBorders[artnetInputScreenIndex].artnetPatch (UI inspector).
	 * Optional dmx.artnetInputUniverse / artnetInputStartChannel override when set in highascg.config.json.
	 */
	_resolveArtnetPatch() {
		const dmx = this.appCtx.config?.dmx || {}
		const screenIdx = this._artnetScreenIndex(dmx)
		const slot = this._globalBorderSlot(screenIdx)
		const patch = slot?.artnetPatch && typeof slot.artnetPatch === 'object' ? slot.artnetPatch : {}

		const cfgUniverse = parseInt(String(dmx.artnetInputUniverse ?? ''), 10)
		const cfgStart = parseInt(String(dmx.artnetInputStartChannel ?? ''), 10)

		return {
			net: Number.isFinite(parseInt(patch.net, 10)) ? parseInt(patch.net, 10) : (dmx.artnetInputNet ?? 0),
			subnet: Number.isFinite(parseInt(patch.subnet, 10))
				? parseInt(patch.subnet, 10)
				: (dmx.artnetInputSubnet ?? 0),
			universe: Number.isFinite(cfgUniverse)
				? cfgUniverse
				: Number.isFinite(parseInt(patch.universe, 10))
					? parseInt(patch.universe, 10)
					: 0,
			startChannel: Number.isFinite(cfgStart)
				? cfgStart
				: Number.isFinite(parseInt(patch.startChannel, 10))
					? parseInt(patch.startChannel, 10)
					: 1,
			screenIndex: screenIdx,
		}
	}

	getInputStatus() {
		const patch = this._resolveArtnetPatch()
		const screenIdx = patch.screenIndex ?? 0
		const slot = this._globalBorderSlot(screenIdx)
		const masterDmxEnabled = this._isMasterDmxEnabled()
		const artnetListenEnabled = slot ? this._slotListenEnabled(slot) : false
		const artnetChannelMap = slot ? this._normalizeChannelMap(slot) : Array(ArtnetReceiver.PATCH_CHANNEL_COUNT).fill(true)
		const effectiveListen =
			masterDmxEnabled && !!slot && artnetListenEnabled && this._targetConfigured
		const runtimeListen = this._artnetListenEnabled
		return {
			listening: !!this._socket,
			targetConfigured: this._targetConfigured,
			screenIndex: screenIdx,
			screenLabel: `main ${screenIdx + 1}`,
			programChannel: this._resolveProgramChannel(),
			globalBorderSlotPresent: !!slot,
			globalBorderEnabled: !!(slot && slot.enabled),
			masterDmxEnabled,
			artnetListenEnabled,
			slotArtnetListenRaw: slot?.artnetListenEnabled ?? null,
			runtimeArtnetListenEnabled: runtimeListen,
			artnetChannelMap,
			effectiveListen,
			patch: {
				net: this._inputNet,
				subnet: this._inputSubnet,
				universe: this._inputUniverse,
				startChannel: this._startChannel,
				portKeyHex: `0x${this._portKey.toString(16)}`,
			},
			resolvedFrom: {
				artnetPatch: slot?.artnetPatch || null,
				configOverrideUniverse: Number.isFinite(parseInt(String(this.appCtx.config?.dmx?.artnetInputUniverse ?? ''), 10)),
			},
			logIntervalMs: this._logIntervalMs,
			wsBroadcastIntervalMs: this._wsBroadcastIntervalMs,
			statsLogIntervalMs: this._statsLogIntervalMs,
			rxStats: { ...this._stats },
		}
	}

	_applyPatch(patch, source = 'config') {
		const net = Math.max(0, Math.min(127, parseInt(patch?.net, 10) || 0))
		const subnet = Math.max(0, Math.min(15, parseInt(patch?.subnet, 10) || 0))
		const universe = Math.max(0, Math.min(15, parseInt(patch?.universe, 10) || 0))
		const startChannel = Math.max(1, Math.min(512, parseInt(patch?.startChannel, 10) || 1))
		const subuni = (subnet << 4) | (universe & 0x0f)
		const portKey = (subuni << 8) | (net & 0xff)

		const changed =
			net !== this._inputNet ||
			subnet !== this._inputSubnet ||
			universe !== this._inputUniverse ||
			startChannel !== this._startChannel

		this._inputNet = net
		this._inputSubnet = subnet
		this._inputUniverse = universe
		this._startChannel = startChannel
		this._portKey = portKey
		this._targetScreenIndex = patch.screenIndex ?? this._artnetScreenIndex()

		if (changed) {
			this.lastData = null
			this._lastAppliedKey = null
			this.log(
				'info',
				`[ArtNet] Patch (${source}): net=${net} subnet=${subnet} universe=${universe} startCh=${startChannel} (port key=0x${portKey.toString(16)})`,
			)
		}
		return changed
	}

	/**
	 * Apply project from autosave/save body (avoids re-read race before disk flush).
	 * @param {object} [project] — full project payload (`project.scenes.globalBorders`)
	 */
	reconfigureFromProject(project) {
		if (project?.scenes && typeof project.scenes === 'object') {
			this._projectScenesCache = project.scenes
		} else {
			this._projectScenesCache = null
		}
		return this.reconfigure()
	}

	_projectScenesForLookup() {
		if (this._projectScenesCache && typeof this._projectScenesCache === 'object') {
			return this._projectScenesCache
		}
		return this._loadProjectScenes()
	}

	_globalBorderSlotFromScenes(scenes, screenIdx) {
		if (!scenes || !Array.isArray(scenes.globalBorders)) return null
		const gb = scenes.globalBorders[screenIdx]
		return gb && typeof gb === 'object' ? gb : null
	}

	_globalBorderSlot(screenIdx) {
		const scenes = this._projectScenesForLookup()
		if (!scenes) return null
		return this._globalBorderSlotFromScenes(scenes, screenIdx)
	}

	_logListenState(screenIdx, slot, source) {
		const master = this._isMasterDmxEnabled()
		const slotListen = slot ? this._slotListenEnabled(slot) : false
		const raw = slot?.artnetListenEnabled
		if (this._effectiveListen()) {
			this.log(
				'info',
				`[ArtNet] Screen ${screenIdx + 1} listen on (${source}) master=${master} slot.artnetListenEnabled=${JSON.stringify(raw)} effective=true`,
			)
		} else {
			this.log(
				'info',
				`[ArtNet] Screen ${screenIdx + 1} listen off (${source}) master=${master} ` +
					`targetConfigured=${this._targetConfigured} slotPresent=${!!slot} ` +
					`slot.artnetListenEnabled=${JSON.stringify(raw)} slotListen=${slotListen}`,
			)
		}
	}

	/** Re-read universe/start channel from config, autosave, or live scene (e.g. after UI save). */
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
			this._channelMap = Array(ArtnetReceiver.PATCH_CHANNEL_COUNT).fill(true)
			this.log(
				'warn',
				`[ArtNet] globalBorders[${screenIdx}] is null — Art-Net input paused until a global border exists on main screen ${screenIdx + 1}`,
			)
			return false
		}
		this._reloadSlotConfig(slot)
		const changed = this._applyPatch(resolved, source)
		if (this._effectiveListen()) {
			this.lastData = null
			this._lastAppliedKey = null
		}
		this._logListenState(screenIdx, slot, source)
		this._projectScenesCache = null
		this._ensureSocketListening()
		return changed
	}

	_bindUdpSocket() {
		const dmx = this.appCtx.config?.dmx || {}
		try {
			const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
			socket.on('error', (e) => {
				this.log('error', `[ArtNet] UDP socket error: ${e.message}`)
			})
			socket.on('close', () => {
				if (this._socket === socket) {
					this._socket = null
					this.log('warn', '[ArtNet] UDP socket closed — will re-bind on next reconfigure if listen is enabled')
				}
			})
			socket.on('message', (msg, rinfo) => this._onUdpMessage(msg, rinfo))
			socket.on('listening', () => {
				const addr = socket.address()
				this.log(
					'info',
					`[ArtNet] UDP listening on ${addr.address}:${addr.port} ` +
						`screen=${this._targetScreenIndex + 1} globalBorders[${this._targetScreenIndex}] ` +
						`universe=${this._inputUniverse} startCh=${this._startChannel} (key=0x${this._portKey.toString(16)}) ` +
						`→ Caspar PGM ch${this._resolveProgramChannel()}`,
				)
			})
			socket.bind(this._inputPort, '0.0.0.0')
			this._socket = socket
		} catch (e) {
			this.log('error', `[ArtNet] Failed to start UDP receiver: ${e.message}`)
		}
	}

	/** Start UDP when global border slot exists (init may have run before project was saved). */
	_ensureSocketListening() {
		if (this._socket) return
		if (!this._targetConfigured) return
		if (!this._isMasterDmxEnabled()) return
		this._bindUdpSocket()
	}

	init(options = {}) {
		if (this._socket) return

		const dmx = this.appCtx.config?.dmx || {}
		this._inputPort = options.port ?? dmx.artnetInputPort ?? 6454
		this._logIntervalMs = this._resolveLogIntervalMs(dmx, options)
		this._wsBroadcastIntervalMs = this._resolveWsBroadcastIntervalMs(dmx, options)
		this._statsLogIntervalMs = this._resolveStatsLogIntervalMs(dmx, options)

		const resolved = this._resolveArtnetPatch()
		if (options.universe != null) resolved.universe = options.universe
		if (options.subnet != null) resolved.subnet = options.subnet
		if (options.net != null) resolved.net = options.net
		if (options.startChannel != null) resolved.startChannel = options.startChannel
		if (options.screenIndex != null) resolved.screenIndex = options.screenIndex

		const screenIdx = resolved.screenIndex ?? 0
		const slot = this._globalBorderSlot(screenIdx)
		this._targetConfigured = !!slot
		if (!slot) {
			this.log(
				'warn',
				`[ArtNet] globalBorders[${screenIdx}] is null (main screen ${screenIdx + 1}) — ` +
					'no Art-Net target. Create a global border on that screen in the UI, or set dmx.artnetInputScreenIndex.',
			)
			return
		}

		this._reloadSlotConfig(slot)
		this._applyPatch(resolved, 'init')
		this._bindUdpSocket()
	}

	_onUdpMessage(msg, _rinfo) {
		try {
			this._bumpStat('udp')
			this._maybeLogStats()

			if (!this._targetConfigured) {
				this._bumpStat('noTarget')
				this._throttledDropLog(
					'no-target',
					'[ArtNet] Dropping ArtDMX: no globalBorders slot (targetConfigured=false). Save a global border on the configured screen.',
				)
				return
			}

			const data = this._parseArtDmx(msg)
			if (!data) {
				this._bumpStat('parseFail')
				return
			}
			this._bumpStat('artdmx')

			const pktKey = this._portKeyFromPacket(msg)
			if (pktKey !== this._portKey) {
				this._bumpStat('wrongUniverse')
				const subuni = pktKey != null ? pktKey >> 8 : -1
				const net = pktKey != null ? pktKey & 0xff : -1
				this._throttledDropLog(
					'wrong-universe',
					`[ArtNet] Dropping ArtDMX on net=${net} universe=${subuni & 0x0f} subnet=${(subuni >> 4) & 0x0f} ` +
						`(want key=0x${this._portKey.toString(16)} net=${this._inputNet} universe=${this._inputUniverse})`,
				)
				return
			}
			this._bumpStat('matched')

			this._maybeLogPatchChannels(data)
			if (!this._effectiveListen()) {
				this._bumpStat('listenOff')
				return
			}
			this.handleData(data)
		} catch (e) {
			this._bumpStat('errors')
			this.log('error', `[ArtNet] Message handler error: ${e?.message || e}`)
			if (e?.stack) this.log('error', e.stack)
		}
	}

	_dmxEnabledSticky(val, prev) {
		const h = ArtnetReceiver.DMX_HYST
		if (val >= 128 + h) return true
		if (val < 128 - h) return false
		return !!prev
	}

	_dmxTypeSticky(val, prevType) {
		const h = ArtnetReceiver.DMX_HYST
		const v = val | 0
		const t = prevType || 'border'
		if (t === 'border') {
			if (v >= 192 + h) return 'shadow'
			if (v >= 128 + h) return 'edge_strip'
			if (v >= 64 + h) return 'glow'
			return 'border'
		}
		if (t === 'glow') {
			if (v < 64 - h) return 'border'
			if (v >= 192 + h) return 'shadow'
			if (v >= 128 + h) return 'edge_strip'
			return 'glow'
		}
		if (t === 'edge_strip') {
			if (v < 64 - h) return 'border'
			if (v < 128 - h) return 'glow'
			if (v >= 192 + h) return 'shadow'
			return 'edge_strip'
		}
		if (v < 192 - h) {
			if (v < 128 - h) return v < 64 - h ? 'border' : 'glow'
			return 'edge_strip'
		}
		return 'shadow'
	}

	_readByte(data, idx, fallback = 0) {
		return idx >= 0 && idx < data.length ? data[idx] : fallback
	}

	_computeBorderFromDmx(data, start) {
		const prev = { ...this._runtimeParams }
		const map = this._channelMap
		const getHex = (r, g, b) => `#${this._toHex(r)}${this._toHex(g)}${this._toHex(b)}`
		const dmxSegmentsToN = (byte) => Math.max(1, Math.min(32, Math.round((byte / 255) * 31) + 1))

		let enabled = prev.enabled
		if (map[0]) {
			enabled = this._dmxEnabledSticky(this._readByte(data, start), prev.enabled)
		}

		let type = prev.type || 'border'
		if (map[1]) {
			type = this._dmxTypeSticky(this._readByte(data, start + 1), prev.type)
		}

		const params = {
			...prev,
			side: 'inside',
			enabled,
			type,
		}

		if (map[2]) {
			params.opacity = this._readByte(data, start + 2) / 255
		}

		if (map[3] || map[4] || map[5]) {
			const c = this._parseHexColor(prev.color)
			const r = map[3] ? this._readByte(data, start + 3) : c.r
			const g = map[4] ? this._readByte(data, start + 4) : c.g
			const b = map[5] ? this._readByte(data, start + 5) : c.b
			params.color = getHex(r, g, b)
		}

		if (map[6]) {
			const wVal = this._readByte(data, start + 6)
			const w = (wVal / 255) * 50
			params.width = w
			params.intensity = w
		}

		if (map[7]) {
			const spd = 0.1 + (this._readByte(data, start + 7) / 255) * 9.9
			params.speed = spd
			params.pulseSpeed = spd
		}

		if (map[8]) {
			const spreadVal = this._readByte(data, start + 8)
			params.spread = (spreadVal / 255) * 20
			params.blur = (spreadVal / 255) * 50
		}

		if (map[9] || map[10] || map[11]) {
			const gc = this._parseHexColor(prev.glowColor)
			const r = map[9] ? this._readByte(data, start + 9) : gc.r
			const g = map[10] ? this._readByte(data, start + 10) : gc.g
			const b = map[11] ? this._readByte(data, start + 11) : gc.b
			params.glowColor = getHex(r, g, b)
		}

		if (map[12]) {
			params.radius = (this._readByte(data, start + 12) / 255) * 50
		}

		if (map[13]) {
			params.count = Math.floor((this._readByte(data, start + 13) / 255) * 12) + 1
		}

		if (map[14]) {
			params.length = 5 + (this._readByte(data, start + 14) / 255) * 95
		}

		if (map[15] || map[16] || map[17]) {
			let segmentMode = prev.segmentMode === 'uniform' || prev.segmentationMode === 'uniform' ? 'uniform' : 'full'
			if (map[17]) {
				const segModeVal = this._readByte(data, start + 17)
				segmentMode = segModeVal >= 128 ? 'uniform' : 'full'
				params.segmentMode = segmentMode
				params.segmentationMode = segmentMode
			}
			if (map[15]) {
				params.segmentsPerEdge =
					segmentMode === 'full' ? 1 : dmxSegmentsToN(this._readByte(data, start + 15))
				params.segmentation =
					segmentMode === 'full' ? 0 : Math.max(0, Math.min(1, this._readByte(data, start + 15) / 255))
			}
			if (map[16]) {
				params.segmentEase = Math.max(0, Math.min(1, this._readByte(data, start + 16) / 255))
			}
		}

		if (enabled && params.opacity === 0) params.opacity = 1

		const payloadParams = { ...params }
		if (!enabled) payloadParams.opacity = 0

		return { params, payloadParams, type }
	}

	_overlayApplyKey(type, payloadParams) {
		return JSON.stringify({
			type: type || 'border',
			enabled: !!payloadParams.enabled,
			opacity: Math.round((payloadParams.opacity ?? 0) * 1000) / 1000,
			color: payloadParams.color,
			width: Math.round((payloadParams.width ?? 0) * 10) / 10,
			intensity: Math.round((payloadParams.intensity ?? 0) * 10) / 10,
			glowColor: payloadParams.glowColor,
			radius: Math.round((payloadParams.radius ?? 0) * 10) / 10,
			speed: Math.round((payloadParams.speed ?? 0) * 100) / 100,
			spread: Math.round((payloadParams.spread ?? 0) * 10) / 10,
			segmentMode: payloadParams.segmentMode,
			segmentsPerEdge: payloadParams.segmentsPerEdge,
		})
	}

	_loadGlobalBordersArray() {
		const scenes = this._loadProjectScenes()
		if (!scenes || !Array.isArray(scenes.globalBorders)) return [null, null, null, null]
		return [...scenes.globalBorders]
	}

	/** Runtime-only WS mirror (no artnetPatch / listen / channelMap — client keeps local config). */
	_broadcastToClient(channel, params, type) {
		const ctx = this.appCtx
		if (!ctx?._wsBroadcast) return

		const slot = this._globalBorderSlot(this._targetScreenIndex)
		const slotSlices = Array.isArray(slot?.slices) ? slot.slices : []
		const { enabled, type: _t, ...paramRest } = params
		const runtimeBorder = {
			enabled: enabled !== false,
			type: type || params.type || 'border',
			params: { ...paramRest },
			fadeDuration: slot?.fadeDuration ?? 25,
			slices: slotSlices,
		}

		const idx = this._targetScreenIndex
		ctx._wsBroadcast('global_border_sync', { screenIndex: idx, border: runtimeBorder })

		try {
			const liveSceneState = require('../state/live-scene-state')
			const live = liveSceneState.getChannel(channel)
			if (live?.scene) {
				if (!live.scene.globalBorder) {
					live.scene.globalBorder = {
						...runtimeBorder,
						borderPresets: [],
					}
				} else {
					const gb = live.scene.globalBorder
					gb.enabled = runtimeBorder.enabled
					gb.type = runtimeBorder.type
					gb.params = { ...runtimeBorder.params }
					if (Array.isArray(runtimeBorder.slices)) gb.slices = runtimeBorder.slices
				}
				liveSceneState.setChannel(channel, live)
			}
		} catch (_) {}
	}

	handleData(data) {
		if (!data || data.length === 0) return
		if (!this._effectiveListen()) return

		const start = this._startChannel - 1
		const window = this._copyPatchWindow(data, start)
		const prev = this.lastData
		if (!this._patchMappedBytesChanged(prev, window)) {
			this._bumpStat('unchanged')
			// Advance baseline when only disabled map offsets changed (e.g. type ch with map[1]=false).
			this.lastData = window
			return
		}

		this.lastData = window
		this._bumpStat('handled')

		const { params, payloadParams, type } = this._computeBorderFromDmx(data, start)
		const applyKey = this._overlayApplyKey(type, payloadParams)

		const channel = this._resolveProgramChannel()
		const prevType = this._addedTypeByChannel.get(channel)
		const typeChanged = prevType != null && String(type) !== String(prevType)
		const needsAdd = prevType == null || typeChanged

		this._runtimeParams = params
		if (applyKey !== this._lastAppliedKey) {
			this._lastAppliedKey = applyKey
		}

		if (needsAdd) {
			this.log('info', `[ArtNet] Border load ch${channel} type=${type}`)
		}

		this._scheduleWsBroadcast(channel, params, type)
		const slot = this._globalBorderSlot(this._targetScreenIndex)
		const slices = Array.isArray(slot?.slices) ? slot.slices : []
		// Live JSON file on every mapped-channel DMX change (CG ADD only when type changes).
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
		this._broadcastToClient(pending.channel, pending.params, pending.type)
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
		if (!pending) return
		const overlay = {
			type: pending.type || pending.params.type || 'border',
			params: pending.params,
			slices: pending.slices,
		}
		const { writeGlobalBorderLiveFile } = require('../engine/global-border-live')
		writeGlobalBorderLiveFile(pending.channel, overlay, this.log)
		if (pending.forceAdd) {
			this._sendCasparBorderAdd(pending.channel, overlay)
		}
	}

	/** CG ADD+PLAY only (type change / first load). Params come from template/live JSON file. */
	_sendCasparBorderAdd(channel, overlay) {
		const amcp = this.appCtx.amcp
		if (!amcp?.isConnected) {
			this.log('warn', '[ArtNet] Cannot load border, AMCP not connected')
			return
		}

		const layer = GLOBAL_BORDER_LAYER
		const { buildGlobalBorderAmcpLines } = require('../engine/global-border')
		const { markCasparBorderType } = require('../engine/global-border-live')
		const lines = buildGlobalBorderAmcpLines(channel, layer, overlay, this.appCtx, {
			initialOpacity: 1,
			updateDuration: 1,
		})
		markCasparBorderType(channel, overlay.type)

		for (const line of lines) {
			amcp.raw(line).catch((e) => {
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
		this.log('info', '[ArtNet] Receiver stopped')
	}
}

module.exports = { ArtnetReceiver }
