'use strict'

/**
 * WO-615 T3/T4 — a patch entry with a GDTF type (`typeId` + `mode`, gdtf-store.js) and the DMX it writes. Pure.
 *
 *   applyType(fx, mode)  derives what the follow engine already understands from the mode: pan / tilt
 *                        { ch, fine, range = |PhysicalTo − PhysicalFrom|, invert = the patch's flip XOR a falling
 *                        range (Robin tilt 135 → −135) } — so the IK, the calibration jog and the WO-632 read-through
 *                        work unchanged — and `gdtf.channels` (break 1, with a DMX slot) for writeGdtf.
 *   writeGdtf(buf, fx, values)  every channel at its value, else its GDTF default (no channel of a typed
 *                        fixture is left at an arbitrary 0 — the file's default is what goes out).
 *
 * Programmer values (`values`, the engine's per-fixture map), keyed "Attribute" (every geometry) or
 * "Geometry/Attribute" (one pixel / cell; wins). A value is a physical number (degrees, 0–1 dimmer, …: mapped
 * linearly over the function's PhysicalFrom…To onto its DMX from…to), { norm: 0–1 } (fraction of the function's
 * DMX range), { dmx: n } (raw at the channel's resolution) or { set: "Red" } (a channel set's DMX start).
 * The key's attribute picks the function, so "Color1WheelSpin" on a colour wheel channel selects the spin range.
 * Mode masters are not enforced (a dependent function is written whatever its master channel holds).
 * Channels on DMX breaks > 1 are not output yet (a second patch line would carry them).
 */

const DMX_PROTOCOLS = ['artnet', 'sacn']

function pickAxis(channels, attribute) {
	for (const c of channels) {
		const f = c.functions[c.initial] || c.functions[0]
		if (f && f.attribute === attribute) return { c, f }
	}
	return null
}

/** Derive pan / tilt and the channel list from a resolved GDTF mode (mutates and returns fx). */
function applyType(fx, mode) {
	const channels = mode.channels.filter((c) => c.break === 1 && c.offsets.length)
	fx.gdtf = { footprint: mode.footprint, channels, skipped: mode.channels.filter((c) => c.break !== 1).length }
	const pan = pickAxis(channels, 'Pan')
	const tilt = pickAxis(channels, 'Tilt')
	fx.moving = Boolean(pan && tilt)
	for (const [k, hit] of [['pan', pan], ['tilt', tilt]]) {
		if (!hit) continue
		const { c, f } = hit
		fx[k] = { ch: c.offsets[0], fine: c.offsets[1] || 0, range: Math.max(1, Math.abs(f.physTo - f.physFrom)),
			invert: fx[k].invert !== f.physTo < f.physFrom }
	}
	return fx
}

/** Offsets (1-based, within the fixture) a typed fixture writes. */
function gdtfFootprint(fx) {
	const out = new Set()
	for (const c of fx.gdtf.channels) for (const o of c.offsets) out.add(o)
	return [...out].sort((a, b) => a - b)
}

/** The value and function the programmer set for channel c, or null. */
function valueFor(values, c) {
	if (!values) return null
	for (const key of [`${c.geometry}/`, '']) {
		for (const f of c.functions) {
			const v = values[key + f.attribute]
			if (v !== undefined && v !== null) return { f, v }
		}
	}
	return null
}

/** One value → a DMX number at the channel's resolution (clamped to the function's range). */
function encodeValue(c, f, v) {
	const max = 256 ** c.res - 1
	const lo = Math.min(f.from, f.to)
	const hi = Math.max(f.from, f.to)
	const clamp = (n) => Math.max(lo, Math.min(hi, Math.round(n)))
	if (typeof v === 'number') {
		if (!Number.isFinite(v)) return c.default
		const span = f.physTo - f.physFrom
		const t = span === 0 ? 0 : Math.max(0, Math.min(1, (v - f.physFrom) / span))
		return clamp(f.from + t * (f.to - f.from))
	}
	if (v && typeof v === 'object') {
		if (Number.isFinite(v.dmx)) return Math.max(0, Math.min(max, Math.round(v.dmx)))
		if (Number.isFinite(v.norm)) return clamp(f.from + Math.max(0, Math.min(1, v.norm)) * (f.to - f.from))
		if (typeof v.set === 'string') {
			const s = f.sets.find((x) => x.name === v.set)
			if (s) return s.from
		}
	}
	return c.default
}

/** Big-endian across the channel's offsets (coarse first). */
function putChannel(buf, base, c, dmx) {
	const n = c.offsets.length
	for (let i = 0; i < n; i++) {
		const at = base + c.offsets[i] - 1
		if (at >= 0 && at < 512) buf[at] = Math.floor(dmx / 256 ** (n - 1 - i)) & 0xff
	}
}

/**
 * Write a typed fixture: every channel at its GDTF default, then the programmed ones — two passes, so where a file
 * puts two channels on one offset (Elation Pulse Panel 60CH @12) a programmed value beats its twin's default.
 */
function writeGdtf(buf, fx, values) {
	const base = fx.address - 1
	const hits = []
	for (const c of fx.gdtf.channels) {
		const hit = valueFor(values, c)
		if (hit) hits.push([c, hit])
		else putChannel(buf, base, c, c.default ?? 0)
	}
	for (const [c, hit] of hits) putChannel(buf, base, c, encodeValue(c, hit.f, hit.v))
}

/** A programmer value as stored: finite number, or { dmx | norm: finite } / { set: string }; else undefined. */
function cleanValue(v) {
	if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
	if (!v || typeof v !== 'object') return v === null ? null : undefined
	if (Number.isFinite(v.dmx)) return { dmx: v.dmx }
	if (Number.isFinite(v.norm)) return { norm: v.norm }
	if (typeof v.set === 'string' && v.set) return { set: v.set.slice(0, 64) }
	return undefined
}

/**
 * fixtures.dmx → { enabled (master, default off), priority (sACN 0–200, default 100), universes: Set "protocol:n" }.
 * Only listed universes of typed fixtures are ever transmitted.
 */
function normalizeDmx(raw) {
	const o = raw && typeof raw === 'object' ? raw : {}
	const p = Number(o.priority)
	const list = Array.isArray(o.universes) ? o.universes : []
	const universes = new Set()
	for (const u of list) {
		const m = /^(artnet|sacn):(\d{1,5})$/.exec(String(u))
		if (m && (m[1] === 'artnet' ? Number(m[2]) <= 32767 : Number(m[2]) >= 1 && Number(m[2]) <= 63999)) universes.add(`${m[1]}:${Number(m[2])}`)
	}
	const port = Number(o.sacn_port)
	return { enabled: o.enabled === true, priority: Number.isFinite(p) ? Math.max(0, Math.min(200, Math.round(p))) : 100, universes,
		visualise: o.visualise === true, // T7: the console's input drives the previs; typed universes are never sent
		sacn_port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 5568 }
}

module.exports = { DMX_PROTOCOLS, applyType, gdtfFootprint, valueFor, encodeValue, writeGdtf, cleanValue, normalizeDmx }
