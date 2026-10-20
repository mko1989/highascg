'use strict'

/**
 * WO-616 T11 / WO-615 T3 (first slice) — the follow patch in `project.fixtures` (a Godot-owned slice,
 * CLIENT_OWNED_SLICES): a manual generic moving-head profile per fixture (no GDTF yet — WO-615 T1). The Godot
 * twin is godot/client/features/previs/tracking/follow_model.gd; both normalize the same way.
 *
 *   fixtures: { output: { enabled: false,            ← master; nothing is transmitted while false
 *                         protocol: "psn" | "artnet", ← WO-631: PSN trackers to the console (default) or this box's
 *                                                       own pan/tilt over Art-Net (the backup)
 *                         psn: { group, port, iface, system_name, axes "stage" | "y_up" },
 *                         through: { enabled, offset, fade_s } },  ← WO-632 Art-Net read-through (backup only)
 *     patch: [{ id, name, enabled, protocol: "artnet", universe (Art-Net port-address 0–32767), address 1–512,
 *               dest "a.b.c.d[:port]", pan / tilt { ch (1-based offset), fine (0 = 8-bit), range °, invert },
 *               pose { x, y, z (PSN m), hang "truss" | "floor", yaw ° (0 = upstage, 90 = stage left) },
 *               fixed "ch=value, …" (shutter / dimmer / colour held open), follow (marker id, 0 = none),
 *               aim_z (m above the marker) }] }
 */

const { parseDest, MAX_PORT_ADDRESS } = require('./artdmx')
const { normalizeThrough } = require('./follow-through')

const DEFAULT_DEST = '255.255.255.255'
const PROTOCOLS = ['psn', 'artnet']
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

const num = (v, d, lo, hi) => {
	const n = Number(v)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi))

function axis(a, ch, fine, range) {
	const o = a && typeof a === 'object' ? a : {}
	return { ch: int(o.ch, ch, 1, 512), fine: int(o.fine, fine, 0, 512), range: num(o.range, range, 1, 1080),
		invert: o.invert === true }
}

/** "6=255, 7 = 8" → [{ ch: 6, value: 255 }, …] (1-based offsets, later duplicates win; junk skipped). */
function parseFixed(text) {
	const out = new Map()
	for (const part of String(text ?? '').split(/[,;\s]+/)) {
		const m = /^(\d{1,3})=(\d{1,3})$/.exec(part.trim())
		if (!m) continue
		const ch = Number(m[1])
		if (ch >= 1 && ch <= 512) out.set(ch, Math.min(255, Number(m[2])))
	}
	return [...out].map(([ch, value]) => ({ ch, value }))
}

function normalizeFixture(f, i) {
	const o = f && typeof f === 'object' ? f : {}
	const pose = o.pose && typeof o.pose === 'object' ? o.pose : {}
	return {
		id: String(o.id || `fx${i + 1}`),
		name: String(o.name || `Fixture ${i + 1}`),
		enabled: o.enabled !== false,
		protocol: 'artnet',
		universe: int(o.universe, 0, 0, MAX_PORT_ADDRESS),
		address: int(o.address, 1, 1, 512),
		dest: typeof o.dest === 'string' && o.dest.trim() ? o.dest.trim() : DEFAULT_DEST,
		pan: axis(o.pan, 1, 2, 540),
		tilt: axis(o.tilt, 3, 4, 270),
		pose: { x: num(pose.x, 0, -500, 500), y: num(pose.y, 0, -500, 500), z: num(pose.z, 6, -50, 200),
			hang: pose.hang === 'floor' ? 'floor' : 'truss', yaw: num(pose.yaw, 0, -360, 360) },
		fixed: String(o.fixed ?? ''),
		follow: int(o.follow, 0, 0, 65535),
		aim_z: num(o.aim_z, 1, -5, 10),
	}
}

/** Channel offsets (1-based, within the fixture) the profile writes. */
function footprint(fx) {
	const chs = [fx.pan.ch, fx.tilt.ch]
	if (fx.pan.fine) chs.push(fx.pan.fine)
	if (fx.tilt.fine) chs.push(fx.tilt.fine)
	for (const c of parseFixed(fx.fixed)) chs.push(c.ch)
	return [...new Set(chs)].sort((a, b) => a - b)
}

/** output.psn → { group (a 224–239 multicast address), port, iface ('' = OS default, else an IPv4), system_name, axes }. */
function normalizePsn(raw) {
	const o = raw && typeof raw === 'object' ? raw : {}
	const g = String(o.group ?? '').trim()
	const first = Number(g.split('.')[0])
	const iface = String(o.iface ?? '').trim()
	return {
		group: IPV4.test(g) && first >= 224 && first <= 239 ? g : '236.10.10.10',
		port: int(o.port, 56565, 1, 65535),
		iface: IPV4.test(iface) ? iface : '',
		system_name: String(o.system_name ?? '').trim().slice(0, 64) || 'HighAsCG',
		axes: o.axes === 'y_up' ? 'y_up' : 'stage',
	}
}

/**
 * project.fixtures → { enabled, protocol, psn, fixtures: [{ …fixture, to, slots: [abs 0-based], problem }] }. A fixture with a
 * problem (bad dest, past channel 512, overlaps an earlier fixture on the same universe) is never output.
 */
function normalizePatch(slice) {
	const s = slice && typeof slice === 'object' ? slice : {}
	const list = Array.isArray(s.patch) ? s.patch : []
	const seen = new Set()
	const used = new Map() // "host:port|universe" → Map(slot → fixture name)
	const fixtures = list.map((raw, i) => {
		const fx = normalizeFixture(raw, i)
		while (seen.has(fx.id)) fx.id += '_'
		seen.add(fx.id)
		fx.to = parseDest(fx.dest)
		fx.slots = footprint(fx).map((c) => fx.address - 1 + c - 1)
		fx.problem = null
		if (!fx.to) fx.problem = `bad destination "${fx.dest}"`
		else if (fx.slots.some((x) => x > 511)) fx.problem = 'footprint runs past channel 512'
		else if (fx.enabled) {
			const key = `${fx.to.host}:${fx.to.port}|${fx.universe}`
			const u = used.get(key) || new Map()
			const hit = fx.slots.find((x) => u.has(x))
			if (hit !== undefined) fx.problem = `channel ${hit + 1} already used by ${u.get(hit)}`
			else for (const x of fx.slots) u.set(x, fx.name)
			used.set(key, u)
		}
		return fx
	})
	const protocol = PROTOCOLS.includes(s.output?.protocol) ? s.output.protocol : 'psn'
	return { enabled: s.output?.enabled === true, protocol, psn: normalizePsn(s.output?.psn),
		through: normalizeThrough(s.output?.through), fixtures }
}

module.exports = { DEFAULT_DEST, PROTOCOLS, normalizePsn, normalizeFixture, normalizePatch, parseFixed, footprint }
