/**
 * Projectile bookkeeping of the Stage Salad client (WO-1089 §5 / §9 / §11) — pure, node-testable (no three.js, no DOM).
 *
 *   own shot   addOwn() at the release: flight.js `launches` from the own pouch, drawn at once (prediction). The server's
 *              echo (`shot`, same n) confirms it; a pea burst (the server draws the seed) or a differing launch is
 *              replaced by the server's flights, caught up to the same flight time. No echo in ORPHAN_MS → dropped.
 *   others'    onShot(): the server's launches, stepped from its `ts` to serverNow (late joiners catch up).
 *   the end    onEnd(): the server's word. A flight stops where and when the server says (`p`, `at`): it is stepped
 *              only up to that flight time, then snapped to `p` and finished. Until the word arrives the client tests
 *              the avatars it DRAWS (opts.hitTest): a contact holds the vegetable there for up to HOLD_MS (the server's
 *              `end` usually lands inside that window) — no vegetable visibly flying through the presenter while the
 *              verdict travels; no word in time → it flies on. A local land / out without a word finishes quietly
 *              after LINGER_MS (a round change clears the server's flights without `end`s).
 * Budgets (contract §11): ≤ MAX_LIVE projectiles, ≤ MAX_MARKS ground / wall splats fading over MARK_MS.
 * update() returns the finished projectiles as events for the effects (splats, avatar reactions, banners, sounds).
 */
import { vegOf } from './veggies.js'
import { launches, createFlight, stepFlight, MAX_T } from './flight.js'

export const MAX_LIVE = 30
export const MAX_MARKS = 40
export const MARK_MS = 10000
export const HOLD_MS = 400
export const ORPHAN_MS = 1500
export const LINGER_MS = 2500
export const REST_MS = 3000
export const MAX_STEPS = 600 // per projectile per update (5 s of catch-up at 120 Hz)
const G = 9.81

export const keyOf = (id, n, i) => `${id}:${n}:${i}`

function save(f) {
	return { p: f.p.slice(), v: f.v.slice(), t: f.t, bounces: f.bounces, lastTag: f.lastTag, lastContactT: f.lastContactT }
}

