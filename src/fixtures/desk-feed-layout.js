'use strict'

/**
 * WO-1097 — the "desk feed" layout (pure): which channels of which feed universe carry each fed head's pan / tilt /
 * dimmer, and the channel table the LD patches from (CSV + GET /api/tracking/follow/feed.csv).
 *
 *   project.fixtures.feed: { enabled (false), protocol "artnet" | "sacn", universe (the first feed universe),
 *     dest (the desk: "a.b.c.d[:port]"; sACN "" = the universe's multicast group), priority (sACN 1–200, 100),
 *     layout "mirror" | "compact", address (compact: the first channel, 1–512) }
 *
 * Mirror — every fed head's pan, pan fine, tilt, tilt fine, dimmer (+ fine) at the SAME channel numbers as in its real
 *   patch; all other channels 0. One feed universe per rig universe that carries a fed head: rig universes in order
 *   (Art-Net before sACN, then by number) → feed universe, feed universe + 1, … A desk that merges an input universe
 *   channel-for-channel onto an output universe uses it as is.
 * Compact — COMPACT_CH channels per fed head from `address`, in patch order, one universe:
 *   +0 pan, +1 pan fine, +2 tilt, +3 tilt fine, +4 dimmer, +5 dimmer fine — the exact bytes the real head's channels
 *   get (its DMX scale, ranges and invert); an 8-bit channel has its fine at 0 — then +6 active (255 = HighAsCG aims
 *   it now, 0 = held / dark), +7 level (the spot level 0–255, independent of the head's dimmer curve).
 * Fed heads: moving heads (enabled, no patch problem) that follow a marker or Auto, in patch order, plus heads that
 * left while the feed ran ("parked": they keep their place, hold their last aim, dark) — so a head leaving never moves
 * another head's channels and never snaps to 0 / 0.
 */

const { parseDest, MAX_PORT_ADDRESS } = require('./artdmx')
const { sacnDest, MAX_UNIVERSE } = require('./sacn')

const LAYOUTS = ['mirror', 'compact']
const COMPACT_CH = 8
const COMPACT_ROLES = ['pan', 'pan fine', 'tilt', 'tilt fine', 'dimmer', 'dimmer fine', 'active', 'level']

const num = (v, d, lo, hi) => {
	const n = Number(v)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi))

/** project.fixtures.feed → every field valid (twin: godot/…/tracking/desk_feed_model.gd normalize). */
function normalizeFeed(raw) {
	const o = raw && typeof raw === 'object' ? raw : {}
	const sacn = o.protocol === 'sacn'
	return {
		enabled: o.enabled === true,
		protocol: sacn ? 'sacn' : 'artnet',
		universe: sacn ? int(o.universe, 200, 1, MAX_UNIVERSE) : int(o.universe, 200, 0, MAX_PORT_ADDRESS),
		dest: typeof o.dest === 'string' ? o.dest.trim().slice(0, 64) : '',
		priority: int(o.priority, 100, 1, 200),
		layout: LAYOUTS.includes(o.layout) ? o.layout : 'mirror',
		address: int(o.address, 1, 1, 512),
	}
}

/** The feed's destination: Art-Net needs the desk's address (never a broadcast); sACN "" = multicast. → { host, port } | null */
function feedDest(cfg, universe) {
	if (cfg.protocol === 'sacn') return sacnDest(cfg.dest, universe)
	if (!cfg.dest) return null
	const to = parseDest(cfg.dest)
	return to && !/^255\.|\.255$/.test(to.host) ? to : null
}

/** A typed head's Dimmer channel offsets (1-based in the head), [] when it has none (generic profile). */
function dimmerOffsets(fx) {
	for (const c of fx.gdtf?.channels || []) if (c.functions.some((f) => f.attribute === 'Dimmer')) return c.offsets.slice(0, 2)
	return []
}

/** The head's own channels the feed carries: [{ role, ch (1-based in the head) }]. */
function headChannels(fx) {
	const out = [{ role: 'pan', ch: fx.pan.ch }]
	if (fx.pan.fine) out.push({ role: 'pan fine', ch: fx.pan.fine })
	out.push({ role: 'tilt', ch: fx.tilt.ch })
	if (fx.tilt.fine) out.push({ role: 'tilt fine', ch: fx.tilt.fine })
	const d = dimmerOffsets(fx)
	if (d[0]) out.push({ role: 'dimmer', ch: d[0] })
	if (d[1]) out.push({ role: 'dimmer fine', ch: d[1] })
	return out
}

/** Heads the feed carries (see the header), in patch order. `parked`: ids that left while the feed ran. */
function feedHeads(fixtures, parked = new Set()) {
	return fixtures.filter((f) => f.moving && f.enabled && !f.problem && f.to && (f.follow > 0 || parked.has(f.id)))
}

const rigKey = (fx) => `${fx.protocol}:${fx.universe}`

/**
 * → { universes: [n…] (feed universe numbers in use), heads: [{ fx, slots: [{ role, ch, feedUniverse, feedCh }] }],
 *     overflow: [ids] (compact past channel 512) }. Pure: the channel table and the per-tick writer both read it.
 */
