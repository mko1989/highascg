'use strict'

/**
 * WO-1092 — LTC out: where the timecode should be, and how to get it there. Pure (no processes, no clock reads).
 *
 * The encoder (tools/ltc/ltc_helper.py) reports, every few frames, the label it wrote and `at` = the wall time that
 * frame's first sample PLAYS (snd_pcm_delay at the write). So the error is measured where it matters — at the DAC —
 * not where node happens to read a pipe: error = label − where the playhead is at `at` (frames, + = LTC ahead).
 *  - |error| ≥ ALIGN_FRAMES (a seek, a loop wrap, a start): `align TC EPOCH` — the helper puts exactly that frame at
 *    exactly that wall time (pads silence < 1 frame, or skips frames it is already late for). One command, no landing
 *    latency to learn (WO-1058's `aim` is gone: the old locate landed 1-2 frames late and was guessed at).
 *  - a small steady error (clock drift, the start phase): `slew N` — the next frames are stretched / shrunk by N samples
 *    in total, ≤ 1 % per frame, which no reader notices. The LTC stays continuous.
 */

const { framesPerDay, framesToTc, formatTc, tcToFrames, parseTc } = require('./timecode-math')

const ALIGN_FRAMES = 1 // off by a whole frame: re-align (one jump) instead of slewing
const DEADBAND_MS = 1.5 // closer than this is "on time"
const HISTORY = 5 // reports in the median

function msSinceLocalMidnight(now) {
	const d = new Date(now)
	return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds()
}

/**
 * Fractional frame index the LTC should have on air at wall time `at` (null = silent).
 * @param {{ source?: string, latencyMs?: number }} cfg  latencyMs > 0 delays the LTC
 * @param {{ fps: number }} mode
 * @param {number} offsetFrames LTC at timeline 0 / where the test clock starts
 * @param {{ playing: boolean, position: number } | null} pb the playhead as read at `now`
 * @param {number} now
 * @param {number} [at] when the frame plays (a report's `at`: up to ~0.2 s ahead; an old report: behind) — clamped ±1 s
 * @param {number} [t0] when source 'test' started
 */
function expectedFramesAt(cfg, mode, offsetFrames, pb, now, at = now, t0 = now) {
	const lat = Number(cfg.latencyMs) || 0
	const toF = (ms) => (ms * mode.fps) / 1000
	const t = now + Math.max(-1000, Math.min(1000, at - now))
	if (cfg.source === 'clock') return toF(msSinceLocalMidnight(t) - lat)
	if (cfg.source === 'test') return offsetFrames + toF(Math.max(0, t - t0 - lat))
	if (!pb || !pb.playing) return null
	return offsetFrames + toF(Math.max(0, pb.position + (t - now) - lat))
}

/** Whole frame being shown at `at` (null = silent) — the pre-WO-1092 contract, kept for the smokes. */
function targetFramesAt(cfg, mode, offsetFrames, pb, now, at = now) {
	const e = expectedFramesAt(cfg, mode, offsetFrames, pb, now, at)
	return e == null ? null : Math.floor(e + 1e-6)
}

/** label − expected, in frames, across the 24 h wrap. */
function errorFrames(label, expected, mode) {
	const n = framesPerDay(mode)
	let d = (label - expected) % n
	if (d > n / 2) d -= n
	if (d < -n / 2) d += n
	return d
}

/**
 * The `align` line that puts the first frame at or after wall time `target` on its exact epoch.
 * @returns {{ line: string, frames: number, epoch: number } | null}
 */
function alignCommand(cfg, mode, offsetFrames, pb, now, target, t0) {
	const e = expectedFramesAt(cfg, mode, offsetFrames, pb, now, target, t0)
	if (e == null) return null
	const f = Math.ceil(e - 1e-6)
	const epoch = target + ((f - e) * 1000) / mode.fps
	const n = framesPerDay(mode)
	const label = ((f % n) + n) % n
	return { line: `align ${formatTc({ ...framesToTc(label, mode), df: false })} ${epoch.toFixed(2)}`, frames: label, epoch }
}

/** The held frame while paused with whenPaused 'hold'. */
function heldFrames(cfg, mode, offsetFrames, pb) {
	const lat = Number(cfg.latencyMs) || 0
	const n = framesPerDay(mode)
	const f = offsetFrames + Math.floor((Math.max(0, (pb?.position || 0) - lat) * mode.fps) / 1000 + 1e-6)
	return ((f % n) + n) % n
}

/** A report's label → frame index. */
function reportFrames(tc, mode) {
	const p = parseTc(tc, mode)
	return p ? tcToFrames(p, mode) : null
}

function median(a) {
	const s = [...a].sort((x, y) => x - y)
	return s.length ? s[Math.floor(s.length / 2)] : 0
}

/**
 * What to do with one report.
 * @param {number} errF this report's error (frames)
 * @param {number[]} history recent errors in ms (mutated: this one appended, trimmed to HISTORY)
 * @param {{ fps: number }} mode
 * @param {number} rate sample rate
 * @returns {{ action: 'align' | 'slew' | 'none', samples?: number, driftMs: number }}
 */
function decide(errF, history, mode, rate = 48000) {
	const ms = (errF * 1000) / mode.fps
	if (Math.abs(errF) >= ALIGN_FRAMES) {
		history.length = 0
		return { action: 'align', driftMs: ms }
	}
	history.push(ms)
	while (history.length > HISTORY) history.shift()
	const m = median(history)
	if (history.length < 3 || Math.abs(m) < DEADBAND_MS) return { action: 'none', driftMs: m }
	history.length = 0
	return { action: 'slew', samples: Math.round((m * rate) / 1000), driftMs: m }
}

/** Has the playhead jumped (seek / wrap / pause change) between two reads? */
function playheadJumped(prev, cur, mode) {
	if (!prev || !cur) return !!prev !== !!cur
	if (prev.pb?.playing !== cur.pb?.playing) return true
	if (!cur.pb?.playing) return false
	const want = prev.pb.position + (cur.now - prev.now)
	return Math.abs(cur.pb.position - want) > (1.5 * 1000) / mode.fps
}

module.exports = {
	expectedFramesAt,
	targetFramesAt,
	errorFrames,
	alignCommand,
	heldFrames,
	reportFrames,
	decide,
	playheadJumped,
}
