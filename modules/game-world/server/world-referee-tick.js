'use strict'

/**
 * WO-1102 — the referee's world-tick rules (work/notes/game-world-contract.md §6): R3 bowled over, R7 make way, R8
 * vegetable rain, R9 spotlight bonus. PURE like world-referee.js (its clock, rng and decide() are handed in).
 *   snap = { ents: [Ent + g], areas: { g: { rect: [minX, minZ, maxX, maxZ], y } | null }, pools: { g: [{ x, z, y, r }] } }
 * Pools are per game: an entity of game G is checked only against G's own pools (lead, 16.11). An Ent may carry `spd`
 * (absolute speed, m/s); without it the speed comes from the referee's own position history.
 */

const R3_REACH = 0.065 // car hit r 0.04 + soldier r 0.025
const R3_SPEED = 0.4
const R3_PAIR_MS = 1000
const R7_REACH = 0.6
const R7_SPEED = 0.3
const R7_ROLL_MS = 2000
const R7_GAP = 10000
const RAIN_RATE = 1.5 // per s per running game
const RAIN_H = 3
const RAIN_DRIFT = 0.4 // m/s, ± half
const RAIN_MAX = 30
const SPOT_EVERY = 2000
const SPOT_MAX = 5
const POOL_DY = 0.5
const G = 9.81
const EVENT_PHASES = new Set(['lobby', 'round', 'race', 'match'])
const VEG_IDS = ['tomato', 'potato', 'carrot', 'cabbage', 'onion', 'peas']

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Distance from point c to segment a → b (3D). */
function segDist(a, b, c) {
	const ab = sub(b, a)
	const l2 = dot(ab, ab)
	const t = l2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(c, a), ab) / l2)) : 0
	const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
	return Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2])
}

/** Where the rain falls for game g: its area(), else (rc) its cars' bounding box + 1 m. */
function rainArea(g, area, ents) {
	if (area && Array.isArray(area.rect) && area.rect.length === 4 && area.rect.every(Number.isFinite) && Number.isFinite(area.y)) return area
	const own = ents.filter((e) => e.g === g && (e.k === 'car' || e.k === 'soldier'))
	if (!own.length) return null
	let [x0, z0, x1, z1, y] = [Infinity, Infinity, -Infinity, -Infinity, Infinity]
	for (const e of own) {
		x0 = Math.min(x0, e.p[0])
		x1 = Math.max(x1, e.p[0])
		z0 = Math.min(z0, e.p[2])
		z1 = Math.max(z1, e.p[2])
		y = Math.min(y, e.p[1])
	}
	return { rect: [x0 - 1, z0 - 1, x1 + 1, z1 + 1], y }
}