function restore(f, s) {
	Object.assign(f, { p: s.p, v: s.v, t: s.t, bounces: s.bounces, lastTag: s.lastTag, lastContactT: s.lastContactT, end: null })
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export class ShotBook {
	/** @param {{ venue?: object, meId?: any }} [o] */
	constructor(o = {}) {
		this.venue = o.venue || null
		this.meId = o.meId ?? null
		this.live = []
		this.marks = []
		this.loose = [] // `end`s of projectiles we do not have (evicted, joined late)
	}

	setVenue(v) {
		this.venue = v
	}

	_find(id, n, i) {
		return this.live.find((p) => p.id === id && p.n === n && p.i === i) || null
	}

	_add(pr) {
		this.live.push(pr)
		while (this.live.length > MAX_LIVE) {
			const k = this.live.findIndex((p) => p.state === 'rest' || p.state === 'fall')
			this.live.splice(k >= 0 ? k : 0, 1)
		}
		return pr
	}

	_make(id, n, veg, l, ts, sts, own, sNow) {
		const f = createFlight(veg, l)
		return { l0: { p: l.p.slice(), v: l.v.slice() }, key: keyOf(id, n, l.i), id, n, i: l.i, veg, own, ts, sts, f, end: null, state: 'fly', p: f.p.slice(), v: f.v.slice(), born: sNow, holdSince: 0, holdP: null, noHit: false, lingerAt: 0, doneAt: 0 }
	}

	/** The own release: draw it at once. → the projectiles made */
	addOwn({ n, veg, o, yaw, pitch, power, sNow }) {
		const v = typeof veg === 'string' ? vegOf(veg) : veg
		if (!v || this.meId == null) return []
		return launches(v, o, yaw, pitch, power, 0).map((l) => this._add(this._make(this.meId, n, v, l, sNow, null, true, sNow)))
	}

	/** A decoded `shot`. */
	onShot(m, sNow) {
		const veg = vegOf(m.veg)
		if (!veg || sNow - m.ts > MAX_T * 1000) return
		const L = launches(veg, m.o, m.a[0], m.a[1], m.p, m.seed)
		const mine = this.live.filter((p) => p.id === m.id && p.n === m.n)
		if (mine.length) {
			for (const pr of mine) {
				if (pr.sts != null) continue // a duplicate echo
				pr.sts = m.ts
				const l = L[pr.i]
				if (!l || (veg.n === 1 && pr.l0 && dist(pr.l0.p, l.p) < 0.02 && dist(pr.l0.v, l.v) < 0.05)) continue
				const t0 = pr.f.t
				pr.f = createFlight(veg, l)
				let k = 0
				while (!pr.f.end && pr.f.t < t0 - 1e-9 && k++ < MAX_STEPS) stepFlight(pr.f, this.venue)
				pr.p = pr.f.p.slice()
			}
			return
		}
		for (const l of L) {
			const pr = this._add(this._make(m.id, m.n, veg, l, m.ts, m.ts, m.id === this.meId, sNow))
			const k = this.loose.findIndex((e) => e.id === m.id && e.n === m.n && e.i === l.i)
			if (k >= 0) pr.end = this.loose.splice(k, 1)[0]
		}
	}

	/** A decoded `end`. */
	onEnd(m) {
		const pr = this._find(m.id, m.n, m.i)
		if (pr) {
			if (!pr.end) pr.end = m
			return true
		}
		this.loose.push(m)
		if (this.loose.length > 60) this.loose.shift()
		return false
	}

	/**
	 * WO-1102 Game World: a decoded `xb` — the server's flight bounced off another game's car / soldier (a collider this
	 * client does not have). The projectile flies on from the server's p / v at that flight time.
	 */
	onBounce(m) {
		const pr = this._find(m.id, m.n, m.i)
		if (!pr || pr.end || pr.state !== 'fly') return false
		const bounces = pr.f.bounces + 1
		pr.f = createFlight(pr.veg, { i: m.i, p: m.p, v: m.v })
		pr.f.t = Math.max(0, (m.at - (pr.sts ?? pr.ts)) / 1000)
		pr.f.bounces = bounces
		pr.p = m.p.slice()
		pr.v = m.v.slice()
		return true
	}

	/** A phase change: the server dropped its flights. Splats on the floor stay. */
	clear() {
		this.live = []
		this.loose = []
	}

	_mark(pr, end, sNow) {
		let n = [0, 1, 0]
		const le = pr.f.end
		if (le?.n && dist(le.p, end.p) < 0.6) n = le.n.slice()
		this.marks.push({ p: end.p.slice(), n, color: pr.veg.color, r: pr.veg.r * (pr.veg.id === 'peas' ? 2.6 : 3.2), at: sNow, key: pr.key })
		while (this.marks.length > MAX_MARKS) this.marks.shift()
	}

	_finish(pr, end, sNow, events, quiet = false) {
		pr.p = end.p.slice()
		pr.doneAt = sNow
		const splat = pr.veg.splat
		if (end.k === 'land' && splat && end.tag !== 'umbrella') this._mark(pr, end, sNow)
		if (end.k === 'land' && !splat) {
			if (end.tag === 'umbrella') {
				pr.state = 'fall'
				pr.v = [0, 1.2, 0]
			} else pr.state = 'rest'
		} else pr.state = 'gone'
		if (!quiet)
			events.push({ k: end.k, p: end.p.slice(), tag: end.tag ?? null, tid: end.tid ?? null, part: end.part ?? null, pts: end.pts ?? null, streak: end.streak ?? null, bank: !!end.bank, veg: pr.veg, id: pr.id, n: pr.n, i: pr.i, own: pr.own, v: pr.f.v.slice() })
	}

	/**
	 * Advance everything to server time `sNow`. opts: { hitTest (the drawn avatars, flight.js signature), dt (s, for
	 * falling vegetables) }. → events [{ k, p, tag, tid, part, pts, streak, bank, veg, id, n, i, own, v }]
	 */
	update(sNow, opts = {}) {
		const events = []
		const venue = this.venue
		for (const pr of this.live) {
			if (pr.state === 'gone') continue
			if (pr.state === 'rest') {
				if (sNow - pr.doneAt > REST_MS) pr.state = 'gone'
				continue
			}
			if (pr.state === 'fall') {
				const dt = Math.min(0.1, Math.max(0, opts.dt || 0))
				pr.v[1] -= G * dt
				pr.p[1] += pr.v[1] * dt
				const floor = (venue?.hall?.y ?? 0) + pr.veg.r
				if (pr.p[1] <= floor) ((pr.p[1] = floor), (pr.state = 'rest'), (pr.doneAt = sNow))
				continue
			}
			if (pr.own && pr.sts == null && !pr.end && sNow - pr.born > ORPHAN_MS) {
				pr.state = 'gone' // the server refused the shot
				continue
			}
			if (!venue) continue
			const tau = (sNow - pr.ts) / 1000
			const endFT = pr.end ? (pr.end.at - (pr.sts ?? pr.ts)) / 1000 : Infinity
			if (pr.state === 'hold') {
				if (pr.end) pr.state = 'fly'
				else if (sNow - pr.holdSince > HOLD_MS) ((pr.state = 'fly'), (pr.noHit = true), (pr.holdP = null))
				else continue
			}
			const target = Math.min(tau, endFT, MAX_T)
			const f = pr.f
			let k = 0
			while (!f.end && f.t < target - 1e-9 && k++ < MAX_STEPS) {
				if (!pr.end && !pr.noHit && opts.hitTest) {
					const s = save(f)
					stepFlight(f, venue, { hitTest: opts.hitTest })
					if (f.end && f.end.k === 'hit') {
						pr.holdP = f.end.p.slice()
						restore(f, s)
						pr.state = 'hold'
						pr.holdSince = sNow
						break
					}
				} else stepFlight(f, venue)
			}
			pr.p = pr.state === 'hold' ? pr.holdP.slice() : f.p.slice()
			pr.v = f.v.slice()
			if (pr.state === 'hold') continue
			if (pr.end) {
				if (tau >= endFT) this._finish(pr, pr.end, sNow, events)
			} else if (f.end) {
				if (!pr.lingerAt) pr.lingerAt = sNow
				if (f.end.k === 'out' || sNow - pr.lingerAt > LINGER_MS) this._finish(pr, f.end, sNow, events, true)
			}
		}
		this.live = this.live.filter((p) => p.state !== 'gone')
		for (let j = this.loose.length - 1; j >= 0; j--) {
			const e = this.loose[j]
			if (sNow < e.at) continue
			this.loose.splice(j, 1)
			const veg = null // an `end` does not name the vegetable
			if (sNow - e.at < 1500) events.push({ k: e.k, p: e.p.slice(), tag: e.tag ?? null, tid: e.tid ?? null, part: e.part ?? null, pts: e.pts ?? null, streak: e.streak ?? null, bank: !!e.bank, veg, id: e.id, n: e.n, i: e.i, own: e.id === this.meId, v: [0, 0, 0] })
		}
		this.marks = this.marks.filter((m) => sNow - m.at < MARK_MS)
		return events
	}

	/** 1 → 0 over a mark's life (the last 40 % fade). */
	static markAlpha(m, sNow) {
		const age = (sNow - m.at) / MARK_MS
		return age < 0.6 ? 1 : Math.max(0, 1 - (age - 0.6) / 0.4)
	}
}
