'use strict'

/**
 * WO-1101 / WO-1102 — Stage Skirmish in the Game World (work/notes/game-world-contract.md §0). The world module and this
 * game never require each other: they meet in a process-global registry under a versioned Symbol.for key (§0.1; this
 * accessor is a copy of modules/game-world/server/world-link.js, deliberately not a require). Without the world module
 * (`reg.hub` null) nothing here runs.
 *   register(getGame) / unregister()   register.js: the descriptor (host / state functions, page paths, the soldier model)
 *   createSkWorld({ room, send, lights, now })   sk-game.js while a session is enabled: the room adapter (§0.2) —
 *     soldiers as world entities, the joined sockets as viewers, accepted hitscan shots → hub.shot (R4), effects →
 *     `xfx` (+ a stunned soldier's fires are dropped by the room for the stun), the causer's bonus (§6.3: every 3rd
 *     bonus +1 score, ≤ 2 per match; frags and the frag limit stay what they are).
 */

const { WEAPONS } = require('./sk-rules')
const G = require('./sk-grid')

const KEY = Symbol.for('highascg.game-world/1')
const registry = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const hubOf = () => registry().hub || null
const ID = 'sk'
const CAPS = [6, 12, 20]
const TEAM_COLORS = ['#ff4d3d', '#3aa0ff'] // client/sk-const.js TEAM_COLORS
const MUZZLE_U = 0.35
const BONUS_EVERY = 3
const BONUS_MAX = 2
const ACTING = new Set(['lobby', 'match'])

let mine = null

/** register.js: this game's descriptor in the registry (§0.1). getGame() → the process-wide game service. */
function register(getGame) {
	mine = {
		id: ID,
		title: 'Stage Skirmish',
		order: 2,
		scale: 0.1,
		paths: { play: '/game/sk/', spectate: '/game/sk/?spectate=1', host: '/game/sk/?host=1', state: '/api/game/sk/state', kit: '/game/sk/kit/',
			scene: '/api/game/sk/scene', glb: '/api/game/sk/scene.glb' },
		models: { soldier: '/game/sk/soldier-model.js' },
		host: (body) => getGame().host(body),
		state: () => getGame().state(),
		room: () => getGame().worldAdapter() || null,
		get hosting() {
			return require('./sk-hosting') // WO-1105 Settings ▸ Games: this game's main number, bots, pause in its own host bodies
		},
	}
	registry().games.set(ID, mine)
}

function unregister() {
	const reg = registry()
	if (reg.games.get(ID) === mine) reg.games.delete(ID)
	mine = null
}

/**
 * @param {{ room: () => object|null, send: (conn, msg) => void, lights?: object|null, now?: () => number }} deps
 */
