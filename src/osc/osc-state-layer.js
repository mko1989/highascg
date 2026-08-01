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
	 * @returns {boolean} true when a consumed value changed (WO-401 F3-revised dirty-marking).
	 * `_lastOscAt` (keep-alive for pruning) and layer profiler floats (measurement noise, no
	 * consumer) deliberately never count as changes.
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

		if (tail === 'time') {
			const next = vals[0] != null ? Number(vals[0]) : null
			const changed = layer.time !== next
			layer.time = next
			return changed
		} else if (tail === 'frame') {
			const next = vals[0] != null ? parseInt(String(vals[0]), 10) : null
			const changed = layer.frame !== next
			layer.frame = next
			return changed
		} else if (tail === 'type') {
			const t = vals[0] != null ? String(vals[0]) : 'empty'
			let changed = layer.type !== t
			layer.type = t
			if (t === 'empty') {
				// Reset unconditionally (repeat empties must re-clear INFO-supplemented timing);
				// it only counts as a change when there was something to clear.
				if (Object.keys(layer.file || {}).length || Object.keys(layer.backgroundFile || {}).length || layer.template?.path) changed = true
				layer.file = {}
				layer.backgroundFile = {}
				layer.template = { path: null, width: 0, height: 0, fps: 0 }
			}
			return changed
		} else if (tail === 'background/type') {
			const next = vals[0] != null ? String(vals[0]) : null
			const changed = layer.backgroundType !== next
			layer.backgroundType = next
			return changed
		} else if (tail === 'profiler/time' && vals.length >= 2) {
			layer.profiler = { actual: Number(vals[0]), expected: Number(vals[1]) }
			return false
		} else if (tail === 'paused') {
			const v = vals[0]
			const next = v === true || v === 1 || v === 'true'
			const changed = layer.paused !== next
			layer.paused = next
			return changed
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
			const next = v === true || v === 1 || v === 'true'
			const changed = f.loop !== next
			f.loop = next
			return changed
		} else if (tail === 'producer') {
			const sig = producerSignatureFromVals(vals)
			const sigKey = fileTarget === 'background' ? '_lastBgProducerSig' : '_lastProducerSig'
			let changed = false
			if (sig !== layer[sigKey]) {
				layer[sigKey] = sig
				const f =
					fileTarget === 'background'
						? layer.backgroundFile || (layer.backgroundFile = {})
						: layer.file || (layer.file = {})
				clearOscFileTiming(f)
				changed = true
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
					if (layer.backgroundType !== producerName) changed = true
					layer.backgroundType = producerName
					if (producerName === 'empty') layer.backgroundFile = {}
				} else {
					if (layer.type !== producerName) changed = true
					layer.type = producerName
					if (producerName === 'empty') {
						layer.file = {}
						layer.backgroundFile = {}
						layer.template = { path: null, width: 0, height: 0, fps: 0 }
					}
				}
			}
			return changed
		} else if (tail.startsWith('file/')) return this._routeLayerFile(layer, tail.slice('file/'.length), vals, fileTarget)
		else if (tail.startsWith('host/')) return this._routeLayerHost(layer, tail.slice('host/'.length), vals)
		return false
	},

	/**
	 * @param {'foreground' | 'background'} fileTarget
	 * @returns {boolean} true when a consumed file field changed (WO-401 F3-revised)
	 */
	_routeLayerFile(layer, sub, vals, fileTarget = 'foreground') {
		const key = fileTarget === 'background' ? 'backgroundFile' : 'file'
		const f = layer[key] || (layer[key] = {})
		if (sub === 'name') {
			const nv = vals[0] != null ? String(vals[0]) : null
			const changed = f.name !== nv
			if (f._lastOscFileName !== undefined && f._lastOscFileName !== nv) clearOscFileTiming(f)
			f._lastOscFileName = nv
			f.name = nv
			return changed
		} else if (sub === 'path') {
			const pv = vals[0] != null ? String(vals[0]) : null
			const changed = f.path !== pv
			if (f._lastOscFilePath !== undefined && f._lastOscFilePath !== pv) clearOscFileTiming(f)
			f._lastOscFilePath = pv
			f.path = pv
			return changed
		} else if (sub === 'time' && vals.length >= 1) {
			const prevElapsed = f.elapsed
			const prevDuration = f.duration
			const prevRemaining = f.remaining
			const prevProgress = f.progress
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
			return (
				f.elapsed !== prevElapsed || f.duration !== prevDuration || f.remaining !== prevRemaining || f.progress !== prevProgress
			)
		} else if (sub === 'frame' && vals.length >= 2) {
			const fe = parseInt(String(vals[0]), 10)
			const ft = parseInt(String(vals[1]), 10)
			const changed = f.frameElapsed !== fe || f.frameTotal !== ft
			f.frameElapsed = fe
			f.frameTotal = ft
			return changed
		} else if (sub === 'fps' || sub.endsWith('/fps')) {
			const next = Number(vals[0])
			const changed = f.fps !== next
			f.fps = next
			return changed
		} else if (sub === 'loop') {
			const next = vals[0] === 1 || vals[0] === true
			const changed = f.loop !== next
			f.loop = next
			return changed
		} else if (sub.startsWith('video/')) {
			if (!f.video) f.video = {}
			const k = sub.slice('video/'.length)
			let next
			if (k === 'width' || k === 'height') next = parseInt(String(vals[0]), 10)
			else if (k === 'field' || k === 'codec') next = vals[0] != null ? String(vals[0]) : null
			else return false
			const prop = k === 'width' ? 'width' : k === 'height' ? 'height' : k
			const changed = f.video[prop] !== next
			f.video[prop] = next
			return changed
		} else if (sub.startsWith('audio/')) {
			if (!f.audio) f.audio = {}
			const k = sub.slice('audio/'.length)
			let prop
			let next
			if (k === 'sample-rate') { prop = 'sampleRate'; next = parseInt(String(vals[0]), 10) }
			else if (k === 'channels') { prop = 'channels'; next = parseInt(String(vals[0]), 10) }
			else if (k === 'format' || k === 'codec') { prop = k; next = vals[0] != null ? String(vals[0]) : null }
			else return false
			const changed = f.audio[prop] !== next
			f.audio[prop] = next
			return changed
		}
		return false
	},

	/** @returns {boolean} true when a template field changed (WO-401 F3-revised) */
	_routeLayerHost(layer, sub, vals) {
		const t = layer.template || (layer.template = { path: null, width: 0, height: 0, fps: 0 })
		let prop
		let next
		if (sub === 'path') { prop = 'path'; next = vals[0] != null ? String(vals[0]) : null }
		else if (sub === 'width') { prop = 'width'; next = parseInt(String(vals[0]), 10) || 0 }
		else if (sub === 'height') { prop = 'height'; next = parseInt(String(vals[0]), 10) || 0 }
		else if (sub === 'fps') { prop = 'fps'; next = Number(vals[0]) || 0 }
		else return false
		const changed = t[prop] !== next
		t[prop] = next
		return changed
	},
}

module.exports = { layerMethods }
