/**
 * Wall-clock extrapolation between sparse Caspar OSC `file/time` (and INFO) updates.
 * Prefers advancing `file/frame` when `file/time` duration is wrong (e.g. stuck at 0:13).
 */

/**
 * @typedef {object} PlaybackTimingClock
 * @property {number|null} anchorElapsed
 * @property {number} anchorMs
 * @property {number|null} duration
 * @property {number} fps
 * @property {number|null} lastSourceElapsed
 * @property {number|null} lastFrameElapsed
 * @property {boolean} playing
 * @property {string} clipKey
 */

/** @returns {PlaybackTimingClock} */
export function createPlaybackTimingClock() {
	return {
		anchorElapsed: null,
		anchorMs: 0,
		duration: null,
		fps: 50,
		lastSourceElapsed: null,
		lastFrameElapsed: null,
		playing: false,
		clipKey: '',
	}
}

/**
 * @param {object} f
 * @returns {string}
 */
function clipKeyFromFile(f) {
	const name = f?.name != null ? String(f.name) : ''
	const path = f?.path != null ? String(f.path) : ''
	return `${name}|${path}|${f?.duration ?? ''}|${f?.frameTotal ?? ''}`
}

/**
 * @param {object} f
 * @param {number} fpsFallback
 * @returns {{ file: object, fps: number, elapsed: number|null, duration: number|null, frameElapsed: number|null, frameTotal: number|null }}
 */
export function resolvePlaybackTimingFromFile(f, fpsFallback = 50) {
	const o = f && typeof f === 'object' ? { ...f } : {}
	const fps = Number.isFinite(o.fps) && o.fps > 0 ? o.fps : fpsFallback
	if (!Number.isFinite(o.duration) && Number.isFinite(o.frameTotal) && o.frameTotal > 0) {
		o.duration = o.frameTotal / fps
	}
	if (!Number.isFinite(o.elapsed) && Number.isFinite(o.frameElapsed) && o.frameElapsed >= 0) {
		o.elapsed = o.frameElapsed / fps
	}
	const frameElapsed = Number.isFinite(o.frameElapsed) && o.frameElapsed >= 0 ? o.frameElapsed : null
	const frameTotal = Number.isFinite(o.frameTotal) && o.frameTotal > 0 ? o.frameTotal : null
	let duration = Number.isFinite(o.duration) && o.duration > 0 ? o.duration : null
	let elapsed = Number.isFinite(o.elapsed) && o.elapsed >= 0 ? o.elapsed : null

	if (frameTotal != null) {
		const frameDur = frameTotal / fps
		if (!Number.isFinite(duration) || frameDur > duration + 0.2) duration = frameDur
	}
	if (frameElapsed != null) {
		const frameSec = frameElapsed / fps
		if (!Number.isFinite(elapsed) || frameSec > elapsed + 0.03) elapsed = frameSec
	}
	if (Number.isFinite(duration) && Number.isFinite(elapsed)) {
		o.duration = duration
		o.elapsed = elapsed
		o.remaining = Math.max(0, duration - elapsed)
		o.progress = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : o.progress
	}
	return { file: o, fps, elapsed, duration, frameElapsed, frameTotal }
}

/**
 * @param {PlaybackTimingClock} clock
 * @param {object} [layerState]
 * @returns {boolean}
 */
function layerLooksPaused(layerState) {
	if (!layerState || typeof layerState !== 'object') return false
	if (String(layerState.type || '') === 'empty') return true
	const sp = layerState.speed ?? layerState.playbackSpeed ?? layerState.file?.speed
	if (sp === 0 || sp === '0') return true
	return false
}

/**
 * @param {PlaybackTimingClock} clock
 * @param {object} file
 * @param {{ now?: number, layerState?: object, fpsFallback?: number, forcePlaying?: boolean|null }} [opts]
 * @returns {object}
 */
