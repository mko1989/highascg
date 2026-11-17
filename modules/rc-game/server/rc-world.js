'use strict'

/**
 * WO-1101 / WO-1102 — the RC game in the Game World (work/notes/game-world-contract.md §0). The world module and this
 * game never require each other: they meet in a process-global registry under a versioned Symbol.for key (§0.1; this
 * accessor is a copy of modules/game-world/server/world-link.js, deliberately not a require). Without the world module
 * (`reg.hub` null) nothing here runs: no timer, no message, no state field.
 *   register(getGame) / unregister()   register.js: the descriptor (host / state functions, page paths, the car model)
 *   createRcWorld({ room, send, lights, now })   rc-game.js while a session is enabled: the room adapter (§0.2) —
 *     cars as world entities, the joined sockets as viewers, effects → `xfx`, the causer's bonus → a mini-boost;
 *     patches() → the live R2 slick patches for the server's bots (WO-1106 A35).
 */

const { RC_SCALE } = require('./rc-scale')

const KEY = Symbol.for('highascg.game-world/1')
const registry = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const hubOf = () => registry().hub || null
const ID = 'rc'
const CAPS = [6, 12, 20]
const BONUS_GAP_MS = 3000 // ≤ 1 mini-boost per 3 s per car (§6.3)
const DRIVING = new Set(['lobby', 'race'])

let mine = null

/** register.js: this game's descriptor in the registry (§0.1). getGame() → the process-wide game service. */
function register(getGame) {
	mine = {
		id: ID,
		title: 'Stage Sprint RC',
		order: 1,
		scale: RC_SCALE,
		paths: { play: '/game/rc/', spectate: '/game/rc/?spectate=1', host: '/game/rc/?host=1', state: '/api/game/rc/state', kit: '/game/rc/',
			scene: '/api/game/rc/scene', glb: '/api/game/rc/scene.glb' },
		models: { car: '/game/rc/car-model.js' },
		host: (body) => getGame().host(body),
		state: () => getGame().state(),
		room: () => getGame().worldAdapter() || null,
		get hosting() {
			return require('./rc-hosting') // WO-1105 Settings ▸ Games: this game's main number, bots, pause in its own host bodies
		},
	}
	registry().games.set(ID, mine)
}

function unregister() {
	const reg = registry()
	if (reg.games.get(ID) === mine) reg.games.delete(ID)
	mine = null
}

const fmtMs = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

/** An effect (§6.2) → the `xfx` message every RC socket gets; the car's own client (or bot) applies the physics. */
function xfxMsg(e) {
	const m = { t: 'xfx', k: e.k, id: e.id, dur: e.dur }
	if (Array.isArray(e.dir)) m.dir = e.dir
	if (e.c) m.c = e.c
	if (e.soft) m.soft = true
	if (e.by) m.by = { g: e.by.g, n: e.by.name || '' }
	return m
}

/**
 * @param {{ room: () => object|null, send: (conn, msg) => boolean|void, lights?: object|null, now?: () => number }} deps
 *   room: the live rc-room (null after a disable); send: the service's sender (bots: their virtual socket)
 */
