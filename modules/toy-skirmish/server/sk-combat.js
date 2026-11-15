'use strict'

/**
 * WO-1081 — Stage Skirmish: the referee (contract §3 / §5; pure — clock, timers and senders come in through the room's
 * context X). Health, armour, ammo, weapons held, kills, deaths, score, pickups and respawns are decided here; movement
 * and aiming are the browsers'. Every rule, in the order it is checked:
 *   fire  alive, phase lobby / match, holds the weapon, has ammo, its interval passed (10 % tolerance), a new `n`
 *         → ammo − 1, spawn protection ends, `shot` to everyone (seed for the spread), `me` to the shooter
 *   hit   both alive; victim not spawn-protected, not the shooter, not a team-mate in tdm; fire `n` is a hitscan shot of
 *         ≤ 1.5 s ago with hits left (1, scatter 8 pellets); server positions ≤ range + 3 u apart; the line between them
 *         crosses no solid cell of the grid shrunk by one cell → damage (× 2 with surge), armour takes 60 % while it lasts
 *   boom  a Thumper fire of ≤ 4.5 s ago, not yet resolved; the impact within 1 u of the fire ray, not behind it, not
 *         farther than 22 u/s × the time since the shot (+ 1 u) → splash from the server's positions, linear 90 → 0 over
 *         4 u, no line of sight needed, the owner × 0.5 (no surge on himself), team-mates spared in tdm
 *   pick  alive, phase lobby / match, the pickup is there, server position within 0.5 u (+ 0.5 u slack: it is ≤ 50 ms
 *         old) → weapon / ammo (refused when held at max), health +35 (not at 100), armour +50 (not at 100), surge 20 s
 * Kills: score = kills − suicides (tdm: the team total moves the same way); nothing is scored outside a match; lobby
 * deaths respawn at once, match deaths after 3 s, at the spawn farthest from enemies, with 1.5 s protection.
 */

const { WEAPONS, ROCKET, PICKUPS, RULES, dirOf } = require('./sk-rules')
const G = require('./sk-grid')