function createTickRules(R) {
	const { now, rng, world, decide, giveBonus, addPatch, peaScatter, newOut, counts, VEG, SPLAT, HIT, DUR, FX_MS, isLive, frozen } = R
	const hist = new Map() // car `${g}:${id}` → [{ t, p }] (last 3)
	const r3Pair = new Map() // `${car}|${soldier}` → last ms
	const r7Roll = new Map() // `${car}|${av}` → last roll ms
	const stepAt = new Map() // av → last step ms
	const ev = { rain: null, spot: null }
	let drops = []
	let dropSeq = 0
	let lastT = null

	const phaseOk = (g) => g === 'world' || (EVENT_PHASES.has(world.phase[g]) && !frozen(g))

	function startEvent(kind, secs) {
		const t = now()
		const ms = Math.round(secs * 1000)
		if (kind === 'rain') ev.rain = { until: t + ms, secs, acc: {} }
		else if (kind === 'spot') ev.spot = { until: t + ms, secs, nextAt: t + SPOT_EVERY, n: new Map() }
		else return false
		return true
	}
	function endEvent(kind) {
		if (kind === 'rain' || kind === 'none') ev.rain = null
		if (kind === 'spot' || kind === 'none') ev.spot = null
		if (kind === 'none' && world.safe) drops = []
	}
	function eventsState() {
		const t = now()
		const left = (e) => (e && e.until > t ? { secs: e.secs, left: Math.ceil((e.until - t) / 1000) } : null)
		const o = { rain: left(ev.rain), spot: left(ev.spot) }
		return o.rain || o.spot ? o : null
	}

	/** Car speed: the Ent's own `spd`, else from the position history. */
	function speedOf(e, h) {
		if (Number.isFinite(e.spd)) return Math.abs(e.spd)
		if (!h || h.length < 2) return 0
		const a = h[h.length - 2]
		const b = h[h.length - 1]
		return b.t > a.t ? Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / ((b.t - a.t) / 1000) : 0
	}

	function track(cars, t) {
		const seen = new Set()
		for (const c of cars) {
			const k = `${c.g}:${c.id}`
			seen.add(k)
			const h = hist.get(k) || []
			h.push({ t, p: c.p.slice(0, 3) })
			while (h.length > 3) h.shift()
			hist.set(k, h)
		}
		for (const k of hist.keys()) if (!seen.has(k)) hist.delete(k)
	}

	/** R3: a car's swept segment (last 2 ticks) passes within 0.065 m of a live unprotected soldier at ≥ 0.4 m/s. */
	function bowled(cars, soldiers, t, out) {
		for (const car of cars) {
			const h = hist.get(`${car.g}:${car.id}`)
			if (!h || h.length < 2 || speedOf(car, h) < R3_SPEED) continue
			const a = [h[0].p[0], h[0].p[1] + HIT.car.dy, h[0].p[2]]
			const b = [car.p[0], car.p[1] + HIT.car.dy, car.p[2]]
			for (const s of soldiers) {
				if (s.g === car.g || !isLive(s)) continue
				if (segDist(a, b, [s.p[0], s.p[1] + HIT.soldier.dy, s.p[2]]) > R3_REACH) continue
				const pk = `${car.g}:${car.id}|${s.g}:${s.id}`
				if (t - (r3Pair.get(pk) ?? -Infinity) < R3_PAIR_MS) continue
				r3Pair.set(pk, t)
				const yaw = car.yaw || 0
				const dir = [-Math.sin(yaw), -Math.cos(yaw)]
				decide({ rule: 'R3', k: 'stun', target: s, dur: DUR.stunBowl, dir, src: { g: car.g, pid: car.id, name: car.n }, bonus: 'bowl', fx: [['stun', Math.round(DUR.stunBowl * 1000), car.c]] }, out)
				decide({ rule: 'R3', k: 'bump', target: car, dur: DUR.bump, src: { g: s.g, pid: s.id, name: s.n }, quiet: true, fx: [['sparks', FX_MS.sparks, '#ffd060']] }, out)
			}
		}
		for (const [k, at] of r3Pair) if (t - at > 5000) r3Pair.delete(k)
	}

	/** R7: a car within 0.6 m of the presenter avatar, ≥ 0.3 m/s towards it, avatar not dodging, chance 0.5. */
	function makeWay(cars, avs, t, out) {
		for (const av of avs) {
			if (av.f & (16 | 32)) continue // already ducking / stepping
			if (t - (stepAt.get(`${av.g}:${av.id}`) ?? -Infinity) < R7_GAP) continue
			for (const car of cars) {
				if (car.g === av.g) continue
				const dx = av.p[0] - car.p[0]
				const dz = av.p[2] - car.p[2]
				const d = Math.hypot(dx, dz)
				if (d > R7_REACH || d < 1e-6) continue
				const h = hist.get(`${car.g}:${car.id}`)
				if (!h || h.length < 2) continue
				const a = h[h.length - 2].p
				let mx = car.p[0] - a[0]
				let mz = car.p[2] - a[2]
				const ml = Math.hypot(mx, mz)
				if (ml < 1e-6) continue
				mx /= ml
				mz /= ml
				if (speedOf(car, h) * ((mx * dx + mz * dz) / d) < R7_SPEED) continue
				const rk = `${car.g}:${car.id}|${av.g}:${av.id}`
				if (t - (r7Roll.get(rk) ?? -Infinity) < R7_ROLL_MS) continue
				r7Roll.set(rk, t)
				if (rng() >= 0.5) continue
				// sideways, away from the car's line of travel
				let side = [-mz, mx]
				const s = side[0] * dx + side[1] * dz
				if (s < 0 || (s === 0 && rng() < 0.5)) side = [mz, -mx]
				const e = decide({ rule: 'R7', k: 'step', target: av, dur: DUR.step, dir: side, src: { g: car.g, pid: car.id, name: car.n }, dropSoft: true }, out)
				if (e) {
					stepAt.set(`${av.g}:${av.id}`, t)
					break
				}
			}
		}
		for (const [k, at] of r7Roll) if (t - at > 10000) r7Roll.delete(k)
	}

	/** R8: drop new rain over every running game's area, move the drops, hit / land them. */
	function rain(ents, areas, dt, t, out) {
		if (ev.rain && ev.rain.until > t && !world.safe) {
			const games = new Set(Object.keys(areas || {}))
			for (const e of ents) if (e.g !== 'world') games.add(e.g)
			for (const g of [...games].sort()) {
				if (!phaseOk(g) || world.affect[g] === 'off') continue
				const area = rainArea(g, areas ? areas[g] : null, ents)
				if (!area) continue
				ev.rain.acc[g] = (ev.rain.acc[g] || 0) + RAIN_RATE * dt
				while (ev.rain.acc[g] >= 1) {
					ev.rain.acc[g] -= 1
					if (drops.length >= RAIN_MAX) continue
					const veg = VEG_IDS[Math.floor(rng() * VEG_IDS.length)]
					const [x0, z0, x1, z1] = area.rect
					const p = [x0 + rng() * (x1 - x0), area.y + RAIN_H, z0 + rng() * (z1 - z0)]
					const v = [(rng() - 0.5) * RAIN_DRIFT, 0, (rng() - 0.5) * RAIN_DRIFT]
					drops.push({ id: `r${++dropSeq}`, veg, p, v, floor: area.y, born: t })
				}
			}
		} else if (ev.rain && ev.rain.until <= t) ev.rain = null
		if (!drops.length) return
		const targets = ents.filter((e) => e.k === 'car' || (e.k === 'soldier' && isLive(e)))
		const keep = []
		for (const d of drops) {
			const a = d.p.slice()
			d.v[1] -= G * dt
			d.p = [d.p[0] + d.v[0] * dt, d.p[1] + d.v[1] * dt, d.p[2] + d.v[2] * dt]
			const vr = VEG[d.veg].r
			const hit = targets.find((e) => segDist(a, d.p, [e.p[0], e.p[1] + HIT[e.k].dy, e.p[2]]) <= HIT[e.k].r + vr)
			if (hit) {
				const c = VEG[d.veg].c
				if (hit.k === 'car') decide({ rule: 'R8', k: 'hop', target: hit, dur: DUR.hop, src: null, c, fx: [['splat', FX_MS.splat, c], ['hop', FX_MS.hop, c]] }, out)
				else decide({ rule: 'R8', k: 'stun', target: hit, dur: DUR.stun, src: null, c, fx: [['stun', Math.round(DUR.stun * 1000), c]] }, out)
				continue
			}
			if (d.p[1] <= d.floor) {
				const p = [d.p[0], d.floor, d.p[2]]
				if (SPLAT.has(d.veg)) addPatch(d.veg, p, out)
				if (d.veg === 'peas') peaScatter({ g: 'world', pid: null, name: '' }, p, ents, out)
				continue
			}
			if (t - d.born > 4000) continue
			keep.push(d)
		}
		drops = keep
	}

	/** R9: every 2 s, a car / soldier / slingshot standing in one of its own game's light pools earns that game's bonus. */
	function spot(ents, pools, t, out) {
		const s = ev.spot
		if (!s) return
		if (s.until <= t) {
			ev.spot = null
			return
		}
		if (t < s.nextAt || world.safe) return
		while (s.nextAt <= t) s.nextAt += SPOT_EVERY
		for (const e of ents) {
			if (e.k !== 'car' && e.k !== 'soldier' && e.k !== 'sling') continue
			if (e.g === 'world' || (e.k === 'soldier' && e.f & 2) || !phaseOk(e.g) || world.affect[e.g] === 'off') continue
			const list = pools && Array.isArray(pools[e.g]) ? pools[e.g] : []
			const inPool = list.some((q) => q && Math.hypot(e.p[0] - q.x, e.p[2] - q.z) <= q.r && Math.abs(e.p[1] - (Number.isFinite(q.y) ? q.y : e.p[1])) <= POOL_DY)
			if (!inPool) continue
			const sk = `${e.g}:${e.id}`
			if ((s.n.get(sk) || 0) >= SPOT_MAX) continue
			const src = { g: e.g, pid: e.id, name: e.n }
			if (!giveBonus(src, 'spot', out)) continue
			s.n.set(sk, (s.n.get(sk) || 0) + 1)
			counts.R9 = (counts.R9 || 0) + 1
			out.events.push({ k: 'R9', by: { g: e.g, name: String(e.n || '') }, to: { g: e.g, name: String(e.n || '') }, p: e.p.slice(0, 3), at: t })
		}
	}

	/** One world tick. */
	function run(snap) {
		const t = now()
		const out = newOut()
		const dt = lastT == null ? 0.1 : Math.max(0, Math.min(0.25, (t - lastT) / 1000))
		lastT = t
		const ents = Array.isArray(snap.ents) ? snap.ents : []
		const cars = ents.filter((e) => e.k === 'car')
		track(cars, t)
		if (world.safe) {
			drops = []
			return out
		}
		bowled(cars, ents.filter((e) => e.k === 'soldier'), t, out)
		makeWay(cars, ents.filter((e) => e.k === 'av'), t, out)
		rain(ents, snap.areas || {}, dt, t, out)
		spot(ents, snap.pools || {}, t, out)
		return out
	}

	const rainEnts = () => drops.map((d) => ({ k: 'veg', id: d.id, p: d.p.slice(), yaw: 0, v: d.v.slice(), c: VEG[d.veg].c, n: '', f: 1, s: d.veg }))

	return { run, startEvent, endEvent, eventsState, rainEnts, spotActive: () => !!ev.spot, drops: () => drops.length }
}

module.exports = { createTickRules, segDist, rainArea, EVENT_PHASES }
