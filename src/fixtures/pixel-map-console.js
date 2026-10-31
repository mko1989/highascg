'use strict'

/**
 * WO-916 — the pixel map's own output to the lighting console (`pixelMapSettings.console`): the mapped pixels' colours,
 * nothing else, sent after every sample whenever mappings are configured — independent of the DMX master that drives
 * the fixtures from this box. The LD merges them into the patch (or not) on the console.
 *
 *   console: { enabled (default true), protocol "artnet" | "sacn", dest "a.b.c.d[:port]" ("" = sACN multicast;
 *              Art-Net needs an address — a broadcast lands on this box's own lighting input),
 *              layout "fixture" | "block", universe (the block's first universe) }
 *   fixture: each mapping at its fixture's own universe + slots (writePixel: the head's colour channels, RGBW / CMY /
 *            16-bit as the head wants them); every other slot 0.
 *   block:   3 slots R G B per mapping, BLOCK_PIXELS per universe from `universe` on, ordered by fixture (universe,
 *            address, id) then pixel — `placeOf()` tells the LD which pixel sits where.
 * One packet per universe when its bytes changed, else a REFRESH_MS refresh. Pure apart from the injected send.
 */

const { encodeArtDmx, parseDest, MAX_PORT_ADDRESS } = require('./artdmx')
const { encodeE131, sacnDest, boxCid, MAX_UNIVERSE } = require('./sacn')
const { writePixel } = require('./pixel-map-model')

const PROTOCOLS = ['artnet', 'sacn']
const LAYOUTS = ['fixture', 'block']
const BLOCK_PIXELS = 170
const REFRESH_MS = 1000
const DEFAULTS = Object.freeze({ enabled: true, protocol: 'artnet', dest: '', layout: 'fixture', universe: 1 })

const maxUniverse = (protocol) => (protocol === 'sacn' ? MAX_UNIVERSE : MAX_PORT_ADDRESS)
const minUniverse = (protocol) => (protocol === 'sacn' ? 1 : 0)

/** Stored / loaded → a complete console block (junk → the default of that field). */
function normalizeConsole(raw) {
	const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
	const protocol = PROTOCOLS.includes(c.protocol) ? c.protocol : DEFAULTS.protocol
	const u = Number(c.universe)
	return {
		enabled: typeof c.enabled === 'boolean' ? c.enabled : DEFAULTS.enabled,
		protocol,
		dest: typeof c.dest === 'string' && parseDest(c.dest) ? c.dest.trim() : '',
		layout: LAYOUTS.includes(c.layout) ? c.layout : DEFAULTS.layout,
		universe: Number.isInteger(u) && u >= minUniverse(protocol) && u <= maxUniverse(protocol) ? u : DEFAULTS.universe,
	}
}

/** Strict check of a POSTed console block; omitted fields keep `current`. → { ok, console } | { ok: false, error } */
function validateConsole(raw, current = DEFAULTS) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'console must be an object' }
	const next = { ...current, ...raw }
	if (typeof next.enabled !== 'boolean') return { ok: false, error: 'console.enabled must be true or false' }
	if (!PROTOCOLS.includes(next.protocol)) return { ok: false, error: `console.protocol must be ${PROTOCOLS.join(' or ')}` }
	if (typeof next.dest !== 'string' || (next.dest.trim() && !parseDest(next.dest))) return { ok: false, error: 'console.dest must be an IPv4 address (a.b.c.d or a.b.c.d:port) or empty' }
	if (!LAYOUTS.includes(next.layout)) return { ok: false, error: `console.layout must be ${LAYOUTS.join(' or ')}` }
	const u = Number(next.universe)
	const lo = minUniverse(next.protocol)
	const hi = maxUniverse(next.protocol)
	if (!Number.isInteger(u) || u < lo || u > hi) return { ok: false, error: `console.universe must be a whole number ${lo}…${hi}` }
	return { ok: true, console: { enabled: next.enabled, protocol: next.protocol, dest: next.dest.trim(), layout: next.layout, universe: u } }
}

const isDefaultConsole = (c) => Object.keys(DEFAULTS).every((k) => c[k] === DEFAULTS[k])

/** Where each mapping goes: entries = [{ r (resolved mapping), universe, slots? }] for the layout; block order is stable. */
function placesOf(list, c) {
	const live = list.filter((r) => r.m.enabled && !r.problem && r.fx && r.px)
	if (c.layout === 'fixture') return live.map((r) => ({ r, universe: r.fx.universe }))
	const sorted = [...live].sort((a, b) => a.fx.universe - b.fx.universe || a.fx.address - b.fx.address
		|| String(a.fx.id).localeCompare(String(b.fx.id)) || a.m.pixel - b.m.pixel)
	return sorted.map((r, i) => {
		const k = i % BLOCK_PIXELS
		return { r, universe: c.universe + Math.floor(i / BLOCK_PIXELS), slots: [3 * k + 1, 3 * k + 2, 3 * k + 3] }
	})
}

