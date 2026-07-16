'use strict'

const EventEmitter = require('events')
const { isSaneTimingValue, computeRemainingAndProgress } = require('./osc-state-timing')

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
 * `/channel/N/mixer/audio/volume` bundles linear or packed **amplitude** samples (not dBFS).
 * Map one sample to dBFS for `levels[].dBFS`. Amplitude **0** is true silence → ~−120 dBFS.
 * Do **not** use this for `/M/dBFS` floats: there **0** means **0 dBFS** (digital full scale).
 * @param {number} raw
 * @returns {number}
 */
function intMeterSampleToDbfs(raw) {
	const n = Number(raw)
	if (!Number.isFinite(n)) return -120
	// Linear amplitude 0 — no signal (not the same semantic as 0 dBFS on the float meter path).
	if (n === 0) return -120
	if (n >= -120 && n < 0) return n
	// Fixed-point dBFS (negative millibels / millidecibels)
	if (n < 0 && n >= -120000) return n / 1000
	if (n < 0 && n >= -12000) return n / 100
	if (n < 0) return Math.max(-120, n / 1000)
	// Linear amplitude 0..32767 (common packed meter) → dBFS
	if (n > 0 && n <= 65535) {
		const lin = Math.min(1, Math.max(1e-10, n / 32767))
		return 20 * Math.log10(lin)
	}
	// Large positive int32 (e.g. unsigned linear packed) — avoid falling through to -120
	if (n > 65535 && n <= 0x7fffffff) {
		const lin = Math.min(1, Math.max(1e-10, n / 2147483647))
		return 20 * Math.log10(lin)
	}
	return -120
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
			c.audio._nbChannelsFromOsc = true
			while (c.audio.levels.length < n) {
				c.audio.levels.push({ dBFS: -120, peak: -120, peakAge: 0 })
			}
			if (c.audio.levels.length > n) c.audio.levels.length = n
			return
		}
		// Forks may emit bundled int meters (e.g. 16× int32) instead of per-index …/M/dBFS messages.
		if (sub === 'volume' && vals.length > 0) {
			const a = c.audio
			// Do not inflate channel count from padded volume bundles — trust nb_channels when set.
			const cap = a._nbChannelsFromOsc && a.nbChannels > 0 ? a.nbChannels : vals.length
			const n = Math.min(vals.length, cap)
			if (!a._nbChannelsFromOsc) a.nbChannels = n
			const now = Date.now()
			a._lastUpdateAt = now
			for (let i = 0; i < n; i++) {
				const db = intMeterSampleToDbfs(vals[i])
				while (a.levels.length <= i) {
					a.levels.push({ dBFS: -120, peak: -120, peakAge: 0 })
				}
				const slot = a.levels[i]
				slot.dBFS = db
				if (!Number.isFinite(slot.peak) || db > slot.peak || now - slot.peakAge > this._config.peakHoldMs) {
					slot.peak = db
					slot.peakAge = now
				}
			}
			return
		}
		const dm = sub.match(/^(\d+)\/dBFS$/)
		if (dm) {
			const rawIdx = parseInt(dm[1], 10)
			const a = c.audio
			// Caspar builds differ: some use /mixer/audio/0/dBFS (0-based), some /mixer/audio/1/dBFS (1-based) for the first meter.
			if (a._meterIndexBase === undefined) {
				a._meterIndexBase = rawIdx === 0 ? 0 : 1
			}
			const idx = a._meterIndexBase === 1 ? rawIdx - 1 : rawIdx
			if (idx < 0 || !Number.isFinite(idx)) return
			const rawDb = Number(vals[0])
			while (a.levels.length <= idx) {
				a.levels.push({ dBFS: -120, peak: -120, peakAge: 0 })
			}
			const slot = a.levels[idx]
			const now = Date.now()
			const db = Number.isFinite(rawDb) ? rawDb : slot.dBFS
			slot.dBFS = db
			a._lastUpdateAt = now
			if (!Number.isFinite(slot.peak) || db > slot.peak || now - slot.peakAge > this._config.peakHoldMs) {
				slot.peak = db
				slot.peakAge = now
			}
		}
	}

	/** Reset mixer levels when Caspar stops sending fresh OSC (avoids frozen VU after CLEAR / lost consumer). */
	_decayStaleAudio(now = Date.now()) {
		const staleMs = this._config.staleTimeoutMs
		if (!Number.isFinite(staleMs) || staleMs <= 0) return false
		let any = false
		for (const chKey of Object.keys(this._channels)) {
			const ch = parseInt(chKey, 10)
			const a = this._channels[chKey]?.audio
			if (!a?.levels?.length) continue
			const lastAt = a._lastUpdateAt || 0
			if (lastAt && now - lastAt <= staleMs) continue
			let chStale = false
			for (const slot of a.levels) {
				if (slot.dBFS !== -120) {
					slot.dBFS = -120
					chStale = true
				}
				if (now - (slot.peakAge || 0) > this._config.peakHoldMs && slot.peak !== -120) {
					slot.peak = -120
					chStale = true
				}
			}
			if (chStale && Number.isFinite(ch)) {
				this._dirtyChannels.add(ch)
				any = true
			}
		}
		return any
	}

	/**
	 * Drop stage layers Caspar no longer emits OSC for (removed via CLEAR / stage teardown — there is
	 * no final "empty" message). Without pruning, the multiview overlay's "highest layer with a file"
	 * pick keeps showing the dead layer's frozen clip + elapsed forever (WO-151 B151.2).
	 * @param {number} [now]
	 * @returns {boolean} true when at least one layer was pruned
	 */
	_pruneStaleLayers(now = Date.now()) {
		const staleMs = this._config.layerStaleTimeoutMs
		if (!Number.isFinite(staleMs) || staleMs <= 0) return false
		let any = false
		for (const chKey of Object.keys(this._channels)) {
			const layers = this._channels[chKey]?.layers
			if (!layers) continue
			for (const layerId of Object.keys(layers)) {
				const lastAt = layers[layerId]?._lastOscAt || 0
				if (lastAt && now - lastAt <= staleMs) continue
				delete layers[layerId]
				const ch = parseInt(chKey, 10)
				if (Number.isFinite(ch)) this._dirtyChannels.add(ch)
				any = true
			}
		}
		return any
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
		} else if (tail === 'loop') {
			// WO-239 T239.2: Caspar 2.6-dev av_producer.cpp:766/991 `state_["loop"] = loop;` is a
			// TOP-LEVEL key on the producer's own state map, not nested under "file/" — confirmed both
			// by core/monitor/monitor.h's state_proxy merge semantics (a plain key with no "/" stays
			// flat) and by a live `INFO 1` capture showing `<loop>true</loop>` as a *sibling* of
			// `<file>` inside `<foreground>`, not a child of it (see
			// tools/smoke/smoke-wo235-osc-compat.test.js NEW_INFO_XML). So the wire address is
			// `.../foreground/loop`, not `.../foreground/file/loop`. This was previously unhandled
			// (silently dropped) on the new binary — the old-format `.../file/loop` leaf (handled in
			// _routeLayerFile below) is still honored for the old lineage, so both work without a
			// config switch. Not currently consumed by osc-variables.js, but fixed here for
			// correctness/robustness of the layer.file.loop field other consumers may read.
			const v = vals[0]
			const f = fileTarget === 'background' ? layer.backgroundFile || (layer.backgroundFile = {}) : layer.file || (layer.file = {})
			f.loop = v === true || v === 1 || v === 'true'
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
			// WO-235 T235.2/T235.3: Caspar 2.6-dev (r253c16c) core/producer/layer.cpp:132-141 never
			// emits an explicit `.../type` leaf — it only sets `state_["foreground"]["producer"]` /
			// `state_["background"]["producer"]` to the producer's name (e.g. "ffmpeg", "empty",
			// "route", "html", "transition", "color"). The old lineage's explicit `.../type` message
			// (handled above) is still honored when present, so both binaries work without a config
			// switch. Without this, `layer.type`/`backgroundType` stay `null` forever → every
			// consumer that gates on `String(layer.type||'') === 'empty'` (playback-tracker-osc
			// buildMatrixFromOsc/getOccupiedLayerNumbersFromOsc, osc-variables per-layer timer
			// variables, scene-play-seek, compose-preview-activity) treats every layer as empty:
			// /api/state playback.matrix stays {} and per-layer timers in the main UI + multiview
			// never populate/clear correctly ("freaking out").
			const producerName = vals[0] != null ? String(vals[0]) : null
			if (producerName != null) {
				if (fileTarget === 'background') {
					layer.backgroundType = producerName
					if (producerName === 'empty') layer.backgroundFile = {}
				} else {
					layer.type = producerName
					if (producerName === 'empty') {
						layer.file = {}
						layer.backgroundFile = {}
						layer.template = { path: null, width: 0, height: 0, fps: 0 }
					}
				}
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
			// `.../file/time` carries [elapsed_sec, duration_sec] on both lineages: old and new
			// (2.6-dev av_producer.cpp:990 `state_["file/time"] = {time()/format_desc_.fps,
			// file_duration().value_or(0)/format_desc_.fps}`) compute seconds by dividing CHANNEL
			// frame counters by the CHANNEL fps, so no unit/scale change vs. the old lineage.
			// WO-235: guard against rare extreme-magnitude float garbage observed live (e.g.
			// elapsed ~1e-32 / duration ~1e+23 for a producer mid-teardown/init) — a single
			// insane sample must not corrupt or flicker the UI timer; keep the previous value.
			const elapsedRaw = Number(vals[0])
			const durationRaw = vals.length >= 2 ? Number(vals[1]) : NaN
			const elapsed = isSaneTimingValue(elapsedRaw) ? elapsedRaw : Number.isFinite(f.elapsed) ? f.elapsed : null
			if (isSaneTimingValue(durationRaw)) f.duration = durationRaw
			f.elapsed = elapsed
			// WO-250 T250.3: some builds report `file/time` duration as 0/absent (e.g. mid-init)
			// even though `file/frame` (frameElapsed/frameTotal, routed below) and `file/fps` are
			// already known on this layer — derive duration from them so the UI/multiview digits+bar
			// don't go dark just because `file/time`'s own duration field is empty. Pattern mirrors
			// src/state/playback-tracker-osc.js:131-138 (elapsedSec/progress -> total). Only fires
			// when the REAL duration is 0/absent (rollback-safe: a real duration always wins,
			// untouched); reuses the WO-235 `isSaneTimingValue` clamp so a garbage frameTotal/fps pair can't
			// corrupt the UI either. Guards fps 0 (division by zero) explicitly.
			if (!(Number.isFinite(f.duration) && f.duration > 0)) {
				const frameTotal = Number(f.frameTotal)
				const fps = Number(f.fps)
				if (Number.isFinite(frameTotal) && frameTotal > 0 && Number.isFinite(fps) && fps > 0) {
					const derivedDuration = frameTotal / fps
					if (isSaneTimingValue(derivedDuration)) f.duration = derivedDuration
				}
			}
			const duration = Number.isFinite(f.duration) ? f.duration : NaN
			// Looping producers report a monotonic elapsed accumulating across iterations on the
			// 2.6-dev binary — remaining/progress (and the elapsed the UI timers read) must use the
			// in-iteration position (elapsed % duration), or timers jump between the two values.
			const { remaining, progress, iterationElapsed } = computeRemainingAndProgress(elapsed, duration, { loop: f.loop === true })
			if (f.loop === true && Number.isFinite(iterationElapsed)) f.elapsed = iterationElapsed
			f.remaining = remaining
			f.progress = progress
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
		const now = Date.now()
		this._decayStaleAudio(now)
		this._pruneStaleLayers(now)
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
		if (f.loop === true && Number.isFinite(iterationElapsed)) f.elapsed = iterationElapsed
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

module.exports = { OscState }
