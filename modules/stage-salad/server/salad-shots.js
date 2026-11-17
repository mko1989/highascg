'use strict'

/**
 * WO-1089 — Stage Salad referee: `fire` checks, the server-authoritative flights and the score (contract §5, §7, §9).
 * A client sends only its intent (vegetable, yaw / pitch, power, its counter); the launch point is the server's slot
 * pouch, the flight is flight.js against the venue colliders AND the avatars' hit parts at that moment
 * (salad-presenters.js), stepped from the room's 30 Hz tick until it ends. A client never reports a hit.
 *
 * fire(p, m) → { ok } | { ok: false, why }   (dropped silently on the wire; `why` is for the smokes / bots)
 *   checks: phase lobby / round, not `safe`, the player has a slot, n increasing, the vegetable's reload over (60 ms
 *   slack), ≤ 3 fires in any second, yaw within ±55° of the slot's, pitch −10°…70°, power 0.15…1 — out of range is
 *   refused, never clamped.
 * At a fire the shot is also predicted against the avatars' current pose + walking speed: a predicted hit may make
 * that avatar dodge (presenters.planDodge, announced before the vegetable arrives).
 */

const { shared } = require('./salad-kit')
const { points } = require('./salad-score')

const DEG = Math.PI / 180
const LIMITS = { yawDeg: 55, pitchMin: -10, pitchMax: 70, perSecond: 3, slackMs: 60 }
const MAX_LIVE = 60 // flights at once (20 players × a pea burst is 100 — the oldest are cut short)
const WORLD_TAGS = new Set(['car', 'soldier']) // WO-1102 Game World colliders (hub.colliders: other games' cars / soldiers)
const WORLD_GAP = 0.1 // s between two world contacts of one flight (a sphere resting against a car is one contact)
const r3 = (v) => Math.round(v * 1000) / 1000 + 0
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

/**
 * @param {{ now: () => number, rng: () => number, venue: () => object|null, phase: () => string, safe: () => boolean,
 *   toAll: (msg) => void, toPlayer: (p, msg) => void, scored: () => void }} X
 * @param {object} presenters salad-presenters.js
 */
