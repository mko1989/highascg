'use strict'

/**
 * WO-700 R7 — where a typed head's digital beam points against the angles it is sent (owner 23.10: "it adjusts
 * position of the beam correctly for first 2 marks then it starts to drift especially on the other side of the
 * stage"). One constant offset cannot put the beam on every mark when the head is not exactly where it is patched,
 * and the head must not move — so the correction depends on where the head points:
 *
 *   offset      { pan, tilt } °  the operator's trim (Calibrate heads → Beam offset), added everywhere
 *   offset_map  [{ pan, tilt, dpan, dtilt }]  one pin per "Beam is on <mark>": at those physical angles the beam
 *               is exactly on the mark (dpan / dtilt on top of the trim at the time); in between, the pins are
 *               blended by inverse distance² in (pan, tilt) — exact at every pin, the nearest pins win
 *
 * The real head is never touched: the previs draws axes at sent + offsetAt(), and Point at sends the angle whose
 * sent + offsetAt() is the geometric one (gdtf-ik.js aimChain).
 */

const MAX_PINS = 64
const PIN_DEG = 1 // a new pin this close (°, pan / tilt) to an older one replaces it — the same mark again

const num = (v, lo, hi) => {
	const n = Number(v)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null
}

/** Patch input → the pins kept (finite, clamped, at most MAX_PINS, newest last). */
function normalizeMap(raw) {
	if (!Array.isArray(raw)) return []
	const out = []
	for (const p of raw) {
		const v = [num(p?.pan, -720, 720), num(p?.tilt, -360, 360), num(p?.dpan, -180, 180), num(p?.dtilt, -180, 180)]
		if (v.some((x) => x === null)) continue
		out.push({ pan: v[0], tilt: v[1], dpan: v[2], dtilt: v[3] })
	}
	return out.slice(-MAX_PINS)
}

/** `pins` with `pin` added; an older pin within PIN_DEG of it is replaced. */
function addPin(pins, pin) {
	const keep = pins.filter((p) => Math.hypot(p.pan - pin.pan, p.tilt - pin.tilt) >= PIN_DEG)
	return [...keep, pin].slice(-MAX_PINS)
}

/** Inverse-distance² blend of the pins at physical (pan, tilt); exact on a pin; {0, 0} without pins. */
function blend(pins, pan, tilt) {
	if (!pins.length) return { pan: 0, tilt: 0 }
	let w = 0
	let dp = 0
	let dt = 0
	for (const p of pins) {
		const d2 = (p.pan - pan) ** 2 + (p.tilt - tilt) ** 2
		if (d2 < 1e-12) return { pan: p.dpan, tilt: p.dtilt }
		w += 1 / d2
		dp += p.dpan / d2
		dt += p.dtilt / d2
	}
	return { pan: dp / w, tilt: dt / w }
}

/** The correction fx's digital beam gets at physical (pan, tilt): the trim + the pins' blend. */
function offsetAt(fx, pan, tilt) {
	const b = blend(fx?.offset_map || [], pan, tilt)
	return { pan: (Number(fx?.offset?.pan) || 0) + b.pan, tilt: (Number(fx?.offset?.tilt) || 0) + b.tilt }
}

/**
 * The physical angles to send so that sent + offsetAt(sent) = (pan, tilt), the geometric aim. The correction varies
 * slowly with the angle, so damped fixed-point steps from the trim settle it; the closest step is kept if two near
 * pins that disagree a lot make it oscillate.
 */
function sentFor(fx, pan, tilt) {
	let s = { pan: pan - (Number(fx?.offset?.pan) || 0), tilt: tilt - (Number(fx?.offset?.tilt) || 0) }
	if (!fx?.offset_map?.length) return s
	let best = s
	let bestErr = Infinity
	for (let k = 0; k < 40; k++) {
		const e = offsetAt(fx, s.pan, s.tilt)
		const rp = pan - e.pan - s.pan
		const rt = tilt - e.tilt - s.tilt
		const err = Math.hypot(rp, rt)
		if (err < bestErr) {
			bestErr = err
			best = s
		}
		if (err < 1e-6) break
		s = { pan: s.pan + (k < 10 ? 1 : 0.5) * rp, tilt: s.tilt + (k < 10 ? 1 : 0.5) * rt }
	}
	return best
}

module.exports = { normalizeMap, addPin, blend, offsetAt, sentFor, MAX_PINS, PIN_DEG }