function createRcWorld(deps) {
	const now = deps.now || Date.now
	const room = () => deps.room() || null
	const caps = new WeakMap() // conn → the client's visitor cap (`wq`)
	const resync = new WeakSet() // WO-1106 A32: sockets left out of one viewers() call — the hub forgets the view, then serves it afresh
	const lastBoost = new Map()

	const adapter = {
		id: ID,
		entities() {
			const r = room()
			if (!r) return []
			const out = []
			for (const p of r.world().players.values()) {
				if (!p.connected || !p.car) continue
				const c = p.car
				out.push({ k: 'car', id: p.id, p: [c[0], c[1], c[2]], yaw: c[3], c: p.color, n: p.name, f: c[6] | 0, s: '', bot: !!p.bot, spd: Math.abs(c[4]) })
				if (out.length >= 10) break
			}
			return out
		},
		viewers() {
			const r = room()
			if (!r) return []
			const w = r.world()
			return w.conns.filter((c) => !c.conn?.botSink && !resync.delete(c.conn)).map((c) => {
				const p = c.spectator ? null : w.players.get(c.pid)
				return { key: c.conn, kind: c.spectator ? 'spectator' : 'player', p: p?.car ? [p.car[0], p.car[1], p.car[2]] : null, cap: caps.get(c.conn) ?? 12 }
			})
		},
		send: (key, msg) => deps.send(key, msg) !== false, // WO-1106 A5: false = skipped (closed / backpressure), the hub re-sends
		toAll: (msg) => room()?.toAll(msg),
		board() {
			const r = room()
			if (!r) return { phase: 'off', endsAt: null, top: [], players: 0, bots: 0 }
			const w = r.world()
			const all = [...w.players.values()]
			const top = r.order().slice(0, 3).map((o) => ({ name: o.name, color: w.players.get(o.id)?.color || '#cccccc', score: o.laps,
				label: o.totalMs != null ? fmtMs(o.totalMs) : `lap ${o.laps}` }))
			return { phase: w.paused ? 'paused' : w.phase, endsAt: null, top, players: all.filter((p) => !p.bot && p.connected).length, bots: all.filter((p) => p.bot).length }
		},
		apply(e) {
			const r = room()
			const p = r?.world().players.get(e.id)
			if (!p || !p.connected || !p.car || !DRIVING.has(r.world().phase) || r.world().paused) return false
			r.toAll(xfxMsg(e))
			return true
		},
		bonus(pid, kind) {
			const r = room()
			const w = r?.world()
			const p = w?.players.get(pid)
			const t = now()
			if (!p || !p.connected || !DRIVING.has(w.phase) || w.paused || t - (lastBoost.get(pid) || 0) < BONUS_GAP_MS) return false
			lastBoost.set(pid, t)
			r.toAll({ t: 'xfx', k: 'boost', id: pid, dur: 0.4 })
			if (p.conn) deps.send(p.conn, { t: 'xbonus', kind: String(kind || ''), pts: 0 })
			return true
		},
		pools() {
			const a = adapter.area()
			return a && deps.lights?.pools ? deps.lights.pools(a.y) : []
		},
		/** The track in play (its points' box + 0.5 m), else the cars' box + 1 m. */
		area() {
			const r = room()
			if (!r) return null
			const w = r.world()
			const pts = (w.track?.points || []).filter((q) => Array.isArray(q) && q.length >= 3 && q.every(Number.isFinite)) // [x, y, z] (scene tracks)
			if (pts.length) {
				const b = [Infinity, Infinity, -Infinity, -Infinity]
				for (const [x, , z] of pts) (b[0] = Math.min(b[0], x)), (b[1] = Math.min(b[1], z)), (b[2] = Math.max(b[2], x)), (b[3] = Math.max(b[3], z))
				return { rect: [b[0] - 0.5, b[1] - 0.5, b[2] + 0.5, b[3] + 0.5], y: Math.min(...pts.map((q) => q[1])) }
			}
			const cars = adapter.entities()
			if (!cars.length) return null
			const xs = cars.map((c) => c.p[0]), zs = cars.map((c) => c.p[2])
			return { rect: [Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1], y: Math.min(...cars.map((c) => c.p[1])) }
		},
		pause(on) {
			room()?.host('pause', { on: on === true })
		},
	}

	return {
		adapter,
		/** `{ t: 'wq', n }` from a socket: its visitor cap; `re: true` = the page's pre-load queue overflowed: re-send its whole view (A32). */
		quality(conn, m) {
			if (m?.re === true) {
				resync.add(conn)
				if (!CAPS.includes(m.n)) return // the cap stays as it was
			}
			const n = CAPS.includes(m?.n) ? m.n : 12
			caps.set(conn, n)
			try {
				hubOf()?.quality?.(ID, conn, n)
			} catch {}
		},
		/**
		 * WO-1106 A35: the live R2 slick patches for the server's bots [{ x, y, z, r, until }] (hub.patches; [] without
		 * the world module, while safe, or while this game's affect is not 'on') — the players' pages get the same splats.
		 */
		patches() {
			try {
				const list = hubOf()?.patches?.(ID)
				return Array.isArray(list) ? list : []
			} catch {
				return []
			}
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
			lastBoost.clear()
		},
	}
}

module.exports = { register, unregister, descriptor: () => mine, createRcWorld, xfxMsg, ID }