function createSkWorld(deps) {
	const now = deps.now || Date.now
	const room = () => deps.room() || null
	const caps = new WeakMap()
	const bonuses = new Map() // pid → { key, n, pts } (key = the room's match serial: a new match starts the count again)

	const colorOf = (w, p) => (w.mode === 'tdm' && (p.team === 0 || p.team === 1) ? TEAM_COLORS[p.team] : p.color)
	const floorY = (w) => Number(w.arena?.y) || 0

	const adapter = {
		id: ID,
		entities(t = now()) {
			const r = room()
			const w = r?.world()
			if (!w?.arena) return []
			const y = floorY(w)
			const out = []
			for (const p of w.players.values()) {
				if (!p.alive || !p.pos || (!p.connected && !p.bot)) continue
				const f = (p.mv ? 1 : 0) | (p.protectUntil > t ? 4 : 0) | (p.surgeUntil > t ? 8 : 0) | (p.stunUntil > t ? 32 : 0)
				out.push({ k: 'soldier', id: p.id, p: [p.pos[0], y, p.pos[1]], yaw: p.yaw || 0, c: colorOf(w, p), n: p.name, f, s: p.held || 'pea',
					bot: !!p.bot, prot: p.protectUntil > t })
				if (out.length >= 10) break
			}
			return out
		},
		viewers() {
			const r = room()
			const w = r?.world()
			if (!w) return []
			const y = floorY(w)
			return w.conns.map((c) => {
				const p = c.spectator ? null : w.players.get(c.pid)
				return { key: c.conn, kind: c.spectator ? 'spectator' : 'player', p: p?.pos ? [p.pos[0], y, p.pos[1]] : null, cap: caps.get(c.conn) ?? 12 }
			})
		},
		send: (key, msg) => deps.send(key, msg),
		toAll: (msg) => room()?.toAll(msg),
		board() {
			const r = room()
			const w = r?.world()
			if (!w) return { phase: 'off', endsAt: null, top: [], players: 0, bots: 0 }
			const all = [...w.players.values()]
			const st = r.snapshot()
			const top = r.order().slice(0, 3).map((o) => ({ name: o.name, color: colorOf(w, w.players.get(o.id) || o), score: o.score, label: `${o.score}` }))
			return { phase: w.paused ? 'paused' : w.phase, endsAt: st.endsAt ?? null, top, players: all.filter((p) => !p.bot && p.connected).length,
				bots: all.filter((p) => p.bot).length }
		},
		apply(e) {
			const r = room()
			const w = r?.world()
			const p = w?.players.get(e.id)
			if (!p || !p.alive || w.paused || !ACTING.has(w.phase)) return false
			if (e.k === 'stun' && !e.soft) p.stunUntil = now() + Math.round(e.dur * 1000)
			const m = { t: 'xfx', k: e.k, id: e.id, dur: e.dur }
			if (Array.isArray(e.dir)) m.dir = e.dir
			if (e.c) m.c = e.c
			if (e.soft) m.soft = true
			if (e.by) m.by = { g: e.by.g, n: e.by.name || '' }
			r.toAll(m)
			return true
		},
		bonus(pid, kind) {
			const r = room()
			const w = r?.world()
			const p = w?.players.get(pid)
			if (!p || w.paused || !ACTING.has(w.phase)) return false
			const key = w.phase === 'match' ? w.matchNo : 'warm-up'
			let b = bonuses.get(pid)
			if (!b || b.key !== key) bonuses.set(pid, (b = { key, n: 0, pts: 0 }))
			b.n++
			let pts = 0
			if (w.phase === 'match' && b.n % BONUS_EVERY === 0 && b.pts < BONUS_MAX) {
				b.pts++
				pts = 1
				p.score += 1
				const X = r.ctx
				if (w.mode === 'tdm' && (p.team === 0 || p.team === 1)) X.teams[p.team] += 1
				X.scored()
			}
			if (p.conn) deps.send(p.conn, { t: 'xbonus', kind: String(kind || ''), pts })
			return true
		},
		pools() {
			const a = adapter.area()
			return a && deps.lights?.pools ? deps.lights.pools(a.y) : []
		},
		area() {
			const w = room()?.world()
			return w?.arena ? { rect: w.arena.rect.slice(), y: floorY(w) } : null
		},
		pause(on) {
			room()?.host('pause', { on: on === true })
		},
	}

	/** R4: an accepted hitscan `shot` (the room's tap) → the world referee, from the server's position and yaw. */
	function onShot(msg) {
		const h = hubOf()
		const W = WEAPONS[msg.w]
		const w = room()?.world()
		if (!h?.shot || !W || W.kind !== 'hitscan' || !w?.arena || !Array.isArray(msg.p)) return
		const u = w.u || 0.1
		const y = floorY(w) + MUZZLE_U * u
		const grid = w.grid
		try {
			h.shot({ g: ID, pid: msg.id, o: [msg.p[0], y, msg.p[1]], yaw: msg.yaw, range: W.range * u,
				los: (a, b) => !grid || G.lineClear(grid, a[0], a[2], b[0], b[2], true) })
		} catch {}
	}

	return {
		adapter,
		onShot,
		quality(conn, m) {
			const n = CAPS.includes(m?.n) ? m.n : 12
			caps.set(conn, n)
			try {
				hubOf()?.quality?.(ID, conn, n)
			} catch {}
		},
		attach() {
			try {
				hubOf()?.attach?.(adapter)
			} catch {}
		},
		detach() {
			try {
				hubOf()?.detach?.(ID)
			} catch {}
			bonuses.clear()
		},
	}
}

module.exports = { register, unregister, descriptor: () => mine, createSkWorld, ID }