function createShots(X, presenters) {
	const S = shared()
	const live = [] // [{ p, n, veg, ts, origin, dist0, flights: [f], open, hit, bank }]

	function me(p) {
		X.toPlayer(p, { t: 'me', ready: p.readyAt, streak: p.streak, score: p.score })
	}

	function hitTestAt(t, ahead = null) {
		const targets = ahead == null ? presenters.partsAt(t) : null
		return (p0, p1, r, ft) => {
			let best = null
			const list = ahead == null ? targets : presenters.partsAt(t + ft * 1000, ft)
			for (const tg of list) {
				const h = S.body.sweepParts(tg.parts, p0, p1, r)
				if (h && (!best || h.u < best.u)) best = { ...h, tid: tg.tid }
			}
			return best
		}
	}

	function fire(p, m, t = X.now()) {
		const v = X.venue()
		const ph = X.phase()
		if (ph !== 'lobby' && ph !== 'round') return { ok: false, why: 'phase' }
		if (X.safe()) return { ok: false, why: 'safe' }
		if (!v || p.slot == null || !v.slots[p.slot]) return { ok: false, why: 'slot' }
		const veg = S.veggies.vegOf(m.veg)
		if (!veg) return { ok: false, why: 'veg' }
		if (!(m.n > p.lastN)) return { ok: false, why: 'n' }
		if (t < p.readyAt - LIMITS.slackMs) return { ok: false, why: 'reload' }
		p.fireTimes = p.fireTimes.filter((x) => t - x < 1000)
		if (p.fireTimes.length >= LIMITS.perSecond) return { ok: false, why: 'rate' }
		const slot = v.slots[p.slot]
		const [yaw, pitch] = m.a
		if (Math.abs(angDiff(slot.yaw, yaw)) > LIMITS.yawDeg * DEG) return { ok: false, why: 'yaw' }
		if (pitch < LIMITS.pitchMin * DEG || pitch > LIMITS.pitchMax * DEG) return { ok: false, why: 'pitch' }
		if (!(m.p >= S.veggies.POWER_MIN && m.p <= S.veggies.POWER_MAX)) return { ok: false, why: 'power' }
		p.lastN = m.n
		p.fireTimes.push(t)
		p.readyAt = t + Math.round(veg.reload * 1000)
		const scored = ph === 'round'
		if (scored) p.shots++
		const origin = S.venue.pouch(slot).map(r3)
		const seed = Math.floor(X.rng() * 4294967296) >>> 0
		const launches = S.flight.launches(veg, origin, yaw, pitch, m.p, seed)
		X.toAll({ t: 'shot', id: p.id, n: m.n, veg: veg.id, o: origin, a: [r3(yaw), r3(pitch)], p: r3(m.p), ts: t, seed })
		// predicted against where the avatars will be: a dodge, announced before the vegetable arrives
		const pred = S.flight.simulate(veg, launches[0], v, { hitTest: hitTestAt(t, 0) })
		if (pred.k === 'hit' && pred.part !== 'umbrella') presenters.planDodge(pred.tid, pred.part, t + Math.round(pred.t * 1000), pred.p, t)
		while (live.length && live.reduce((s, x) => s + x.open, 0) + launches.length > MAX_LIVE) cut(live[0])
		live.push({ p, n: m.n, veg, ts: t, origin, scored, flights: launches.map((l) => S.flight.createFlight(veg, l)), open: launches.length, hit: false })
		me(p)
		return { ok: true, seed }
	}

	function finish(rec, f) {
		const e = f.end
		rec.open--
		const msg = { t: 'end', id: rec.p.id, n: rec.n, i: f.i, k: e.k, p: e.p.map(r3), at: rec.ts + Math.round(e.t * 1000) }
		if (e.tag) msg.tag = e.tag
		if (e.k === 'hit' && e.part === 'umbrella') Object.assign(msg, { k: 'land', tag: 'umbrella', tid: e.tid })
		else if (e.k === 'hit') {
			const first = !rec.hit
			rec.hit = true
			const p = rec.p
			if (first) {
				p.streak++
				p.best = Math.max(p.best, p.streak)
				if (rec.scored) p.hits++
			}
			Object.assign(msg, { tid: e.tid, part: e.part, streak: p.streak })
			if (e.bounced && rec.veg.bank) msg.bank = true
			if (rec.scored) {
				const dist = Math.hypot(e.p[0] - rec.origin[0], e.p[2] - rec.origin[2])
				msg.pts = points({ part: e.part, veg: rec.veg, dist, streak: p.streak, bounced: e.bounced })
				p.score += msg.pts
			}
		}
		X.toAll(msg)
		if (e.k === 'land' && rec.xw) rec.xw.landed({ g: 'salad', pid: rec.p.id, veg: rec.veg.id, p: msg.p, tag: e.tag || '', i: f.i }) // WO-1102 R2 / R5
		if (!rec.open) {
			if (!rec.hit) rec.p.streak = 0
			me(rec.p)
			if (rec.scored) X.scored()
		}
	}

	function cut(rec) {
		for (const f of rec.flights) if (!f.end) (f.end = { k: 'out', p: f.p.slice(), t: f.t }), finish(rec, f)
		live.splice(live.indexOf(rec), 1)
	}

	/**
	 * WO-1102: a flight met another game's car / soldier (the world hub's sphere colliders, flight.js's own bounce / splat
	 * rules decide what the vegetable does). The world referee decides the effect; a bounce re-anchors the clients' copy
	 * of the flight (`xb`), a splat ends it (`end` with tag car / soldier).
	 */
	function worldContact(rec, f, xw) {
		if (f.xwT != null && f.t - f.xwT < WORLD_GAP) return
		f.xwT = f.t
		try {
			xw.contact({ g: 'salad', pid: rec.p.id, veg: rec.veg.id, p: f.p.slice(), v: f.v.slice(), tag: f.lastTag, w: f.lastW, end: !!f.end }) // WO-1106 A2: w = the car / soldier hit
		} catch {}
		if (!f.end) X.toAll({ t: 'xb', id: rec.p.id, n: rec.n, i: f.i, p: f.p.map(r3), v: f.v.map(r3), at: rec.ts + Math.round(f.t * 1000) })
	}

	/** Step every open flight up to time t (the room's tick). */
	function tick(t = X.now()) {
		if (!live.length) return
		const v = X.venue()
		if (!v) return
		const xw = X.xw ? X.xw() : null // WO-1102 Game World hooks (null without the world: the flights are exactly as before)
		const extra = xw ? xw.colliders() : null
		const opts = extra && extra.length ? { hitTest: hitTestAt(t), extra } : { hitTest: hitTestAt(t) }
		for (const rec of live.slice()) {
			const tau = (t - rec.ts) / 1000
			rec.xw = xw
			for (const f of rec.flights) {
				while (!f.end && f.t < tau) {
					const before = f.lastContactT
					S.flight.stepFlight(f, v, opts)
					if (opts.extra && f.lastContactT !== before && WORLD_TAGS.has(f.lastTag)) worldContact(rec, f, xw)
				}
				if (f.end && !f.reported) (f.reported = true), finish(rec, f)
			}
			if (!rec.open) live.splice(live.indexOf(rec), 1)
		}
	}

	return {
		fire,
		tick,
		active: () => live.length,
		/** WO-1101 Game World: the open flights (vegetables in the air) — [{ rec, f }], newest last. */
		flights: () => live.flatMap((rec) => rec.flights.filter((f) => !f.end).map((f) => ({ rec, f }))),
		/**
		 * Phase change / stop: open flights end where they are (no score). `notify` (WO-1106 B60 / B64: the buzzer, the
		 * presenter-safe) also tells every client with an `end` k 'out' per open flight, so nothing keeps flying on screen.
		 */
		clear(notify = false) {
			if (notify) {
				for (const rec of live) {
					for (const f of rec.flights) {
						if (!f.end) X.toAll({ t: 'end', id: rec.p.id, n: rec.n, i: f.i, k: 'out', p: f.p.map(r3), at: rec.ts + Math.round(f.t * 1000) })
					}
				}
			}
			live.length = 0
		},
		LIMITS,
	}
}

module.exports = { createShots, LIMITS }
