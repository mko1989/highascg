'use strict'

/**
 * WO-615 T6 — what the programmer can set on a typed fixture, and "point at" through the follow IK. Pure.
 *
 *   features(fx, wheels)  → { dimmer, add: [ColorAdd_* / ColorRGB_*], sub: [ColorSub_*], cto?: { attr, from, to, at },
 *                           colors: [{ attr, name, rgb }], gobos: [{ attr, name, media }], pan?, tilt?, zoom?: { from,
 *                           to, at (the GDTF default, physical) } } from the patched mode's channels (`fx.gdtf.channels`, gdtf-patch.js applyType) and
 *                           the type's wheels. Wheel entries are the channel sets of a Color<n> / Gobo<n> function that
 *                           name a wheel slot, one per slot (`{ [attr]: { set: name } }` selects it); `media` is its image
 *                           ("wheels/<media>.png" in the archive), rgb its CIE colour in sRGB.
 *   aimValues(fx, target, values)  → { Pan, Tilt } physical degrees pointing the beam at a PSN stage point (follow-ik.js
 *                           aim, nearest the programmer's current pan / tilt), or null (no pan / tilt, unreachable).
 */

const { aim } = require('./follow-ik')
const { cieToRgb } = require('./gdtf-visual')

const ADD = /^(ColorAdd_[A-Za-z]+|ColorRGB_[A-Za-z]+)$/
const SUB = /^ColorSub_[A-Za-z]+$/
const CT = /^(CTO|CTC|CTB)$/

const initialFn = (c) => c.functions[c.initial] || c.functions[0]
/** Physical range, and `at` = the value the channel's GDTF default means (what an unprogrammed control shows). */
function range(f) {
	const t = f.to > f.from ? (f.default - f.from) / (f.to - f.from) : 0
	const at = Math.round((f.physFrom + Math.max(0, Math.min(1, t)) * (f.physTo - f.physFrom)) * 100) / 100
	return { from: f.physFrom, to: f.physTo, at: at || 0 }
}

function wheelEntries(c, re, wheels, seen, out) {
	for (const f of c.functions) {
		if (!re.test(f.attribute) || !f.wheel) continue
		const slots = wheels?.[f.wheel] || []
		for (const s of f.sets) {
			const slot = slots[s.slot - 1]
			const key = `${f.attribute}|${s.slot}` // one entry per slot ("Deep red" / "Deep red step" select the same one)
			if (!slot || !s.name || seen.has(key)) continue
			seen.add(key)
			out.push({ attr: f.attribute, name: s.name, slot: s.slot, color: slot.color, media: slot.media || '' })
		}
	}
}

function features(fx, wheels) {
	const out = { dimmer: false, add: [], sub: [], colors: [], gobos: [] }
	const seen = new Set()
	for (const c of fx?.gdtf?.channels || []) {
		const f = initialFn(c)
		if (!f) continue
		const a = f.attribute
		if (a === 'Dimmer') out.dimmer = true
		else if (ADD.test(a) && !out.add.includes(a)) out.add.push(a)
		else if (SUB.test(a) && !out.sub.includes(a)) out.sub.push(a)
		else if (CT.test(a) && !out.cto) out.cto = { attr: a, ...range(f) }
		else if ((a === 'Pan' || a === 'Tilt' || a === 'Zoom') && !out[a.toLowerCase()]) out[a.toLowerCase()] = range(f)
		wheelEntries(c, /^Color\d+$/, wheels, seen, out.colors)
		wheelEntries(c, /^Gobo\d+$/, wheels, seen, out.gobos)
	}
	out.colors = out.colors.map(({ attr, name, color }) => ({ attr, name, rgb: color ? cieToRgb(color).map((v) => Math.round(v * 1000) / 1000) : [1, 1, 1] }))
	out.gobos = out.gobos.map(({ attr, name, media }) => ({ attr, name, media }))
	return out
}

function axisFn(fx, attribute) {
	for (const c of fx.gdtf?.channels || []) {
		const f = initialFn(c)
		if (f && f.attribute === attribute) return f
	}
	return null
}

/**
 * IK degrees from the DMX centre ↔ the function's physical value, as follow-ik.js axisBytes writes them (`invert` =
 * the patch's flip XOR a falling range, gdtf-patch.js applyType) — so an unflipped head gets physical = IK degrees.
 */
function toPhys(f, ax, deg) {
	let n = Math.max(0, Math.min(1, (deg + ax.range / 2) / ax.range))
	if (ax.invert) n = 1 - n
	return f.physFrom + n * (f.physTo - f.physFrom)
}

function toDeg(f, ax, phys) {
	const span = f.physTo - f.physFrom
	let n = span === 0 ? 0.5 : (phys - f.physFrom) / span
	if (ax.invert) n = 1 - n
	return n * ax.range - ax.range / 2
}

function aimValues(fx, target, values) {
	const pf = axisFn(fx, 'Pan')
	const tf = axisFn(fx, 'Tilt')
	if (!pf || !tf || !fx.pan || !fx.tilt || !fx.pose) return null
	const prev = {
		pan: Number.isFinite(values?.Pan) ? toDeg(pf, fx.pan, values.Pan) : 0,
		tilt: Number.isFinite(values?.Tilt) ? toDeg(tf, fx.tilt, values.Tilt) : 0,
	}
	const pt = aim(fx, target, prev)
	if (!pt) return null
	const r = (v) => Math.round(v * 100) / 100
	return { Pan: r(toPhys(pf, fx.pan, pt.pan)), Tilt: r(toPhys(tf, fx.tilt, pt.tilt)) }
}

module.exports = { features, aimValues }
