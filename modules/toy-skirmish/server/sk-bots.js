'use strict'

/**
 * WO-1081 — Stage Skirmish: server-driven soldiers (contract §8). The host asks for 0–6 (`bots {n}`); they count
 * towards the 10 players, so a joining guest takes a bot's place and a leaving one gives it back. Each bot (10 Hz,
 * timer only while bots exist):
 *   - moves on the arena's grid at 4.5 u/s: A* path (sk-grid.js findPath over the cells a soldier fits) to a goal — a
 *     pickup it wants (a weapon it lacks, health under 70, armour under 50, surge — near enough to be worth it), else
 *     a patrol of the spawn points it passed longest ago (kept until reached); re-plans every 2–4 s, when it arrives or
 *     when the path is gone; looks ahead along the path where the straight
 *     line stays on passable cells; picks up what it touches (through the same rules as a player's `pick`);
 *   - notices, turns towards and fires at only what a player in its place could see (WO-1083, sk-bot-aim.js: the
 *     follow camera's frame both ways — never past 7.1 u — and a clear line on the full grid), after a reaction time,
 *     at a limited turn rate, with an aim error that grows with distance; the host's level (easy / normal / hard) sets
 *     those numbers — through the same `fire` acceptance as a player (interval, ammo);
 *   - its hits are decided by the server against its own positions: hitscan pellets (the shot's seed, mulberry32, as
 *     every client draws them) are traced to the first soldier or solid cell, enemy hits go through the same `hit`
 *     rules (§5, plus the bot view rule there); a Thumper rocket is flown to its first solid cell / soldier / 4 s and reported as the owner's `boom`
 *     after its flight time.
 */

const G = require('./sk-grid')
const { kit } = require('./sk-kit')
const { WEAPONS, ROCKET, SOLDIER, RULES, pelletYaws, dirOf, yawTo } = require('./sk-rules')
const A = require('./sk-bot-aim')

const NAMES = ['Sgt Sprocket', 'Pip Pebble', 'Cpl Crumb', 'Major Mallow', 'Cadet Button', 'Lt Biscuit']
const BOT_MS = 100
const WISH_MIN = 0.9 // a pickup's worth / (1 + distance / 10 u): a missing weapon within ~23 u, health when hurt
const VISIT_U = 3 // a patrol point counts as visited this close

/**
 * @param {object} X the room context  @param {object} combat sk-combat.js
 * @param {{ add: (name, color) => object, remove: (p) => void, room: () => ({ maxPlayers: number, humans: number }) }} hooks
 */
