'use strict'

/**
 * WO-615 T8 — looks carry fixture states: `project.fixtures.looks = { <lookId>: { values: { <fixtureId>: { key:
 * value } } } }` (the programmer at Store time, same value shapes as POST /api/fixtures/program). It lives in the
 * fixtures slice, not on the look: web migrateScene whitelists look keys, and `fixtures` is a client-owned slice.
 *
 * A PGM TAKE of a look with an entry recalls it: the programmer becomes the stored state (fixtures it does not list
 * are released) and the output crossfades in DMX space over the look's transition. Continuous channels (dimmer,
 * pan / tilt, colour mixing, CTO, zoom…) fade; a channel whose value changes channel function, sits on a wheel
 * (colour / gobo selection) or is a discrete family (shutter, control, prism, macros, modes) snaps at the start.
 */

const MAX_LOOKS = 1000
const DISCRETE = /^(Shutter|Strobe|Control|Prism|Effects|Fixture|Lamp|Reset|Dummy|NoFeature)|Macro|Mode/i

/** fixtures.looks → { lookId: { values: { fixtureId: { key: cleaned value } } } } (entries without values dropped). */
function normalizeLooks(raw, cleanValue) {
	const out = {}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
	for (const [id, entry] of Object.entries(raw).slice(0, MAX_LOOKS)) {
		const vals = entry && typeof entry === 'object' ? entry.values : null
		if (!vals || typeof vals !== 'object' || Array.isArray(vals)) continue
		const values = {}
		for (const [fx, map] of Object.entries(vals).slice(0, 4096)) {
			if (!map || typeof map !== 'object' || Array.isArray(map)) continue
			const m = {}
			for (const [k, v] of Object.entries(map).slice(0, 512)) {
				const c = cleanValue(v)
				if (c !== undefined && c !== null) m[String(k).slice(0, 160)] = c
			}
			if (Object.keys(m).length) values[String(fx).slice(0, 128)] = m
		}
		out[String(id).slice(0, 128)] = { values }
	}
	return out
}

function readChannel(buf, base, c) {
	let v = 0
	for (const o of c.offsets) {
		const at = base + o - 1
		v = v * 256 + (at >= 0 && at < 512 ? buf[at] : 0)
	}
	return v
}

function writeChannel(buf, base, c, dmx) {
	const n = c.offsets.length
	for (let i = 0; i < n; i++) {
		const at = base + c.offsets[i] - 1
		if (at >= 0 && at < 512) buf[at] = Math.floor(dmx / 256 ** (n - 1 - i)) & 0xff
	}
}

/** fx's channel values (DMX, at each channel's resolution) as they stand in `buf` — the fade's start. */
function snapshotChannels(fx, buf) {
	return fx.gdtf.channels.map((c) => (c.offsets.length ? readChannel(buf, fx.address - 1, c) : 0))
}

function functionAt(c, v) {
	return c.functions.findIndex((f) => v >= Math.min(f.from, f.to) && v <= Math.max(f.from, f.to))
}

/** Whether channel c may fade from DMX a to b (same function, not a wheel, not a discrete family). */
function fades(c, a, b) {
	const i = functionAt(c, a)
	const f = c.functions[i]
	return i >= 0 && i === functionAt(c, b) && !f.wheel && !DISCRETE.test(f.attribute)
}

/** Overwrite fx's fading channels in `buf` (which holds the target frame) with from → target at k (0…1). */
function blendChannels(buf, fx, from, k) {
	const base = fx.address - 1
	fx.gdtf.channels.forEach((c, i) => {
		if (!c.offsets.length || from[i] === undefined) return
		const to = readChannel(buf, base, c)
		if (to !== from[i] && fades(c, from[i], to)) writeChannel(buf, base, c, Math.round(from[i] + (to - from[i]) * k))
	})
}

/** The engine's programmer becomes `entry` (typed fixtures it does not list are released), crossfading over ms. */
function recallInto(engine, entry, ms) {
	const typed = engine.fixtures.filter((f) => f.gdtf).map((f) => f.id)
	engine.fade(typed, ms)
	engine.clearProgram(typed)
	for (const [id, vals] of Object.entries(entry.values)) engine.program([id], vals, { replace: true })
	return { fixtures: Object.keys(entry.values).length, fade_ms: Math.max(0, Math.round(ms)) }
}

module.exports = { normalizeLooks, snapshotChannels, blendChannels, fades, recallInto }