function buildLayout(heads, cfg) {
	const out = { universes: [], heads: [], overflow: [] }
	if (cfg.layout === 'compact') {
		heads.forEach((fx, i) => {
			const at = cfg.address + i * COMPACT_CH
			if (at + COMPACT_CH - 1 > 512) return void out.overflow.push(fx.id)
			const own = new Map(headChannels(fx).map((c) => [c.role, c.ch]))
			out.heads.push({ fx, slots: COMPACT_ROLES.map((role, k) => ({ role, ch: own.get(role) || 0, feedUniverse: cfg.universe, feedCh: at + k })) })
		})
		if (out.heads.length) out.universes.push(cfg.universe)
		return out
	}
	const keys = [...new Set(heads.map(rigKey))].sort((a, b) => {
		const [pa, ua] = a.split(':')
		const [pb, ub] = b.split(':')
		return pa !== pb ? (pa === 'artnet' ? -1 : 1) : Number(ua) - Number(ub)
	})
	const top = cfg.protocol === 'sacn' ? MAX_UNIVERSE : MAX_PORT_ADDRESS
	const uniOf = new Map(keys.map((k, i) => [k, cfg.universe + i]))
	for (const fx of heads) {
		const u = uniOf.get(rigKey(fx))
		if (u > top) {
			out.overflow.push(fx.id)
			continue
		}
		out.heads.push({ fx, slots: headChannels(fx).map((c) => ({ ...c, feedUniverse: u, feedCh: fx.address + c.ch - 1 })) })
	}
	out.universes = [...new Set(out.heads.map((h) => h.slots[0].feedUniverse))]
	return out
}

/** Why a feed universe may not be used (null = fine). `ctx`: { fixtures, levels, grant, reads, isSelfLoop, reachesSelf }. */
function refusal(cfg, universe, to, ctx) {
	if (!to) return cfg.protocol === 'artnet' && !cfg.dest ? 'set the desk\'s IP address (never a broadcast)' : `bad destination "${cfg.dest}"`
	const rig = ctx.fixtures.find((f) => f.protocol === cfg.protocol && f.universe === universe)
	if (rig) return `universe ${universe} is a rig output universe (${rig.name})`
	const L = ctx.levels
	if (L?.enabled && L.protocol === cfg.protocol && L.universe === universe) return `universe ${universe} is the automation levels universe`
	if (ctx.grant?.enabled && cfg.protocol === 'artnet' && ctx.grant.universe === universe) return `universe ${universe} is the LD grant universe`
	if (ctx.isSelfLoop(to, universe, cfg.protocol)) return "would loop into this box's own input"
	if (cfg.protocol === 'artnet' && ctx.reads.has(universe) && ctx.reachesSelf(to)) return `universe ${universe} is read back as a console input`
	return null
}

/** The LD's channel table rows (one per head and carried channel). */
function tableRows(layout, cfg) {
	const proto = cfg.protocol === 'sacn' ? 'sACN' : 'Art-Net'
	const rows = []
	for (const { fx, slots } of layout.heads) {
		for (const s of slots) {
			const ax = s.role.startsWith('pan') ? fx.pan : s.role.startsWith('tilt') ? fx.tilt : null
			const fine = slots.some((q) => q.role === `${s.role.split(' ')[0]} fine` && q.ch)
			rows.push({
				head: fx.name, fid: fx.fid || '', id: fx.id,
				rig: s.ch ? `${fx.protocol === 'sacn' ? 'sACN' : 'Art-Net'} ${fx.universe}.${fx.address + s.ch - 1}` : '',
				feed: `${proto} ${s.feedUniverse}.${s.feedCh}`, role: s.role,
				bits: s.role === 'active' || s.role === 'level' ? 8 : s.ch === 0 ? 0 : fine ? 16 : 8,
				range: ax && !s.role.endsWith('fine') ? `${ax.range}° ${ax.invert ? 'inverted' : 'normal'}` : '',
				note: s.role === 'active' ? '255 = HighAsCG aims it now' : s.role === 'level' ? 'spot level 0–255'
					: s.ch === 0 ? (s.role.startsWith('dimmer') && !s.role.endsWith('fine') ? 'no dimmer channel — use level' : 'unused (8-bit)') : '',
			})
		}
	}
	return rows
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))

/** The table as CSV (header + rows). */
function tableCsv(rows) {
	const cols = ['head', 'fid', 'role', 'rig', 'feed', 'bits', 'range', 'note']
	const head = ['Head', 'Fixture ID', 'Channel', 'Real patch (universe.address)', 'Feed (universe.address)', 'Bits', 'Range / invert', 'Note']
	return [head, ...rows.map((r) => cols.map((c) => r[c]))].map((l) => l.map(csvCell).join(',')).join('\n') + '\n'
}

module.exports = { normalizeFeed, feedDest, feedHeads, buildLayout, refusal, tableRows, tableCsv }
