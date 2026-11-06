'use strict'

/**
 * WO-974 — LTC reader lock state + chase decision (pure; the service feeds it decoded frames and wall time).
 *
 * States: none (never heard) → acquiring (frames, not yet consecutive) → locked (≥ lockFrames consecutive +1
 * steps) → freewheel (signal gone < freewheelMs: position extrapolated) → lost. `still` = the same frame
 * repeating (a parked source that keeps sending).
 */

const { fpsMode, frameDelta, framesToTc, formatTc, framesToMs, framesPerDay } = require('./timecode-math')

class LtcLock {
	/**
	 * @param {{ fps?: unknown, lockFrames?: number, dropoutMs?: number, freewheelMs?: number }} [opts]
	 */
	constructor(opts = {}) {
		this.mode = fpsMode(opts.fps)
		this.lockFrames = Math.max(2, opts.lockFrames || 4)
		this.dropoutMs = opts.dropoutMs || 400
		this.freewheelMs = opts.freewheelMs ?? 2000
		this.reset()
	}

	reset() {
		this.last = null
		this.run = 0
		this.still = 0
		this.jumps = 0
		this.lockedOnce = false
		this.frameCount = 0
	}

	/**
	 * @param {number} frames frame count of the decoded LTC frame (its start)
	 * @param {number} at arrival time, ms (the frame has fully arrived: "now" ≈ its end)
	 */
	push(frames, at) {
		this.frameCount++
		/* After silence the decoder hands over the LAST frame from before it once the signal returns (LTC frames
		 * complete on the next bit edge) — one step after the previous frame, so it used to continue the run and
		 * re-lock instantly on a stale position (box 06.11: two wrong 1 s seeks per dropout, a play at 76 s before
		 * the real 300 s). A gap longer than dropoutMs restarts acquisition. */
		if (!this.last || at - this.last.at > this.dropoutMs) {
			this.run = 1
			this.still = 0
		} else {
			const d = frameDelta(this.last.frames, frames, this.mode)
			if (d === 1) {
				this.run++
				this.still = 0
			} else if (d === 0) {
				this.still++
				this.run = 0
			} else {
				this.run = 1
				this.still = 0
				this.jumps++
			}
		}
		this.last = { frames, at }
		if (this.run >= this.lockFrames) this.lockedOnce = true
	}

	/** @param {number} now ms */
	state(now) {
		if (!this.last) return 'none'
		const age = now - this.last.at
		if (age <= this.dropoutMs) {
			if (this.run >= this.lockFrames) return 'locked'
			if (this.still >= this.lockFrames) return 'still'
			return 'acquiring'
		}
		if (this.lockedOnce && this.run >= this.lockFrames && age <= this.dropoutMs + this.freewheelMs) return 'freewheel'
		return 'lost'
	}

	/**
	 * Current position in frames (fractional) — extrapolated while running, the held frame while still.
	 * @param {number} now ms
	 * @returns {number | null}
	 */
	positionFrames(now) {
		if (!this.last) return null
		const st = this.state(now)
		if (st === 'still' || st === 'acquiring' || st === 'lost') return this.last.frames
		const n = framesPerDay(this.mode)
		return (this.last.frames + 1 + ((now - this.last.at) * this.mode.fps) / 1000) % n
	}

	/** @param {number} now ms */
	snapshot(now) {
		const st = this.state(now)
		const pos = this.positionFrames(now)
		return {
			state: st,
			tc: pos == null ? null : formatTc(framesToTc(Math.floor(pos), this.mode)),
			frames: pos == null ? null : Math.floor(pos),
			pos, // fractional: the chase target uses it (floor() alone lags the reader by half a frame on average)
			ageMs: this.last ? Math.round(now - this.last.at) : null,
			run: this.run,
			jumps: this.jumps,
			decoded: this.frameCount,
		}
	}
}

/**
 * What the chased timeline should do now.
 * @param {{ state: string, frames: number | null, pos?: number | null }} ltc  lock snapshot (extrapolated position)
 * @param {{ position: number, playing: boolean, duration: number }} pb  timeline playback (ms)
 * @param {{ fps?: unknown, offsetFrames?: number, thresholdFrames?: number, stopOnLoss?: boolean, engaged?: boolean,
 *   now?: number, lastActionAt?: number, minActionGapMs?: number, latencyMs?: number }} cfg
 * @returns {{ action: 'none' | 'play' | 'seek' | 'pause', ms?: number, reason?: string, errorMs?: number }}
 *   errorMs (locked + playing): timeline position − LTC position, the measured chase error
 */