function createBots(X, combat, hooks) {
	let wanted = 0
	let level = 'normal'
	const list = []
	let timer = null
	const now = () => X.now()
	const u = () => X.u
	const acting = () => X.phase() === 'lobby' || X.phase() === 'match'

	function add() {
		const used = new Set(list.map((p) => p.name))
		const name = NAMES.find((n) => !used.has(n)) || `Bot ${list.length + 1}`
		const pal = kit().PALETTE
		const p = hooks.add(name, pal[(NAMES.indexOf(name) + 3) % pal.length])
		p.ai = { n: 0, path: null, i: 0, goal: null, replanAt: 0, target: null, seenSince: 0, reactMs: 0, lostId: null, lostAt: 0, aim: null,
			seen: new Map(), rockets: [], last: now() }
		list.push(p)
		combat.spawn(p, X.phase() === 'countdown' || X.phase() === 'results' ? { until: now() + RULES.protectMs } : {})
	}

	function remove(p) {
		const i = list.indexOf(p)
		if (i >= 0) list.splice(i, 1)
		hooks.remove(p)
	}

	/** Bring the bot count in line with the wish and the free places. */
	function sync() {
		const { maxPlayers, humans } = hooks.room()
		const want = Math.max(0, Math.min(wanted, maxPlayers - humans))
		while (list.length < want) add()
		while (list.length > want) remove(list[list.length - 1])
		if (list.length && !timer) timer = X.T.setInterval(tick, BOT_MS)
		if (!list.length && timer) {
			X.T.clearInterval(timer)
			timer = null
		}
	}

	const enemiesOf = (p) => [...X.players.values()].filter((q) => q !== p && q.alive && q.pos && (q.connected || q.bot) &&
		(X.mode() !== 'tdm' || q.team !== p.team))

	/** The pickup worth walking to (worth ≥ WISH_MIN: one it lacks or needs, not a top-up across the map), or null. */
	function wish(p) {
		let best = null, bs = 0
		for (const it of X.arena.pickups) {
			if (!combat.available(it.id)) continue
			const W = WEAPONS[it.kind]
			let v = 0
			if (W) v = p.w[it.kind] === undefined ? 3 : p.w[it.kind] < W.pickup ? 1 : 0
			else if (it.kind === 'health') v = p.hp < 40 ? 5 : p.hp < 70 ? 3 : 0
			else if (it.kind === 'armour') v = p.ar < 50 ? 2 : 0
			else if (it.kind === 'surge') v = 4
			const s = v / (1 + Math.hypot(it.x - p.pos[0], it.z - p.pos[1]) / (10 * u()))
			if (s > bs) (best = it), (bs = s)
		}
		return bs >= WISH_MIN ? best : null
	}

	/**
	 * Patrol (WO-1083: a bot sees no farther than a player, so it has to go and look): the spawn points it has not
	 * passed for the longest time, one of the three oldest at random, not the one it stands at.
	 */
	function roam(p) {
		const ai = p.ai
		const A = X.arena
		const list = A.spawns.map((sp, i) => ({ sp, at: ai.seen.get(i) ?? -Infinity, r: X.rng() }))
			.filter((o) => Math.hypot(o.sp.x - p.pos[0], o.sp.z - p.pos[1]) > VISIT_U * u())
			.sort((a, b) => a.at - b.at || a.r - b.r)
		return list.slice(0, 3).sort((a, b) => a.r - b.r).map((o) => [o.sp.x, o.sp.z])
	}

	function plan(p) {
		const ai = p.ai
		ai.replanAt = now() + 2000 + X.rng() * 2000
		const it = wish(p)
		// a patrol goal is kept until it is reached (re-planned only for the path); a wanted pickup comes first
		const keep = ai.goal && Math.hypot(ai.goal[0] - p.pos[0], ai.goal[1] - p.pos[1]) > VISIT_U * u() ? [ai.goal] : []
		const goals = it ? [[it.x, it.z], ...keep, ...roam(p)] : [...keep, ...roam(p)]
		for (const g of goals) {
			const path = G.findPath(X.grid, X.mask, p.pos[0], p.pos[1], g[0], g[1])
			if (path && path.length > 1) {
				ai.goal = it && g[0] === it.x && g[1] === it.z ? null : g
				ai.path = path
				ai.i = 0 // the own cell's centre first (the bot stands somewhere in it), the look-ahead skips it when it can
				return
			}
		}
		ai.path = null
		ai.goal = null
	}

	/** A straight walk the soldier's circle never touches a solid cell on (exact clearance every quarter cell). */
	function walkable(ax, az, bx, bz) {
		const d = Math.hypot(bx - ax, bz - az)
		const n = Math.ceil(d / (X.grid.cell / 4))
		const r = SOLDIER.radius * u() * 1.05 // 5 % margin: samples every quarter cell, positions rounded to 0.1 mm
		for (let k = 1; k <= n; k++) if (!G.clearAt(X.grid, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, r)) return false
		return true
	}

	/** One walking step; → the walking yaw, or null when it stood still. */
	function move(p, dt) {
		const ai = p.ai
		if (!ai.path || ai.i >= ai.path.length || now() >= ai.replanAt) plan(p)
		if (!ai.path) return null
		let step = SOLDIER.speed * u() * dt
		const before = p.pos.slice()
		while (step > 1e-9 && ai.i < ai.path.length) {
			for (let j = Math.min(ai.i + 8, ai.path.length - 1); j > ai.i; j--) {
				if (walkable(p.pos[0], p.pos[1], ai.path[j][0], ai.path[j][1])) {
					ai.i = j
					break
				}
			}
			const [tx, tz] = ai.path[ai.i]
			const d = Math.hypot(tx - p.pos[0], tz - p.pos[1])
			if (d <= step) {
				p.pos = [tx, tz]
				step -= d
				ai.i++
			} else {
				p.pos = [p.pos[0] + ((tx - p.pos[0]) / d) * step, p.pos[1] + ((tz - p.pos[1]) / d) * step]
				step = 0
			}
		}
		p.pos = [Math.round(p.pos[0] * 1e4) / 1e4, Math.round(p.pos[1] * 1e4) / 1e4]
		const moved = Math.hypot(p.pos[0] - before[0], p.pos[1] - before[1])
		X.arena.spawns.forEach((sp, i) => {
			if (Math.hypot(sp.x - p.pos[0], sp.z - p.pos[1]) <= VISIT_U * u()) ai.seen.set(i, now())
		})
		for (const it of X.arena.pickups) {
			if (combat.available(it.id) && Math.hypot(it.x - p.pos[0], it.z - p.pos[1]) <= RULES.pickRadius * u()) combat.pick(p, { id: it.id })
		}
		return moved > 1e-6 ? yawTo(before[0], before[1], p.pos[0], p.pos[1]) : null
	}

	/** First soldier (other than p) a ray meets before `max`: { q, t } or null. */
	function soldierOnRay(p, x, z, dx, dz, max, r) {
		let best = null
		for (const q of X.players.values()) {
			if (q === p || !q.alive || !q.pos) continue
			const ox = q.pos[0] - x, oz = q.pos[1] - z
			const t = ox * dx + oz * dz
			if (t < 0 || t > max) continue
			const side = Math.abs(ox * dz - oz * dx)
			if (side > r) continue
			const tin = t - Math.sqrt(r * r - side * side)
			if (!best || tin < best.t) best = { q, t: Math.max(0, tin) }
		}
		return best
	}

	function shoot(p, target) {
		const ai = p.ai
		const d = Math.hypot(target.pos[0] - p.pos[0], target.pos[1] - p.pos[1]) / u()
		const w = A.choose(p, d)
		if (!w) return
		const last = p.lastFire[w]
		if (last != null && now() - last < WEAPONS[w].interval * 1000) return
		const yaw = A.shotYaw(X, p, d, A.LEVELS[level])
		const rec = combat.fire(p, { w, n: ++ai.n, p: p.pos.slice(), yaw: Math.round(yaw * 1000) / 1000 })
		if (!rec) return
		if (WEAPONS[w].kind === 'rocket') {
			const [dx, dz] = dirOf(rec.yaw)
			const max = ROCKET.speed * ROCKET.life * u()
			let t = G.rayHit(X.grid, rec.p[0], rec.p[1], dx, dz, max)
			const s = soldierOnRay(p, rec.p[0], rec.p[1], dx, dz, t, ROCKET.contact * u())
			if (s) t = s.t
			ai.rockets.push({ n: rec.n, at: rec.at + (t / (ROCKET.speed * u())) * 1000, p: [rec.p[0] + dx * t, rec.p[1] + dz * t] })
			return
		}
		const hits = new Map()
		for (const py of pelletYaws(w, rec.yaw, rec.seed)) {
			const [dx, dz] = dirOf(py)
			const wall = G.rayHit(X.grid, rec.p[0], rec.p[1], dx, dz, WEAPONS[w].range * u())
			const s = soldierOnRay(p, rec.p[0], rec.p[1], dx, dz, wall, SOLDIER.radius * u())
			if (s && enemiesOf(p).includes(s.q)) hits.set(s.q.id, (hits.get(s.q.id) || 0) + 1)
		}
		for (const [id, k] of hits) combat.hit(p, { n: rec.n, id, k })
	}

	function tick() {
		const t = now()
		for (const p of list.slice()) {
			const ai = p.ai
			const dt = Math.min(0.25, Math.max(0, (t - ai.last) / 1000))
			ai.last = t
			for (const r of ai.rockets.slice()) {
				if (t < r.at) continue
				ai.rockets.splice(ai.rockets.indexOf(r), 1)
				combat.boom(p, { n: r.n, p: [Math.round(r.p[0] * 1e4) / 1e4, Math.round(r.p[1] * 1e4) / 1e4] })
			}
			if (!p.alive || !p.pos || !X.grid || !acting()) {
				ai.path = null
				ai.target = null
				ai.aim = null
				if (p.mv) (p.mv = 0), X.dirty()
				continue
			}
			const heading = move(p, dt)
			const q = A.spot(X, p, enemiesOf(p), t) // after the step: only what it sees from where it stands
			const ready = A.aimStep(X, p, q, t, dt, heading, A.LEVELS[level])
			p.mv = heading != null ? 1 : 0
			p.moveAt = t
			X.dirty()
			if (ready && p.alive) shoot(p, q)
		}
	}

	return {
		sync,
		setWanted(n) {
			wanted = n
			sync()
		},
		wanted: () => wanted,
		/** The host's bot skill (sk-bot-aim.js LEVELS). → false for an unknown level. */
		setLevel(l) {
			if (!A.LEVELS[l]) return false
			level = l
			return true
		},
		level: () => level,
		/** The host kicked a bot: one fewer wanted. */
		kick(p) {
			wanted = Math.max(0, wanted - 1)
			remove(p)
		},
		arenaChanged() {
			for (const p of list) (p.ai.path = null), (p.ai.goal = null), (p.ai.rockets = []), p.ai.seen.clear()
		},
		list: () => list.slice(),
		running: () => !!timer,
		tick,
		dispose() {
			if (timer) X.T.clearInterval(timer)
			timer = null
			list.length = 0
			wanted = 0
		},
	}
}

module.exports = { createBots }