export function syncPlaybackTimingClock(clock, file, opts = {}) {
	const now = opts.now ?? performance.now()
	const fpsFallback = opts.fpsFallback ?? 50
	const { file: f, fps, elapsed, duration, frameElapsed, frameTotal } = resolvePlaybackTimingFromFile(
		file,
		fpsFallback,
	)
	const key = clipKeyFromFile(f)

	if (key !== clock.clipKey) {
		clock.clipKey = key
		clock.lastSourceElapsed = null
		clock.lastFrameElapsed = null
		clock.playing = false
	}

	if (layerLooksPaused(opts.layerState)) {
		clock.playing = false
		if (elapsed != null) {
			clock.anchorElapsed = elapsed
			clock.anchorMs = now
			clock.lastSourceElapsed = elapsed
		}
		clock.duration = duration
		clock.fps = fps
		clock.lastFrameElapsed = frameElapsed
		return f
	}

	if (opts.forcePlaying === false) clock.playing = false
	else if (opts.forcePlaying === true) clock.playing = true

	clock.duration = duration
	clock.fps = fps

	if (elapsed == null || duration == null) {
		clock.playing = false
		clock.lastFrameElapsed = frameElapsed
		return f
	}

	const framesStillGoing =
		frameTotal != null &&
		frameElapsed != null &&
		frameElapsed < frameTotal - 0.5
	const atEnd = elapsed >= duration - 0.04 && !framesStillGoing

	if (atEnd) {
		clock.anchorElapsed = duration
		clock.anchorMs = now
		clock.lastSourceElapsed = elapsed
		clock.lastFrameElapsed = frameElapsed
		clock.playing = false
		return f
	}

	const prevEl = clock.lastSourceElapsed
	const prevFr = clock.lastFrameElapsed
	const jumpedBack = prevEl != null && elapsed < prevEl - 0.35
	const frameAdvanced =
		frameElapsed != null && (prevFr == null || frameElapsed > prevFr + 0.01)
	const timeAdvanced = prevEl == null || elapsed > prevEl + 0.02 || jumpedBack

	if (timeAdvanced || frameAdvanced || clock.anchorElapsed == null) {
		clock.anchorElapsed = elapsed
		clock.anchorMs = now
		clock.lastSourceElapsed = elapsed
		if (opts.forcePlaying !== false) clock.playing = true
	} else if (frameElapsed != null && prevFr != null && frameElapsed <= prevFr + 0.01 && elapsed <= prevEl + 0.02) {
		/* OSC time frozen — keep extrapolating from last anchor */
	} else if (opts.forcePlaying === true) {
		clock.playing = true
	}

	clock.lastFrameElapsed = frameElapsed
	return f
}

/**
 * @param {PlaybackTimingClock} clock
 * @param {object} file
 * @param {{ now?: number, fpsFallback?: number }} [opts]
 * @returns {object}
 */
export function extrapolatePlaybackFile(clock, file, opts = {}) {
	const now = opts.now ?? performance.now()
	const fpsFallback = opts.fpsFallback ?? 50
	const { file: base, duration: resolvedDur } = resolvePlaybackTimingFromFile(file, fpsFallback)
	const dur = clock.duration ?? resolvedDur
	if (!clock.playing || dur == null || clock.anchorElapsed == null) return base

	const dt = (now - clock.anchorMs) / 1000
	let elapsed = clock.anchorElapsed + (Number.isFinite(dt) && dt > 0 ? dt : 0)
	const frameTotal = base.frameTotal
	const frameElapsed = base.frameElapsed
	const fps = clock.fps || fpsFallback
	const framesStillGoing =
		Number.isFinite(frameTotal) &&
		frameTotal > 0 &&
		Number.isFinite(frameElapsed) &&
		frameElapsed < frameTotal - 0.5

	if (elapsed >= dur - 0.02 && !framesStillGoing) {
		elapsed = dur
		clock.playing = false
		clock.anchorElapsed = dur
		clock.anchorMs = now
	} else if (Number.isFinite(frameTotal) && frameTotal > 0) {
		const frameCap = frameTotal / fps
		if (elapsed > frameCap + 0.05) elapsed = frameCap
	}

	const remaining = Math.max(0, dur - elapsed)
	const out = { ...base, duration: dur, elapsed, remaining }
	out.progress = dur > 0 ? Math.min(1, Math.max(0, elapsed / dur)) : base.progress
	return out
}
