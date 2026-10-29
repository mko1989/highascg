/**
 * WO-813 — the look layer's clip trim maths for the web inspector (components/inspector-clip-trim.js). Twin of the
 * Godot godot/client/features/live/clip_trim_model.gd: same rules, same stored values. `trimInMs` / `trimOutMs` are
 * WO-570's layer fields (the server's take turns them into SEEK / IN / LENGTH under either start option); an in at 0
 * and an out at the clip's end are stored as null (no trim), so a reset writes null. In stays before out by a frame.
 */

import { evaluateMath } from './math-input.js'

/** The "Clip start point" drop-down. No "Custom" (owner 29.10): trim works under both; a stored legacy "custom" shows
 * and takes as "beginning" with its trim (server: scene-play-seek.js resolveEffectiveStartBehaviour). */
export const STARTS = [
	['beginning', 'Start from beginning'],
	['relativeToPrevious', 'Relative to the clip playing on this layer'],
]

export const RESET_TIP_IN = "Ctrl+click or ↺ to reset to the clip's start"
export const RESET_TIP_OUT = "Ctrl+click or ↺ to reset to the clip's end"

export const fpsOrDefault = (fps) => (Number(fps) > 0 ? Number(fps) : 25)

/** ms → the frame it falls in (floor, like Caspar shows the frame at or before a seek). */
function msToFrame(ms, fps) {
	return Math.max(0, Math.floor((Math.max(0, Number(ms) || 0) * fpsOrDefault(fps)) / 1000 + 1e-6))
}

export function frameToMs(frame, fps) {
	return Math.max(0, (Number(frame) * 1000) / fpsOrDefault(fps))
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** A slider position snapped to the frame start, clamped into the clip. */
function snapMs(ms, durMs, fps) {
	const top = Math.max(0, durMs)
	return clamp(frameToMs(msToFrame(clamp(ms, 0, top), fps), fps), 0, top)
}

/** The in point shown (null = the clip's start). */
export function inMs(layer) {
	return layer?.trimInMs != null ? Math.max(0, Number(layer.trimInMs)) : 0
}

/** The out point shown (null = the clip's end). */
function outMs(layer, durMs) {
	if (layer?.trimOutMs == null) return durMs
	const v = Number(layer.trimOutMs)
	return durMs > 0 ? Math.min(v, durMs) : v
}

export const hasTrim = (layer) => layer?.trimInMs != null || layer?.trimOutMs != null

/** "Trim in" at `posMs` → {ok, patch?, error?}. Refused at or after the out point (one frame apart at least). */
export function setIn(layer, posMs, durMs, fps) {
	if (!(durMs > 0)) return { ok: false, error: 'Clip length unknown' }
	const p = snapMs(posMs, durMs, fps)
	if (p > outMs(layer, durMs) - frameToMs(1, fps) + 0.001) return { ok: false, error: 'In must be before Out' }
	return { ok: true, patch: { trimInMs: p > 0 ? Math.round(p) : null } }
}

/** "Trim out" at `posMs` → {ok, patch?, error?}. Refused at or before the in point; at the clip's end it clears. */
export function setOut(layer, posMs, durMs, fps) {
	if (!(durMs > 0)) return { ok: false, error: 'Clip length unknown' }
	const p = snapMs(posMs, durMs, fps)
	if (p < inMs(layer) + frameToMs(1, fps) - 0.001) return { ok: false, error: 'Out must be after In' }
	return { ok: true, patch: { trimOutMs: p < durMs - frameToMs(1, fps) / 2 ? Math.round(p) : null } }
}

/** The points shown, clamped into the clip with in ≤ out. Length unknown and no out stored → out = -1 (the end). */
export function points(layer, durMs) {
	let i = inMs(layer)
	if (durMs > 0) i = Math.min(i, durMs)
	else if (layer?.trimOutMs == null) return { in: i, out: -1 }
	const o = Math.max(0, outMs(layer, durMs))
	return { in: Math.min(i, o), out: o }
}

/** Ctrl+click / ↺ on "Trim in" → the clip's start (null). An out stored before the first frame goes too. */
export function resetIn(layer, fps) {
	const patch = { trimInMs: null }
	if (layer?.trimOutMs != null && Number(layer.trimOutMs) < frameToMs(1, fps) - 0.001) patch.trimOutMs = null
	return { ok: true, patch }
}

/** Ctrl+click / ↺ on "Trim out" → the clip's end (null). An in at or past the end (from a longer clip) goes too. */
export function resetOut(layer, durMs, fps) {
	const patch = { trimOutMs: null }
	if (durMs > 0 && layer?.trimInMs != null && inMs(layer) > durMs - frameToMs(1, fps) + 0.001) patch.trimInMs = null
	return { ok: true, patch }
}

/** A click that resets instead of setting (owner 29.10: right-click does not work in a web GUI): Ctrl or Cmd held. */
export function isResetClick(e) {
	return !!e && (e.button ?? 0) === 0 && !!(e.ctrlKey || e.metaKey)
}

/** Seconds → "m:ss.ff" (.ff = frames), like Godot media_math.format_timecode. */
export function formatTc(sec, fps) {
	const f = Math.max(1, Math.floor(fpsOrDefault(fps) + 0.5))
	const total = Math.max(0, Math.floor(Math.max(0, Number(sec) || 0) * f))
	const ff = total % f
	const s = Math.floor(total / f)
	const m = Math.floor(s / 60)
	const h = Math.floor(m / 60)
	const p2 = (n) => String(n).padStart(2, '0')
	return h > 0 ? `${h}:${p2(m % 60)}:${p2(s % 60)}.${p2(ff)}` : `${m}:${p2(s % 60)}.${p2(ff)}`
}

/** A typed point → ms, or NaN. "m:ss.ff" / "h:mm:ss.ff" (.ff = frames); a plain number is seconds with + - * /. */
export function parseTc(text, fps) {
	const t = String(text ?? '').trim()
	if (!t) return NaN
	if (!t.includes(':')) {
		const v = evaluateMath(t)
		return Number.isNaN(v) || v < 0 ? NaN : v * 1000
	}
	const parts = t.split(':')
	let last = parts[parts.length - 1]
	let frames = 0
	if (last.includes('.')) {
		const ff = last.split('.')[1]
		if (!/^\d+$/.test(ff)) return NaN
		frames = Number(ff)
		last = last.split('.')[0]
	}
	parts[parts.length - 1] = last
	let sec = 0
	for (const p of parts) {
		if (!/^\d+$/.test(p)) return NaN
		sec = sec * 60 + Number(p)
	}
	return sec * 1000 + frameToMs(frames, fps)
}

/** The folded Trim row: "Full clip" or "in – out". */
export function summary(layer, durMs, fps) {
	if (!hasTrim(layer)) return 'Full clip'
	const pt = points(layer, durMs)
	return `${formatTc(pt.in / 1000, fps)} – ${pt.out >= 0 ? formatTc(pt.out / 1000, fps) : 'end'}`
}

/** The note for a /api/scene/layer-scrub answer. */
export function scrubNote(data) {
	if (data?.onPrv === true) return `Scrubbing PRV (channel ${Number(data.channel) || 0}) — PGM is not touched`
	if (data?.reason === 'pgm_only') return 'This screen has no PRV — the slider only picks the points for the next take'
	if (data?.reason === 'clip_not_staged')
		return 'PRV holds another clip on this layer — the slider only picks the points for the next take'
	return 'Look not on PRV — the slider only picks the points for the next take'
}
