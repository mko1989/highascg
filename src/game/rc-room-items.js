'use strict'

/**
 * WO-1074 v2 — items in the room (contract §2.3 / §2.4; pure, clock / timers / RNG injected, no I/O): item boxes
 * (first claim wins, back 6 s later), the item a claimer gets (rolled by race position), the one held item per player,
 * `use` → a hazard (`slick` puddle 25 s, `rocket` ≤ 5 s) or a one-shot effect (`turbo`, `shield`, `pulse`), `hit` →
 * the hazard is gone + a `spin` effect for everyone. Hazards expire on the injected clock (one timer, only while a
 * hazard exists), at most 40 live (the oldest is dropped). Rate limits per player: ≤ 5 `use`, ≤ 10 `box`, ≤ 5 `hit`
 * per second; a claim / use must be near the player's own last reported car (8 m / 4 m; §3: × the scene's scale, so
 * 0.8 m / 0.4 m at 0.1 — set with the track). Nothing here is scored; it works the same in the lobby (free roam) and
 * in a race.
 */

const ITEMS = ['turbo', 'slick', 'rocket', 'pulse', 'shield']
const BOX_RESPAWN_MS = 6000
const HAZARD_MS = { slick: 25000, rocket: 5000 }
const MAX_HAZARDS = 40
const RATE = { use: 5, box: 10, hit: 5 } // per player per second
const BOX_REACH = 8 // a claim further than this (plan, m) from the claimer's last reported position is ignored
const USE_REACH = 4 // a `use` placed further than this (plan, m) from the user's last reported position is ignored
const BOUNDS_SLACK = 5

// Roll weights at the front (leader) and the back of the field; a position in between is interpolated.
const FRONT = { turbo: 0.15, slick: 0.4, rocket: 0.07, pulse: 0.03, shield: 0.35 }
const BACK = { turbo: 0.35, slick: 0.05, rocket: 0.3, pulse: 0.25, shield: 0.05 }

const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const r3 = (v) => Math.round(v * 1000) / 1000

/** Item weights for a position `f` (0 = leading … 1 = last; 0.5 when there is no race). */
function weights(f) {
	const out = {}
	for (const k of ITEMS) out[k] = FRONT[k] + (BACK[k] - FRONT[k]) * f
	return out
}

/** Roll an item for position `f` with `rng()` ∈ [0, 1). */
function rollItem(f, rng) {
	const w = weights(Math.max(0, Math.min(1, f)))
	const total = ITEMS.reduce((s, k) => s + w[k], 0)
	let x = rng() * total
	for (const k of ITEMS) {
		x -= w[k]
		if (x < 0) return k
	}
	return ITEMS[ITEMS.length - 1]
}

/** [x, y, z] finite and inside bounds + 5 m → rounded copy, else null. */
function cleanPoint(p, bounds) {
	if (!Array.isArray(p) || p.length !== 3 || !p.every(fin)) return null
	if (bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
		for (let k = 0; k < 3; k++) if (p[k] < bounds.min[k] - BOUNDS_SLACK || p[k] > bounds.max[k] + BOUNDS_SLACK) return null
	} else if (p.some((v) => Math.abs(v) > 1000)) return null
	return p.map(r3)
}

/**
 * deps: { now, timers, rng, toAll(msg), toPlayer(pid, msg), position(pid) → f (0 … 1) or null, carOf(pid) → [x, y, z, …]
 * or null, isPlayer(pid) }.
 */
