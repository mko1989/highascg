'use strict'

const EventEmitter = require('events')

/** Clear timing fields so the UI does not show the previous clip’s elapsed when Caspar omits updates (some codecs). */
function clearOscFileTiming(f) {
	if (!f || typeof f !== 'object') return
	delete f.elapsed
	delete f.remaining
	delete f.progress
	delete f.frameElapsed
	delete f.frameTotal
	delete f.duration
}

function producerSignatureFromVals(vals) {
	if (!vals || !vals.length) return ''
	return vals
		.map((a) => {
			if (a && typeof a === 'object' && 'value' in a) return String(a.value)
			return String(a)
		})
		.join('\x1e')
}

/**
 * @typedef {object} OscRuntimeConfig
 * @property {boolean} enabled
 * @property {number} listenPort
 * @property {string} listenAddress
 * @property {number} peakHoldMs
 * @property {number} emitIntervalMs
 * @property {number} staleTimeoutMs
 * @property {boolean} [wsDeltaBroadcast] — emit partial channel payloads for WS (merge client-side)
 */

/**
 * Aggregate CasparCG OSC into structured state + throttled `change` events.
 */
class OscState extends EventEmitter {
	/**
	 * @param {(level: string, msg: string) => void} log
	 * @param {OscRuntimeConfig} config
	 */
	constructor(log, config) {
		super()
		this._log = log
		this._config = config
		/** @type {Record<number, ReturnType<OscState['_emptyChannel']>>} */
		this._channels = {}
		this._lastEmit = 0
		this._emitTimer = null
		/** @type {Set<number>} */
		this._dirtyChannels = new Set()
	}

	_emptyChannel() {
		return {
			format: null,
			profiler: { actual: null, expected: null, healthy: true },
			audio: { nbChannels: 0, levels: [] },
			outputs: {},
			layers: {},
		}
	}

	_ensureChannel(ch) {
		if (!this._channels[ch]) this._channels[ch] = this._emptyChannel()
		return this._channels[ch]
	}

	_ensureLayer(ch, layerId) {
		const c = this._ensureChannel(ch)
		if (!c.layers[layerId]) {
			c.layers[layerId] = {
				type: null,
				backgroundType: null,
				time: null,
				frame: null,
				paused: null,
				profiler: { actual: null, expected: null },
				file: {},
				backgroundFile: {},
				template: { path: null, width: 0, height: 0, fps: 0 },
				_lastOscAt: Date.now(),
			}
		}
		return c.layers[layerId]
	}

	/**
	 * @param {unknown[]} rawArgs
	 */
	_argValues(rawArgs) {
		if (!rawArgs || !rawArgs.length) return []
		return rawArgs.map((a) => {
			if (a && typeof a === 'object' && 'value' in a) return a.value
			return a
		})
	}

	/**
	 * @param {{ address: string, args?: unknown[] }} packet
	 */
	handleOscMessage(packet) {
		const address = packet.address
		const vals = this._argValues(packet.args || [])
		const m = address.match(/^\/channel\/(\d+)\/(.+)$/)
		if (!m) return
		const ch = parseInt(m[1], 10)
		const rest = m[2]
		this._routePath(ch, rest, vals)
		this._dirtyChannels.add(ch)
		this._scheduleEmit()
	}

	_routePath(ch, rest, vals) {
		if (rest === 'format') {
			const c = this._ensureChannel(ch)
			c.format = vals[0] != null ? String(vals[0]) : null
			return
		}
		if (rest === 'profiler/time' && vals.length >= 2) {
			const c = this._ensureChannel(ch)
			const actual = Number(vals[0])
			const expected = Number(vals[1])
			c.profiler = {
				actual,
				expected,
				healthy: !(Number.isFinite(actual) && Number.isFinite(expected) && expected > 0 && actual <= expected * 1.05),
			}
			return
		}
		if (rest.startsWith('output/')) {
			const c = this._ensureChannel(ch)
			const om = rest.match(/^output\/port\/(\d+)\/(type|frame)$/)
			if (!om) return
			const portId = om[1]
			const field = om[2]
			if (!c.outputs[portId]) c.outputs[portId] = { type: null, frames: null, maxFrames: null }
			if (field === 'type') c.outputs[portId].type = vals[0] != null ? String(vals[0]) : null
			if (field === 'frame' && vals.length >= 2) {
				c.outputs[portId].frames = Number(vals[0])
				c.outputs[portId].maxFrames = Number(vals[1])
			}
			return
		}
		if (rest.startsWith('mixer/audio/')) {
			this._routeMixerAudio(ch, rest.slice('mixer/audio/'.length), vals)
			return
		}
		if (rest.startsWith('stage/layer/')) {
			const lm = rest.match(/^stage\/layer\/(\d+)\/(.+)$/)
			if (!lm) return
			const layerId = parseInt(lm[1], 10)
			this._routeLayer(ch, layerId, lm[2], vals)
		}
	}

