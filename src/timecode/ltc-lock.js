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
		if (this.last) {
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
		} else {
			this.run = 1
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
			ageMs: this.last ? Math.round(now - this.last.at) : null,
			run: this.run,
			jumps: this.jumps,
			decoded: this.frameCount,
		}
	}
}

/**
 * What the chased timeline should do now.
 * @param {{ state: string, frames: number | null }} ltc  lock snapshot (extrapolated frame position)
 * @param {{ position: number, playing: boolean, duration: number }} pb  timeline playback (ms)
 * @param {{ fps?: unknown, offsetFrames?: number, thresholdFrames?: number, stopOnLoss?: boolean, engaged?: boolean,
 *   now?: number, lastActionAt?: number, minActionGapMs?: number }} cfg
 * @returns {{ action: 'none' | 'play' | 'seek' | 'pause', ms?: number, reason?: string }}
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
	const rel = frameDelta(cfg.offsetFrames || 0, ltc.frames, mode)
	const ms = Math.max(0, framesToMs(rel, mode))
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
	if (Math.abs(pb.position - ms) > thr && gapOk) return { action: 'seek', ms, reason: 'ltc_jump' }
	return none
}

module.exports = { LtcLock, decideChase }