function createRoomItems(deps) {
	const now = deps.now
	const T = deps.timers
	const rng = deps.rng || Math.random
	let track = null
	let bounds = null
	let scale = 1 // §3: the scene's scale (reach limits × scale)
	let boxIds = new Map() // id → { x, z }
	const taken = new Map() // box id → until
	const hazards = new Map() // hid → haz (insertion order = age)
	const held = new Map() // pid → item
	const rates = new Map() // pid → { use: [], box: [], hit: [] }
	let nextHid = 1
	let expiry = null

	function limited(pid, kind) {
		let r = rates.get(pid)
		if (!r) rates.set(pid, (r = { use: [], box: [], hit: [] }))
		const q = r[kind], t = now()
		while (q.length && t - q[0] >= 1000) q.shift()
		if (q.length >= RATE[kind]) return true
		q.push(t)
		return false
	}

	function schedule() {
		if (expiry) T.clearTimeout(expiry)
		expiry = null
		let next = Infinity
		for (const h of hazards.values()) next = Math.min(next, h.until)
		if (next < Infinity) expiry = T.setTimeout(expire, Math.max(0, next - now()))
	}

	function expire() {
		expiry = null
		const t = now()
		for (const [hid, h] of [...hazards]) {
			if (h.until <= t) {
				hazards.delete(hid)
				deps.toAll({ t: 'hazgone', hid, hit: null })
			}
		}
		schedule()
	}

	function box(pid, m) {
		if (!track || !Number.isInteger(m.id) || !boxIds.has(m.id) || limited(pid, 'box')) return
		const t = now()
		if ((taken.get(m.id) || 0) > t) return // someone was first
		const car = deps.carOf(pid)
		const b = boxIds.get(m.id)
		if (!car || Math.hypot(car[0] - b.x, car[2] - b.z) > BOX_REACH * scale) return
		const until = t + BOX_RESPAWN_MS
		taken.set(m.id, until)
		deps.toAll({ t: 'box', id: m.id, by: pid, until })
		if (held.has(pid)) return // one item at a time: the box is gone, nothing new
		const f = deps.position(pid)
		const item = rollItem(f == null ? 0.5 : f, rng)
		held.set(pid, item)
		deps.toPlayer(pid, { t: 'item', item })
	}

	function use(pid, m) {
		if (typeof m.item !== 'string' || held.get(pid) !== m.item || limited(pid, 'use')) return
		const p = cleanPoint(m.p, bounds)
		const car = deps.carOf(pid)
		if (!p || !fin(m.yaw) || !car || Math.hypot(car[0] - p[0], car[2] - p[2]) > USE_REACH * scale) return
		held.delete(pid)
		const ts = now()
		const yaw = r3(m.yaw)
		if (m.item === 'slick' || m.item === 'rocket') {
			const h = { hid: nextHid++, kind: m.item, by: pid, p, yaw, ts, until: ts + HAZARD_MS[m.item] }
			hazards.set(h.hid, h)
			while (hazards.size > MAX_HAZARDS) {
				const oldest = hazards.keys().next().value
				hazards.delete(oldest)
				deps.toAll({ t: 'hazgone', hid: oldest, hit: null })
			}
			deps.toAll({ t: 'haz', ...h })
			schedule()
			return
		}
		deps.toAll({ t: 'fx', id: pid, k: m.item, p, ts })
	}

	function hit(pid, m) {
		if (limited(pid, 'hit')) return
		const car = deps.carOf(pid)
		if (m.hid != null) {
			const h = Number.isInteger(m.hid) ? hazards.get(m.hid) : null
			if (!h) return // gone already (expired, or someone else ran into it first)
			hazards.delete(h.hid)
			deps.toAll({ t: 'hazgone', hid: h.hid, hit: pid })
			deps.toAll({ t: 'fx', id: pid, k: 'spin', p: car ? car.slice(0, 3) : h.p, ts: now() })
			schedule()
			return
		}
		if (m.item === 'pulse' && Number.isInteger(m.by) && m.by !== pid && deps.isPlayer(m.by)) {
			deps.toAll({ t: 'fx', id: pid, k: 'spin', p: car ? car.slice(0, 3) : null, ts: now() })
		}
	}

	/** Race start / end / a new track: every box back, every hazard and held item gone (timer stopped). */
	function clear() {
		taken.clear()
		hazards.clear()
		held.clear()
		if (expiry) T.clearTimeout(expiry)
		expiry = null
	}

	return {
		/** The track items live on (the selected one in the lobby, the race's during a race) + the scene bounds and scale. */
		setTrack(t, b, sc = 1) {
			const same = t === track
			track = t || null
			bounds = b || null
			scale = typeof sc === 'number' && sc > 0 && sc <= 1 ? sc : 1
			if (same) return
			boxIds = new Map((track?.boxes || []).map((x) => [x.id, { x: x.x, z: x.z }]))
			clear()
		},
		clear,
		/** A player left. */
		forget(pid) {
			held.delete(pid)
			rates.delete(pid)
		},
		handle(pid, m) {
			if (m.t === 'box') box(pid, m)
			else if (m.t === 'use') use(pid, m)
			else if (m.t === 'hit') hit(pid, m)
		},
		/** For `welcome` / `state`: boxes taken right now ([[id, until]]) and the live hazards. */
		snapshot() {
			const t = now()
			const boxes = []
			for (const [id, until] of taken) if (until > t) boxes.push([id, until])
			return { boxes, hazards: [...hazards.values()].map((h) => ({ ...h })) }
		},
		held: (pid) => held.get(pid) || null,
		timerRunning: () => !!expiry,
	}
}

module.exports = { createRoomItems, rollItem, weights, cleanPoint, ITEMS, BOX_RESPAWN_MS, HAZARD_MS, MAX_HAZARDS, RATE, BOX_REACH, USE_REACH }