	_routeMixerAudio(ch, sub, vals) {
		const c = this._ensureChannel(ch)
		if (sub === 'nb_channels') {
			const n = Math.max(0, parseInt(String(vals[0]), 10) || 0)
			c.audio.nbChannels = n
			while (c.audio.levels.length < n) {
				c.audio.levels.push({ dBFS: -120, peak: -120, peakAge: 0 })
			}
			if (c.audio.levels.length > n) c.audio.levels.length = n
			return
		}
		const dm = sub.match(/^(\d+)\/dBFS$/)
		if (dm) {
			const idx = parseInt(dm[1], 10)
			const db = Number(vals[0])
			while (c.audio.levels.length <= idx) {
				c.audio.levels.push({ dBFS: -120, peak: -120, peakAge: 0 })
			}
			const slot = c.audio.levels[idx]
			const now = Date.now()
			slot.dBFS = Number.isFinite(db) ? db : slot.dBFS
			if (!Number.isFinite(slot.peak) || db > slot.peak || now - slot.peakAge > this._config.peakHoldMs) {
				slot.peak = db
				slot.peakAge = now
			}
		}
	}

	/**
	 * @param {'foreground' | 'background'} [fileTarget] - where `file/*` OSC goes (Caspar 2.3+ nests under foreground/background)
	 */
	_routeLayer(ch, layerId, tail, vals, fileTarget = 'foreground') {
		const layer = this._ensureLayer(ch, layerId)
		layer._lastOscAt = Date.now()

		// Caspar sends e.g. …/stage/layer/10/foreground/file/time (not flat …/layer/10/file/time).
		if (tail.startsWith('foreground/')) {
			return this._routeLayer(ch, layerId, tail.slice('foreground/'.length), vals, 'foreground')
		}
		if (tail.startsWith('background/')) {
			return this._routeLayer(ch, layerId, tail.slice('background/'.length), vals, 'background')
		}

		if (tail === 'time') layer.time = vals[0] != null ? Number(vals[0]) : null
		else if (tail === 'frame') layer.frame = vals[0] != null ? parseInt(String(vals[0]), 10) : null
		else if (tail === 'type') {
			const t = vals[0] != null ? String(vals[0]) : 'empty'
			layer.type = t
			if (t === 'empty') {
				layer.file = {}
				layer.backgroundFile = {}
				layer.template = { path: null, width: 0, height: 0, fps: 0 }
			}
		} else if (tail === 'background/type') layer.backgroundType = vals[0] != null ? String(vals[0]) : null
		else if (tail === 'profiler/time' && vals.length >= 2) {
			layer.profiler = { actual: Number(vals[0]), expected: Number(vals[1]) }
		} else if (tail === 'paused') {
			const v = vals[0]
			layer.paused = v === true || v === 1 || v === 'true'
		} else if (tail === 'producer') {
			const sig = producerSignatureFromVals(vals)
			const sigKey = fileTarget === 'background' ? '_lastBgProducerSig' : '_lastProducerSig'
			if (sig !== layer[sigKey]) {
				layer[sigKey] = sig
				const f =
					fileTarget === 'background'
						? layer.backgroundFile || (layer.backgroundFile = {})
						: layer.file || (layer.file = {})
				clearOscFileTiming(f)
			}
		} else if (tail.startsWith('file/')) this._routeLayerFile(layer, tail.slice('file/'.length), vals, fileTarget)
		else if (tail.startsWith('host/')) this._routeLayerHost(layer, tail.slice('host/'.length), vals)
	}

