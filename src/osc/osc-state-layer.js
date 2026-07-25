'use strict'

const { isSaneTimingValue, computeRemainingAndProgress } = require('./osc-state-timing')

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

const layerMethods = {
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
	},

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
	},

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
	},

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
			// Only a POSITIVE duration is real. The 2.6-dev binary sends duration=0 for looping /
			// live producers whose file_duration() is absent — and 0 passes isSaneTimingValue, so
			// the old `f.duration = durationRaw` overwrote a real duration (e.g. the WO-252 INFO
			// supplement's 15.04s) back to 0 on EVERY 50ms tick. That left the loop-modulo below with
			// nothing to modulo → the raw monotonic elapsed (462289s ≈ "7 thousand seconds") showed.
			// Leave f.duration untouched when the binary reports 0 so the INFO-injected value survives.
			if (durationRaw > 0 && isSaneTimingValue(durationRaw)) f.duration = durationRaw
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
			if (Number.isFinite(iterationElapsed)) f.elapsed = iterationElapsed /* corrected: modulo/clamp per computeRemainingAndProgress (magnitude, not loop flag) */
			// No duration to modulo against AND a monotonic elapsed far beyond any real clip
			// (live/route producers whose elapsed is a since-start clock, never reset per play) —
			// showing 462289s ("128 hours") is worse than nothing. Null it so the UI shows a blank
			// timer rather than a garbage running total. 12h cap: no playout clip is that long.
			const MONOTONIC_ELAPSED_CAP_SEC = 12 * 3600
			if (!(Number.isFinite(duration) && duration > 0) && Number.isFinite(f.elapsed) && f.elapsed > MONOTONIC_ELAPSED_CAP_SEC) {
				f.elapsed = null
			}
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
	},

	_routeLayerHost(layer, sub, vals) {
		const t = layer.template || (layer.template = { path: null, width: 0, height: 0, fps: 0 })
		if (sub === 'path') t.path = vals[0] != null ? String(vals[0]) : null
		else if (sub === 'width') t.width = parseInt(String(vals[0]), 10) || 0
		else if (sub === 'height') t.height = parseInt(String(vals[0]), 10) || 0
		else if (sub === 'fps') t.fps = Number(vals[0]) || 0
	},
}

module.exports = { layerMethods }