function decideChase(ltc, pb, cfg = {}) {
	const mode = fpsMode(cfg.fps)
	const frameMs = 1000 / mode.fps
	const none = { action: 'none' }
	if (!pb) return none
	const gapOk = !cfg.lastActionAt || (cfg.now ?? Date.now()) - cfg.lastActionAt >= (cfg.minActionGapMs ?? 400)
	if (ltc.state === 'freewheel') return none
	if (ltc.state === 'lost' || ltc.state === 'none' || ltc.frames == null) {
		return pb.playing && cfg.engaged && cfg.stopOnLoss !== false ? { action: 'pause', reason: 'ltc_lost' } : none
	}
	if (ltc.state === 'acquiring') return none
	const rel = frameDelta(cfg.offsetFrames || 0, ltc.pos ?? ltc.frames, mode)
	// latency is part of the target: added after the decision it read as chase error and re-seeked every 400 ms
	const ms = Math.max(0, framesToMs(rel, mode) + (Number(cfg.latencyMs) || 0))
	const inRange = rel >= 0 && ms < pb.duration
	if (ltc.state === 'still') {
		if (pb.playing) return { action: 'pause', ms, reason: 'ltc_still' }
		if (inRange && Math.abs(pb.position - ms) > frameMs / 2 && gapOk) return { action: 'seek', ms, reason: 'ltc_still' }
		return none
	}
	// locked
	if (!inRange) return pb.playing && cfg.engaged ? { action: 'pause', reason: 'ltc_out_of_range' } : none
	if (!pb.playing) return gapOk ? { action: 'play', ms, reason: 'ltc_running' } : none
	const thr = Math.max(1, cfg.thresholdFrames ?? 3) * frameMs
	const errorMs = pb.position - ms
	if (Math.abs(errorMs) > thr && gapOk) return { action: 'seek', ms, reason: 'ltc_jump', errorMs }
	return { action: 'none', errorMs }
}

/**
 * The engine calls for a chase decision, in order (`wait`: the rest runs that many ms later).
 * - Preroll (box 06.11, 4K H.264 on PRV, Caspar file time − engine): a playing CALL SEEK lands −326…−645 ms behind,
 *   a start from stopped −519…−645 ms (PLAY → PAUSE → SEEK too), a paused seek + resume −202 ms; pause, seek Δ ahead
 *   and resume when the LTC gets there: −84 ms (Δ 300) / −50 ms (Δ 600). So a chase locate parks the picture for Δ
 *   instead of running late.
 * - Without preroll: a paused timeline RESUMEs where it is parked and ignores the from-position (no black flash) —
 *   after a hold the LTC is ~lockFrames ahead (box: −224 ms, then a second seek), so it seeks first.
 * @param {{ action: string }} d  decideChase result
 * @param {{ position: number, playing: boolean }} pb
 * @param {number | undefined} ms  target position
 * @param {number} fps
 * @param {{ prerollMs?: number }} [opt]
 * @returns {Array<['play' | 'seek' | 'pause' | 'wait', number?]>}
 */
function chaseOps(d, pb, ms, fps, opt = {}) {
	const pre = Math.max(0, Number(opt.prerollMs) || 0)
	if (d.action === 'play') {
		// a seek on a stopped timeline makes it the air timeline, loaded paused there (engine seek()): same path
		if (pre > 0) return [['seek', ms + pre], ['wait', pre], ['play']]
		return Math.abs(pb.position - ms) > 500 / fps ? [['seek', ms], ['play', ms]] : [['play', ms]]
	}
	if (d.action === 'seek') return pre > 0 && pb.playing ? [['pause'], ['seek', ms + pre], ['wait', pre], ['play']] : [['seek', ms]]
	if (d.action === 'pause') return ms != null ? [['pause'], ['seek', ms]] : [['pause']]
	return []
}

module.exports = { LtcLock, decideChase, chaseOps }