/** @param {object} X the room context (sk-room.js) */
function createCombat(X) {
	const u = () => X.u
	const now = () => X.now()
	const pk = new Map() // pickup id → until (taken)

	const surging = (p) => p.surgeUntil > now()
	const meOf = (p) => ({ t: 'me', hp: p.hp, ar: p.ar, w: { ...p.w }, surge: surging(p) ? p.surgeUntil : 0 })
	const sendMe = (p) => {
		if (!p.bot) X.toPlayer(p, meOf(p))
	}

	/** Fresh soldier: Peashooter only, 100 / 0. */
	function reset(p) {
		p.hp = RULES.health
		p.ar = 0
		p.w = { pea: -1 }
		p.held = 'pea'
		p.surgeUntil = 0
		p.fires = new Map()
		p.lastFire = {}
	}

	function clearRespawn(p) {
		if (p.respawnTimer) X.T.clearTimeout(p.respawnTimer)
		p.respawnTimer = null
	}

	const isEnemy = (p, q) => q !== p && (X.mode() !== 'tdm' || q.team !== p.team)

	/** The spawn farthest from enemies (and not on top of anyone); `others` overrides who counts. */
	function chooseSpawn(p, others) {
		const A = X.arena
		if (!A || !A.spawns.length) return null
		let list = X.mode() === 'tdm' ? A.spawns.filter((s) => s.team === p.team) : A.spawns
		if (!list.length) list = A.spawns
		const live = [...X.players.values()].filter((q) => q !== p && q.alive && q.pos)
		const enemies = others || live.filter((q) => isEnemy(p, q))
		const free = list.filter((s) => !live.some((q) => Math.hypot(q.pos[0] - s.x, q.pos[1] - s.z) < 1 * u()))
		const pool = free.length ? free : list
		if (!enemies.length) return pool[Math.floor(X.rng() * pool.length)]
		let best = null, bestD = -1
		for (const s of pool) {
			let d = Infinity
			for (const q of enemies) if (q.pos) d = Math.min(d, Math.hypot(q.pos[0] - s.x, q.pos[1] - s.z))
			if (d > bestD) (best = s), (bestD = d)
		}
		return best
	}

	/** (Re)spawn p now. opts.until: protection end (default now + 1.5 s); opts.others: who to stay away from. */
	function spawn(p, opts = {}) {
		clearRespawn(p)
		const s = chooseSpawn(p, opts.others)
		reset(p)
		p.alive = !!s
		p.pos = s ? [s.x, s.z] : null
		p.yaw = s ? s.yaw : 0
		p.mv = 0
		p.moveAt = now()
		p.protectUntil = opts.until ?? now() + RULES.protectMs
		if (s) X.toAll({ t: 'spawn', id: p.id, p: [s.x, s.z], yaw: s.yaw, until: p.protectUntil })
		sendMe(p)
		X.dirty()
	}

	/** Everyone (connected or a bot) respawns; spread = the countdown's placement (away from everyone already placed). */
	function spawnAll(opts = {}) {
		const placed = []
		for (const p of [...X.players.values()].sort((a, b) => a.id - b.id)) {
			if (!p.connected && !p.bot) continue
			p.alive = false
			p.pos = null
		}
		for (const p of [...X.players.values()].sort((a, b) => a.id - b.id)) {
			if (!p.connected && !p.bot) continue
			spawn(p, { until: opts.until, others: opts.spread ? placed : undefined })
			if (p.alive) placed.push(p)
		}
	}

	function kill(v, by, w) {
		v.alive = false
		v.hp = 0
		v.surgeUntil = 0
		v.mv = 0
		X.toAll({ t: 'kill', id: v.id, by: by.id, w, at: now() })
		if (X.phase() === 'match') {
			v.deaths++
			if (by === v || (X.mode() === 'tdm' && by.team === v.team)) {
				by.suicides++
				by.score--
				if (X.mode() === 'tdm' && (by.team === 0 || by.team === 1)) X.teams[by.team]--
			} else {
				by.kills++
				by.score++
				if (X.mode() === 'tdm' && (by.team === 0 || by.team === 1)) X.teams[by.team]++
			}
			X.scored()
		}
		X.dirty()
		if (X.phase() === 'lobby') return spawn(v)
		if (X.phase() !== 'match') return
		clearRespawn(v)
		v.respawnTimer = X.T.setTimeout(() => {
			v.respawnTimer = null
			if (X.phase() === 'match' || X.phase() === 'lobby') spawn(v)
		}, RULES.respawnMs)
	}

	/** dmg (already multiplied) from `by` with weapon w; armour absorbs 60 % while it lasts. */
	function damage(v, by, w, dmg) {
		const d = Math.max(0, Math.round(dmg))
		if (!d || !v.alive) return
		const absorbed = Math.min(v.ar, Math.round(d * RULES.absorb))
		v.ar -= absorbed
		v.hp = Math.max(0, v.hp - (d - absorbed))
		X.toAll({ t: 'dmg', id: v.id, by: by.id, w, hp: v.hp, ar: v.ar })
		sendMe(v)
		if (v.hp <= 0) kill(v, by, w)
	}

	const canAct = () => X.phase() === 'lobby' || X.phase() === 'match'

	/** A `fire` (cleaned). → the fire record or null (dropped silently). */
	function fire(p, m) {
		const W = WEAPONS[m.w]
		if (!W || !canAct() || !p.alive || !X.arena) return null
		const ammo = p.w[m.w]
		if (ammo === undefined || ammo === 0) return null
		const t = now()
		const last = p.lastFire[m.w]
		if (last != null && t - last < W.interval * 1000 * (1 - RULES.intervalTol)) return null
		for (const [n, f] of p.fires) if (t - f.at > ROCKET.expireMs) p.fires.delete(n)
		if (p.fires.has(m.n)) return null
		if (ammo > 0) p.w[m.w] = ammo - 1
		p.lastFire[m.w] = t
		p.held = m.w
		if (p.protectUntil > t) p.protectUntil = t // protection ends on the first shot
		const r = X.arena.rect, s = RULES.posSlack * u()
		const inside = m.p[0] >= r[0] - s && m.p[0] <= r[2] + s && m.p[1] >= r[1] - s && m.p[1] <= r[3] + s
		const at = inside ? m.p : p.pos
		const rec = { n: m.n, w: m.w, at: t, left: W.pellets, p: at, yaw: m.yaw, seed: Math.floor(X.rng() * 2147483647), done: false }
		p.fires.set(m.n, rec)
		X.toAll({ t: 'shot', id: p.id, w: m.w, n: m.n, p: at, yaw: m.yaw, ts: t, seed: rec.seed })
		if (ammo > 0) sendMe(p)
		X.dirty()
		return rec
	}

	/** A `hit` (cleaned) claimed by shooter p. → true when damage was applied. */
	function hit(p, m) {
		const v = X.players.get(m.id)
		const rec = p.fires.get(m.n)
		const t = now()
		if (!v || v === p || !p.alive || !v.alive || !p.pos || !v.pos || !X.grid) return false
		if (v.protectUntil > t) return false
		if (X.mode() === 'tdm' && v.team === p.team) return false
		if (!rec || WEAPONS[rec.w].kind !== 'hitscan' || t - rec.at > RULES.fireWindowMs || rec.left <= 0) return false
		const W = WEAPONS[rec.w]
		if (Math.hypot(v.pos[0] - p.pos[0], v.pos[1] - p.pos[1]) > (W.range + RULES.hitSlack) * u()) return false
		if (!G.lineClear(X.grid, p.pos[0], p.pos[1], v.pos[0], v.pos[1], true)) return false
		const k = Math.min(m.k, rec.left)
		rec.left -= k
		damage(v, p, rec.w, W.dmg * k * (surging(p) ? 2 : 1))
		return true
	}

	/** A `boom` (cleaned) reported by the rocket's owner p. → true when the splash was applied. */
	function boom(p, m) {
		const rec = p.fires.get(m.n)
		const t = now()
		if (!rec || rec.w !== 'thumper' || rec.done || t - rec.at > ROCKET.expireMs || !X.arena) return false
		const [dx, dz] = dirOf(rec.yaw)
		const ex = m.p[0] - rec.p[0], ez = m.p[1] - rec.p[1]
		const along = ex * dx + ez * dz, side = Math.abs(ex * dz - ez * dx)
		const reach = Math.min(ROCKET.speed * ROCKET.life, (ROCKET.speed * (t - rec.at)) / 1000)
		if (side > ROCKET.rayTol * u() || along < -ROCKET.rayTol * u() || along > (reach + ROCKET.rayTol) * u()) return false
		rec.done = true
		X.toAll({ t: 'boom', by: p.id, n: m.n, p: m.p, ts: t })
		const R = ROCKET.splash * u()
		for (const v of [...X.players.values()]) {
			if (!v.alive || !v.pos || v.protectUntil > t) continue
			if (v !== p && X.mode() === 'tdm' && v.team === p.team) continue
			const d = Math.hypot(v.pos[0] - m.p[0], v.pos[1] - m.p[1])
			if (d >= R) continue
			const base = WEAPONS.thumper.dmg * (1 - d / R)
			damage(v, p, 'thumper', v === p ? base * ROCKET.self : base * (surging(p) ? 2 : 1))
		}
		return true
	}

	/** A `pick` (cleaned). → true when taken. */
	function pick(p, m) {
		const A = X.arena
		const it = A?.pickups?.[m.id]
		const t = now()
		if (!it || !canAct() || !p.alive || !p.pos || (pk.get(it.id) || 0) > t) return false
		if (Math.hypot(p.pos[0] - it.x, p.pos[1] - it.z) > (RULES.pickRadius + RULES.pickSlack) * u()) return false
		const kind = it.kind
		if (WEAPONS[kind]) {
			const W = WEAPONS[kind]
			const have = p.w[kind]
			if (have !== undefined && have >= W.max) return false
			p.w[kind] = Math.min(W.max, (have || 0) + W.pickup)
		} else if (kind === 'health') {
			if (p.hp >= RULES.maxHealth) return false
			p.hp = Math.min(RULES.maxHealth, p.hp + PICKUPS.health.amount)
		} else if (kind === 'armour') {
			if (p.ar >= RULES.maxArmour) return false
			p.ar = Math.min(RULES.maxArmour, p.ar + PICKUPS.armour.amount)
		} else if (kind === 'surge') {
			p.surgeUntil = t + PICKUPS.surge.duration * 1000
			X.dirty()
		} else return false
		const until = t + PICKUPS[kind].respawn * 1000
		pk.set(it.id, until)
		X.toAll({ t: 'pk', id: it.id, by: p.id, until })
		sendMe(p)
		return true
	}

	return {
		reset,
		spawn,
		spawnAll,
		fire,
		hit,
		boom,
		pick,
		clearRespawn,
		meOf,
		/** Pickups gone right now: [[id, until]]. */
		pkList: () => [...pk].filter(([, until]) => until > now()).sort((a, b) => a[0] - b[0]),
		available: (id) => (pk.get(id) || 0) <= now(),
		resetPickups: () => pk.clear(),
	}
}

module.exports = { createCombat }
