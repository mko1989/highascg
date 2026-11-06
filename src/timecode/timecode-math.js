'use strict'

/**
 * WO-974 — SMPTE timecode math for LTC in/out (24, 25, 29.97 drop-frame, 30).
 *
 * A "frame count" is the number of frames since 00:00:00:00 at the mode's REAL rate (29.97 DF counts
 * 30000/1001 frames per second of wall time; its labels skip ;00 and ;01 every minute except each tenth).
 * Timecodes wrap at 24 h.
 */

const FPS_MODES = Object.freeze({
	24: Object.freeze({ key: '24', fps: 24, nominal: 24, df: false }),
	25: Object.freeze({ key: '25', fps: 25, nominal: 25, df: false }),
	'29.97df': Object.freeze({ key: '29.97df', fps: 30000 / 1001, nominal: 30, df: true }),
	30: Object.freeze({ key: '30', fps: 30, nominal: 30, df: false }),
})

/** DF constants (29.97): 2 labels dropped per minute, none on minutes divisible by 10. */
const DF_DROP = 2
const DF_FRAMES_PER_MIN = 30 * 60 - DF_DROP // 1798
const DF_FRAMES_PER_10MIN = 10 * 30 * 60 - 9 * DF_DROP // 17982

/**
 * @param {unknown} v 24 | 25 | 29.97 | '29.97df' | 30 (numbers or strings); anything else → 25
 * @returns {{ key: string, fps: number, nominal: number, df: boolean }}
 */
function fpsMode(v) {
	const s = String(v ?? '')
		.trim()
		.toLowerCase()
	if (s === '24' || s === '23.976' || s === '23.98') return FPS_MODES[24]
	if (s === '29.97' || s === '29.97df' || s === '30df') return FPS_MODES['29.97df']
	if (s === '30') return FPS_MODES[30]
	return FPS_MODES[25]
}

/** Frames in 24 h at the mode's real rate (labels per day for NDF). */
function framesPerDay(mode) {
	const m = fpsMode(mode?.key ?? mode)
	return m.df ? 6 * 24 * DF_FRAMES_PER_10MIN : 24 * 3600 * m.nominal
}

function wrapFrames(frames, mode) {
	const n = framesPerDay(mode)
	return ((Math.floor(frames) % n) + n) % n
}

/**
 * @param {number} frames frame count (any integer; wrapped to 24 h)
 * @param {object|string|number} mode
 * @returns {{ h: number, m: number, s: number, f: number, df: boolean }}
 */
function framesToTc(frames, mode) {
	const md = fpsMode(mode?.key ?? mode)
	let n = wrapFrames(frames, md)
	if (md.df) {
		const d = Math.floor(n / DF_FRAMES_PER_10MIN)
		const r = n % DF_FRAMES_PER_10MIN
		n += 9 * DF_DROP * d + (r < DF_DROP ? 0 : DF_DROP * Math.floor((r - DF_DROP) / DF_FRAMES_PER_MIN))
	}
	const fr = md.nominal
	return {
		h: Math.floor(n / (fr * 3600)) % 24,
		m: Math.floor(n / (fr * 60)) % 60,
		s: Math.floor(n / fr) % 60,
		f: n % fr,
		df: md.df,
	}
}

/**
 * @param {{ h: number, m: number, s: number, f: number }} tc
 * @param {object|string|number} mode
 * @returns {number} frame count (labels that DF drops map onto the next real frame)
 */
function tcToFrames(tc, mode) {
	const md = fpsMode(mode?.key ?? mode)
	const fr = md.nominal
	let n = ((tc.h * 60 + tc.m) * 60 + tc.s) * fr + tc.f
	if (md.df) {
		const mins = tc.h * 60 + tc.m
		n -= DF_DROP * (mins - Math.floor(mins / 10))
		if (tc.m % 10 !== 0 && tc.s === 0 && tc.f < DF_DROP) n += DF_DROP - tc.f // a dropped label
	}
	return wrapFrames(n, md)
}

/** Wall-clock ms → frame count (floor, with a tolerance so exact frame starts never land one short). */
function msToFrames(ms, mode) {
	const md = fpsMode(mode?.key ?? mode)
	return Math.floor((Number(ms) || 0) * (md.fps / 1000) + 1e-6)
}

function framesToMs(frames, mode) {
	const md = fpsMode(mode?.key ?? mode)
	return (frames * 1000) / md.fps
}

/** @returns {string} `HH:MM:SS:FF` (`;` before the frames for drop-frame) */
function formatTc(tc) {
	const p = (x) => String(x).padStart(2, '0')
	return `${p(tc.h)}:${p(tc.m)}:${p(tc.s)}${tc.df ? ';' : ':'}${p(tc.f)}`
}

/**
 * @param {string} text `HH:MM:SS:FF` / `HH:MM:SS;FF` / `HH:MM:SS.FF`
 * @param {object|string|number} [mode] when given, fields are range-checked against it
 * @returns {{ h: number, m: number, s: number, f: number, df: boolean } | null}
 */
function parseTc(text, mode) {
	const m = /^\s*(\d{1,2}):(\d{2}):(\d{2})([:;.])(\d{2})\s*$/.exec(String(text ?? ''))
	if (!m) return null
	const tc = { h: +m[1], m: +m[2], s: +m[3], f: +m[5], df: m[4] === ';' }
	if (tc.h > 23 || tc.m > 59 || tc.s > 59) return null
	if (mode != null) {
		const md = fpsMode(mode?.key ?? mode)
		if (tc.f >= md.nominal) return null
		tc.df = md.df
	}
	return tc
}

function msToTc(ms, mode) {
	return framesToTc(msToFrames(ms, mode), mode)
}

function tcToMs(tc, mode) {
	return framesToMs(tcToFrames(tc, mode), mode)
}

/** Shortest signed distance a→b in frames across the 24 h wrap. */
function frameDelta(a, b, mode) {
	const n = framesPerDay(mode)
	let d = (b - a) % n
	if (d > n / 2) d -= n
	if (d < -n / 2) d += n
	return d
}

module.exports = {
	fpsMode,
	framesPerDay,
	framesToTc,
	tcToFrames,
	msToFrames,
	framesToMs,
	formatTc,
	parseTc,
	msToTc,
	tcToMs,
	frameDelta,
}
