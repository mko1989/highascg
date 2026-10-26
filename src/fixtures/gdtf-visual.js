'use strict'

/**
 * WO-615 T5 — DMX → what the previs shows of a GDTF fixture: axis angles and, per beam, intensity / colour / zoom /
 * gobo. Shared by our own output (T5) and incoming DMX (T7 visualiser mode).
 *
 *   compileVisual(type, mode, rig)  once per type + mode: every beam's scope = the channels on the beam or one of its
 *                                   ancestors in the rig (gdtf-rig.js), nearest geometry first.
 *   decodeVisual(plan, buf, address, offset?) → { axes: { nodeId: degrees (+ the patch's pan / tilt offset, or
 *                                   offset(pan, tilt) — WO-700 R7) }, beams: { nodeId: { i 0–1, c [r, g, b] 0–1 sRGB,
 *                                   zoom degrees, gobo? "wheel/slot media" } } }
 *
 * A channel's live function is the one whose DMX range holds the value and whose mode master (another channel of the
 * mode, by name) holds a value in ModeFrom…ModeTo. Intensity = the dimmers in scope multiplied (a pixel's own dimmer
 * × the bar master), 0 while a Shutter channel sits on a "Closed" set or
 * function; strobes read as open. Colour = additive emitters summed (ColorAdd_*, normalised so the brightest
 * component is 1, its level folded into intensity), else white, then filtered by subtractive CMY and colour-wheel
 * slots (CIE xyY → sRGB chromaticity). A beam with no channel in scope stays dark. Zoom = the Zoom function's physical angle, else the beam's BeamAngle. Pure.
 *
 * WO-784: a virtual channel (Offset="", no DMX slot) is left out of every scope. It is the console's own value, folded
 * into the real channels before they are sent; the wire never carries it. Reading its default kept the MAC Aura PXL,
 * ELP CL, Pixel Strobe and X-DOT dark (virtual dimmers default 0) and whitened the ACME Pixel Line (virtual W at 255).
 */

const ADD = {
	ColorAdd_R: [1, 0, 0], ColorAdd_G: [0, 1, 0], ColorAdd_B: [0, 0, 1], ColorAdd_W: [1, 1, 1], ColorAdd_WW: [1, 0.85, 0.65],
	ColorAdd_CW: [0.9, 0.95, 1], ColorAdd_A: [1, 0.7, 0], ColorAdd_RY: [1, 0.5, 0], ColorAdd_GY: [0.6, 1, 0],
	ColorAdd_Lime: [0.7, 1, 0], ColorAdd_C: [0, 1, 1], ColorAdd_M: [1, 0, 1], ColorAdd_Y: [1, 1, 0], ColorAdd_UV: [0.35, 0, 0.7],
	ColorAdd_BY: [0, 0.6, 1], ColorAdd_GC: [0, 1, 0.6], ColorAdd_RM: [1, 0, 0.5], ColorAdd_BM: [0.5, 0, 1],
	ColorRGB_Red: [1, 0, 0], ColorRGB_Green: [0, 1, 0], ColorRGB_Blue: [0, 0, 1],
}
const SUB = { ColorSub_C: [0, 1, 1], ColorSub_M: [1, 0, 1], ColorSub_Y: [1, 1, 0], ColorSub_R: [1, 0, 0],
	ColorSub_G: [0, 1, 0], ColorSub_B: [0, 0, 1] }

const r3 = (v) => Math.round(v * 1000) / 1000

/** CIE xy (Y ignored: a filter's transmission is not its hue) → sRGB, brightest component 1. */
function cieToRgb([x, y]) {
	if (!(y > 0)) return [1, 1, 1]
	const X = x / y
	const Z = (1 - x - y) / y
	const lin = [3.2406 * X - 1.5372 - 0.4986 * Z, -0.9689 * X + 1.8758 + 0.0415 * Z, 0.0557 * X - 0.204 + 1.057 * Z]
		.map((v) => Math.max(0, v))
	const max = Math.max(...lin) || 1
	return lin.map((v) => {
		const n = v / max
		return n <= 0.0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - 0.055
	})
}

/** @param {object} type gdtf-parse.js result @param {object} mode @param {{ nodes }} rig gdtf-rig.js */
function compileVisual(type, mode, rig) {
	const byGeom = new Map()
	for (const c of mode.channels) {
		if (!c.offsets.length) continue // WO-784: virtual — not on the wire
		if (!byGeom.has(c.geometry)) byGeom.set(c.geometry, [])
		byGeom.get(c.geometry).push(c)
	}
	const axes = mode.channels.filter((c) => c.functions.some((f) => f.attribute === 'Pan' || f.attribute === 'Tilt'))
	const beams = []
	rig.nodes.forEach((n, i) => {
		if (n.kind !== 'Beam') return
		const scope = []
		for (let at = i; at >= 0; at = rig.nodes[at].parent) scope.push(...(byGeom.get(rig.nodes[at].id) || []))
		beams.push({ id: n.id, angle: n.beam?.beamAngle ?? 25, scope })
	})
	return { channels: mode.channels, axes, beams, wheels: type.wheels || {} }
}