	/**
	 * @param {'foreground' | 'background'} fileTarget
	 */
	_routeLayerFile(layer, sub, vals, fileTarget = 'foreground') {
		const key = fileTarget === 'background' ? 'backgroundFile' : 'file'
		const f = layer[key] || (layer[key] = {})
		if (sub === 'name') {
			const nv = vals[0] != null ? String(vals[0]) : null
			if (f._lastOscFileName !== undefined && f._lastOscFileName !== nv) clearOscFileTiming(f)
			f._lastOscFileName = nv
			f.name = nv
		} else if (sub === 'path') {
			const pv = vals[0] != null ? String(vals[0]) : null
			if (f._lastOscFilePath !== undefined && f._lastOscFilePath !== pv) clearOscFileTiming(f)
			f._lastOscFilePath = pv
			f.path = pv
		} else if (sub === 'time' && vals.length >= 1) {
			const elapsed = Number(vals[0])
			const duration = vals.length >= 2 ? Number(vals[1]) : NaN
			f.elapsed = elapsed
			if (Number.isFinite(duration)) f.duration = duration
			f.remaining =
				Number.isFinite(duration) && Number.isFinite(elapsed) ? Math.max(0, duration - elapsed) : null
			f.progress =
				Number.isFinite(duration) && duration > 0 && Number.isFinite(elapsed) ? Math.min(1, Math.max(0, elapsed / duration)) : null
		} else if (sub === 'frame' && vals.length >= 2) {
			f.frameElapsed = parseInt(String(vals[0]), 10)
			f.frameTotal = parseInt(String(vals[1]), 10)
		} else if (sub === 'fps' || sub.endsWith('/fps')) f.fps = Number(vals[0])
		else if (sub === 'loop') f.loop = vals[0] === 1 || vals[0] === true
		else if (sub.startsWith('video/')) {
			if (!f.video) f.video = {}
			const k = sub.slice('video/'.length)
			if (k === 'width') f.video.width = parseInt(String(vals[0]), 10)
			else if (k === 'height') f.video.height = parseInt(String(vals[0]), 10)
			else if (k === 'field' || k === 'codec') f.video[k] = vals[0] != null ? String(vals[0]) : null
		} else if (sub.startsWith('audio/')) {
			if (!f.audio) f.audio = {}
			const k = sub.slice('audio/'.length)
			if (k === 'sample-rate') f.audio.sampleRate = parseInt(String(vals[0]), 10)
			else if (k === 'channels') f.audio.channels = parseInt(String(vals[0]), 10)
			else if (k === 'format' || k === 'codec') f.audio[k] = vals[0] != null ? String(vals[0]) : null
		}
	}

	_routeLayerHost(layer, sub, vals) {
		const t = layer.template || (layer.template = { path: null, width: 0, height: 0, fps: 0 })
		if (sub === 'path') t.path = vals[0] != null ? String(vals[0]) : null
		else if (sub === 'width') t.width = parseInt(String(vals[0]), 10) || 0
		else if (sub === 'height') t.height = parseInt(String(vals[0]), 10) || 0
		else if (sub === 'fps') t.fps = Number(vals[0]) || 0
	}

	_scheduleEmit() {
		const interval = this._config.emitIntervalMs
		const now = Date.now()
		if (now - this._lastEmit >= interval) {
			this._flushEmit()
			return
		}
		if (this._emitTimer) return
		this._emitTimer = setTimeout(() => {
			this._emitTimer = null
			this._flushEmit()
		}, interval - (now - this._lastEmit))
		if (this._emitTimer.unref) this._emitTimer.unref()
	}

	_flushEmit() {
		this._lastEmit = Date.now()
		if (!this._config.wsDeltaBroadcast) {
			this._dirtyChannels.clear()
		}
		const payload = this._buildChangePayload()
		if (payload) this.emit('change', payload)
	}

	/**
	 * Payload for `change` listeners: full snapshot unless `wsDeltaBroadcast` (then partial `channels`).
	 * @returns {object | null}
	 */
	_buildChangePayload() {
		const ts = Date.now()
		if (!this._config.wsDeltaBroadcast) {
			return this.getSnapshot()
		}
		if (this._dirtyChannels.size === 0) {
			return null
		}
		const channels = {}
		for (const ch of this._dirtyChannels) {
			const key = String(ch)
			channels[key] = JSON.parse(JSON.stringify(this._channels[ch] || this._emptyChannel()))
		}
		this._dirtyChannels.clear()
		return { delta: true, updatedAt: ts, channels }
	}

	/** Full serializable snapshot for API / WebSocket (Phase 2). */
	getSnapshot() {
		return {
			channels: JSON.parse(JSON.stringify(this._channels)),
			updatedAt: Date.now(),
		}
	}

	clear() {
		this._channels = {}
		this._dirtyChannels.clear()
		this.emit('change', this.getSnapshot())
	}

	destroy() {
		if (this._emitTimer) {
			clearTimeout(this._emitTimer)
			this._emitTimer = null
		}
		this.removeAllListeners()
	}
}

module.exports = { OscState }
