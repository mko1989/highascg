'use strict'

const EventEmitter = require('events')
const { isSaneTimingValue, computeRemainingAndProgress } = require('./osc-state-timing')
const { layerMethods } = require('./osc-state-layer')
const { audioMethods } = require('./osc-state-audio')

/**
 * WO-235 T235.1: permanent, default-off raw OSC trace. Enable with `HIGHASCG_OSC_TRACE=1`
 * to log address + args for the first N packets after process start — used to diff old vs.
 * new CasparCG binary OSC output live without a code change. Cannot be toggled without a
 * process restart (env var is read once at module load), which is expected: this is for
 * future incident capture, not a live switch.
 */
const OSC_TRACE_ENABLED = process.env.HIGHASCG_OSC_TRACE === '1'
const OSC_TRACE_MAX_PACKETS = 200
let oscTraceCount = 0

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
			/** @type {{ nbChannels: number, levels: Array<{ dBFS: number, peak: number, peakAge: number }>, _meterIndexBase?: 0 | 1 }} */
			audio: { nbChannels: 0, levels: [] },
			outputs: {},
			layers: {},
		}
	}

	_ensureChannel(ch) {
		if (!this._channels[ch]) this._channels[ch] = this._emptyChannel()
		return this._channels[ch]
	}

	/**
	 * Normalize osc.js packet args to a numeric/string array.
	 * osc.js defaults to `unpackSingleArgs: true`, so a one-argument message becomes a scalar (not `[x]`).
	 * Our code assumes `vals[0]` etc.; without this, single-arg dBFS/volume messages yield `vals = []` and meters stay at -120.
	 * @param {unknown} rawArgs
	 * @returns {unknown[]}
	 */
	_argValues(rawArgs) {
		if (rawArgs == null) return []
		if (Array.isArray(rawArgs)) {
			return rawArgs.map((a) => {
				if (a && typeof a === 'object' && 'value' in a) return a.value
				return a
			})
		}
		// Single-arg messages unpacked to scalar (see osc.js readMessageContents + unpackSingleArgs)
		if (typeof rawArgs === 'number' || typeof rawArgs === 'string' || typeof rawArgs === 'boolean') {
			return [rawArgs]
		}
		return []
	}

	/**
	 * @param {{ address: string, args?: unknown[] }} packet
	 */
	handleOscMessage(packet) {
		let address = packet.address
		if (typeof address === 'string' && address.startsWith('/ch/')) {
			address = '/channel/' + address.slice('/ch/'.length)
		}
		const vals = this._argValues(packet.args || [])
		if (OSC_TRACE_ENABLED && oscTraceCount < OSC_TRACE_MAX_PACKETS) {
			oscTraceCount++
			try {
				this._log('info', `[OSC_TRACE ${oscTraceCount}/${OSC_TRACE_MAX_PACKETS}] ${address} ${JSON.stringify(vals)}`)
			} catch (_) {
				this._log('info', `[OSC_TRACE ${oscTraceCount}/${OSC_TRACE_MAX_PACKETS}] ${address} <unserializable args>`)
			}
		}
		const m = address.match(/^\/channel\/(\d+)\/(.+)$/)
		if (!m) return
		const ch = parseInt(m[1], 10)
		const rest = m[2]
		/* WO-401 F3-revised: dirty-marking is VALUE-aware — a channel is dirty only when a routed
		 * message changed consumed state. With Caspar full-copying every channel each tick, the old
		 * per-message `add(ch)` kept all channels permanently dirty, which made WS delta mode ship
		 * full-size payloads (the F3 void finding). Housekeeping (_decayStaleAudio /
		 * _pruneStaleLayers) marks its own dirty channels. */
		if (this._routePath(ch, rest, vals)) this._dirtyChannels.add(ch)
		this._scheduleEmit()
	}

	/** @returns {boolean} true when consumed state changed (drives delta dirty-marking) */
	_routePath(ch, rest, vals) {
		if (rest === 'format') {
			const c = this._ensureChannel(ch)
			const next = vals[0] != null ? String(vals[0]) : null
			const changed = c.format !== next
			c.format = next
			return changed
		}
		if (rest === 'profiler/time' && vals.length >= 2) {
			const c = this._ensureChannel(ch)
			const actual = Number(vals[0])
			const expected = Number(vals[1])
			const healthy = !(Number.isFinite(actual) && Number.isFinite(expected) && expected > 0 && actual <= expected * 1.05)
			/* actual/expected are per-tick measurement noise with no consumer (only `healthy` is
			 * read) — store them, but only a healthy FLIP dirties the channel. */
			const changed = c.profiler?.healthy !== healthy
			c.profiler = { actual, expected, healthy }
			return changed
		}
		if (rest.startsWith('output/')) {
			const c = this._ensureChannel(ch)
			const om = rest.match(/^output\/port\/(\d+)\/(type|frame)$/)
			if (!om) return false
			const portId = om[1]
			const field = om[2]
			if (!c.outputs[portId]) c.outputs[portId] = { type: null, frames: null, maxFrames: null }
			if (field === 'type') {
				const next = vals[0] != null ? String(vals[0]) : null
				const changed = c.outputs[portId].type !== next
				c.outputs[portId].type = next
				return changed
			}
			if (field === 'frame' && vals.length >= 2) {
				/* Consumer frame counters increment every frame on every channel — storing them is
				 * fine, but dirtying on them would defeat delta mode. No consumer reads them live. */
				c.outputs[portId].frames = Number(vals[0])
				c.outputs[portId].maxFrames = Number(vals[1])
			}
			return false
		}
		if (rest.startsWith('mixer/audio/')) {
			return this._routeMixerAudio(ch, rest.slice('mixer/audio/'.length), vals)
		}
		if (rest.startsWith('stage/layer/')) {
			const lm = rest.match(/^stage\/layer\/(\d+)\/(.+)$/)
			if (!lm) return false
			const layerId = parseInt(lm[1], 10)
			return this._routeLayer(ch, layerId, lm[2], vals)
		}
		return false
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
		this._decayStaleAudio(this._lastEmit)
		this._pruneStaleLayers(this._lastEmit)
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
			// _flushEmit already ran decay/prune this tick — skip getSnapshot()'s repeat (WO-401 F2).
			return this._snapshotNow(ts)
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
		const now = Date.now()
		this._decayStaleAudio(now)
		this._pruneStaleLayers(now)
		return this._snapshotNow(now)
	}

	/** Snapshot without the decay/prune housekeeping — for callers that already ran it this tick. */
	_snapshotNow(now) {
		return {
			channels: JSON.parse(JSON.stringify(this._channels)),
			updatedAt: now,
		}
	}

	/**
	 * WO-252: Apply AMCP INFO supplemental timing data to fill gaps when the binary omits OSC `file/time`.
	 * Only writes duration/elapsed when OSC-sourced values are absent (OSC stays authoritative when present —
	 * rollback-safe). Reuses the WO-235 sanity clamp and recomputes remaining/progress.
	 * @param {number} ch
	 * @param {number} layerNum
	 * @param {{ durationSec?: number, timeSec?: number }} supplement
	 */
	applyInfoTimingSupplement(ch, layerNum, supplement) {
		if (!supplement || typeof supplement !== 'object') return
		const layer = this._ensureLayer(ch, layerNum)
		const f = layer.file || (layer.file = {})
		const now = Date.now()
		layer._lastOscAt = now

		// Only fill duration if OSC did not provide one.
		const durationRaw = supplement.durationSec
		if (!(Number.isFinite(f.duration) && f.duration > 0) && Number.isFinite(durationRaw) && durationRaw > 0) {
			if (isSaneTimingValue(durationRaw)) {
				f.duration = durationRaw
			}
		}

		// Only fill elapsed if it is entirely absent; OSC elapsed is fresher than a 2s INFO poll.
		if (!Number.isFinite(f.elapsed)) {
			const elapsedRaw = supplement.timeSec
			if (Number.isFinite(elapsedRaw) && elapsedRaw >= 0) {
				if (isSaneTimingValue(elapsedRaw)) {
					f.elapsed = elapsedRaw
				}
			}
		}

		// Recompute remaining/progress the same way the file/time branch does.
		const duration = Number.isFinite(f.duration) ? f.duration : NaN
		const elapsed = Number.isFinite(f.elapsed) ? f.elapsed : null
		const { remaining, progress, iterationElapsed } = computeRemainingAndProgress(elapsed, duration, { loop: f.loop === true })
		if (Number.isFinite(iterationElapsed)) f.elapsed = iterationElapsed /* corrected: modulo/clamp per computeRemainingAndProgress (magnitude, not loop flag) */
		f.remaining = remaining
		f.progress = progress

		this._dirtyChannels.add(ch)
		this._scheduleEmit()
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

Object.assign(OscState.prototype, layerMethods, audioMethods)

module.exports = { OscState }