/** Raw DMX of channel c (big-endian over its offsets; virtual = its default). */
function raw(c, buf, base) {
	if (!c.offsets.length) return c.default ?? 0
	let v = 0
	for (const o of c.offsets) v = v * 256 + (buf[base + o - 1] ?? 0)
	return v
}

function liveFunction(c, v, masterValue) {
	for (const f of c.functions) {
		if (v < f.from || v > f.to) continue
		if (f.modeMaster) {
			const m = masterValue(f.modeMaster)
			if (m == null || m < f.modeFrom || m > f.modeTo) continue
		}
		return f
	}
	return null
}

const frac = (f, v) => (f.to > f.from ? (v - f.from) / (f.to - f.from) : 1)
const phys = (f, v) => f.physFrom + frac(f, v) * (f.physTo - f.physFrom)
const activeSet = (f, v) => f.sets.find((s) => v >= s.from && v <= s.to) || null

function decodeVisual(plan, buf, address = 1, offset = null) {
	const base = address - 1
	const cache = new Map()
	const read = (c) => {
		if (!cache.has(c)) cache.set(c, raw(c, buf, base))
		return cache.get(c)
	}
	const byName = new Map(plan.channels.map((c) => [c.name, c]))
	const masterValue = (name) => (byName.has(name) ? read(byName.get(name)) : null)
	const live = (c) => {
		const v = read(c)
		return { v, f: liveFunction(c, v, masterValue) }
	}
	const axes = {}
	const angles = []
	for (const c of plan.axes) {
		const { v, f } = live(c)
		if (f && (f.attribute === 'Pan' || f.attribute === 'Tilt')) angles.push({ c, a: f.attribute, deg: phys(f, v) })
	}
	// WO-700 R3 / R7: the head's calibrated offset — the previs turns it where the real one points. A function gets
	// the head's physical (pan, tilt) (beam-offset.js offsetAt: trim + pinned marks); an object is a constant.
	const at = (a) => angles.find((x) => x.a === a)?.deg ?? 0
	const off = typeof offset === 'function' ? offset(at('Pan'), at('Tilt')) : offset
	for (const { c, a, deg } of angles) axes[c.geometry] = r3(deg + Number((a === 'Pan' ? off?.pan : off?.tilt) || 0))
	const beams = {}
	for (const b of plan.beams) {
		let dim = 1
		let open = true
		let add = null
		const seen = new Set()
		let filter = [1, 1, 1]
		let zoom = null
		let gobo = ''
		for (const c of b.scope) {
			const { v, f } = live(c)
			if (!f) continue
			const a = f.attribute
			if (a === 'Dimmer') dim *= Math.max(0, Math.min(1, frac(f, v)))
			else if (/^Shutter\d*$/.test(a)) {
				const s = activeSet(f, v)
				if (/clos/i.test(s?.name || '') || /^clos/i.test(f.name)) open = false
			} else if (ADD[a] && !seen.has(a)) {
				seen.add(a) // nearest geometry wins (scope is beam-first)
				const k = Math.max(0, Math.min(1, frac(f, v)))
				add = (add || [0, 0, 0]).map((x, i) => x + k * ADD[a][i])
			} else if (SUB[a] && !seen.has(a)) {
				seen.add(a)
				const k = Math.max(0, Math.min(1, frac(f, v)))
				filter = filter.map((x, i) => x * (1 - k * (1 - SUB[a][i])))
			} else if (f.wheel && /^(Color|Gobo)\d+$/.test(a)) {
				const slot = plan.wheels[f.wheel]?.[(activeSet(f, v)?.slot || 0) - 1]
				if (slot?.color && a.startsWith('Color')) filter = filter.map((x, i) => x * cieToRgb(slot.color)[i])
				if (slot?.media && a.startsWith('Gobo') && !gobo) gobo = `${f.wheel}/${slot.media}` // first wheel in scope
			} else if (a === 'Zoom' && zoom == null) zoom = phys(f, v)
		}
		let c = filter
		let level = 1
		if (add) {
			const max = Math.max(...add)
			level = Math.min(1, max)
			c = max > 0 ? add.map((x, i) => (x / max) * filter[i]) : [0, 0, 0]
		}
		// A beam no channel of the mode reaches is not lit by it (Pulse Panel 3CH: only the CW cells are patched).
		const out = { i: r3(open && b.scope.length ? dim * level : 0), c: c.map(r3), zoom: r3(zoom ?? b.angle) }
		if (gobo) out.gobo = gobo
		beams[b.id] = out
	}
	return { axes, beams }
}

module.exports = { compileVisual, decodeVisual, cieToRgb }