/**
 * @param {{ send: (to: { host: string, port: number }, packet: Buffer) => void,
 *   isSelfLoop?: (to: object, universe: number, protocol: string) => boolean }} deps
 */
function createConsoleOutput({ send, isSelfLoop = () => false }) {
	const cid = boxCid(`${require('os').hostname()}:pixelmap`) // a source of its own next to the follow engine's sACN
	let cfg = normalizeConsole(null)
	let places = []
	let placeById = new Map()
	let placesFor = null
	const unis = new Map() // universe → { buf, last, at, seq, packets, to, problem }
	const stats = { packets: 0 }

	function configure(next) {
		const c = normalizeConsole(next)
		if (JSON.stringify(c) === JSON.stringify(cfg)) return
		cfg = c
		placesFor = null
		unis.clear()
	}

	function destOf(universe) {
		if (cfg.protocol === 'sacn') return sacnDest(cfg.dest, universe)
		return cfg.dest ? parseDest(cfg.dest) : null
	}

	function universeOf(n) {
		let u = unis.get(n)
		if (u) return u
		const to = destOf(n)
		const lo = minUniverse(cfg.protocol)
		const problem = n < lo || n > maxUniverse(cfg.protocol) ? `universe ${n} is outside ${cfg.protocol === 'sacn' ? 'sACN' : 'Art-Net'} ${lo}…${maxUniverse(cfg.protocol)}`
			: !to ? 'no console address'
				: isSelfLoop(to, n, cfg.protocol) ? `would loop into this box's own ${cfg.protocol === 'sacn' ? 'sACN' : 'Art-Net'} input`
					: null
		u = { buf: new Uint8Array(512), last: null, at: 0, seq: 0, packets: 0, to, problem }
		unis.set(n, u)
		return u
	}

	/** Build every universe from the resolved list + colourOf(id) → [r, g, b] | null, send the changed / due ones. */
	function frame(list, colourOf, t) {
		if (placesFor !== list) {
			places = placesOf(list, cfg)
			placeById = new Map(places.map((p) => [p.r.m.id, p]))
			placesFor = list
			unis.clear()
		}
		if (!cfg.enabled) return 0
		if (!unis.size) for (const p of places) universeOf(p.universe)
		for (const u of unis.values()) u.buf.fill(0)
		for (const p of places) {
			const rgb = colourOf(p.r.m.id) || [0, 0, 0]
			const u = unis.get(p.universe)
			if (cfg.layout === 'fixture') writePixel(u.buf, p.r.fx, p.r.px, rgb, p.r.m.colourOrder)
			else p.slots.forEach((s, i) => (u.buf[s - 1] = Math.max(0, Math.min(255, Math.round(rgb[i])))))
		}
		let sent = 0
		for (const [n, u] of unis) {
			if (u.problem) continue
			const same = u.last && u.last.equals(u.buf)
			if (same && t - u.at < REFRESH_MS) continue
			u.seq = (u.seq % 255) + 1
			send(u.to, cfg.protocol === 'sacn'
				? encodeE131({ universe: n, sequence: u.seq, cid, sourceName: 'HighAsCG pixel map', data: u.buf })
				: encodeArtDmx({ portAddress: n, sequence: u.seq, data: u.buf }))
			u.last = Buffer.from(u.buf)
			u.at = t
			u.packets++
			stats.packets++
			sent++
		}
		return sent
	}

	/** Mapping id → { universe, slots } on the console (block: its R G B slots; fixture: the head's own, from /live). */
	function placeOf(id) {
		const p = placeById.get(id)
		return p ? { universe: p.universe, ...(p.slots ? { slots: p.slots } : {}) } : null
	}

	function status(t) {
		return { ...cfg, packets: stats.packets, universes: [...unis.entries()].sort((a, b) => a[0] - b[0]).map(([n, u]) => ({
			universe: n, dest: u.to ? `${u.to.host}:${u.to.port}` : null, problem: u.problem, packets: u.packets,
			last_sent_ms_ago: u.at ? t - u.at : null })) }
	}

	return { configure, frame, placeOf, status, settings: () => cfg }
}

module.exports = { DEFAULTS, REFRESH_MS, normalizeConsole, validateConsole, isDefaultConsole, placesOf, createConsoleOutput }
