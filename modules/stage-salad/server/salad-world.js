'use strict'

/**
 * WO-1101 / WO-1102 — Stage Salad in the Game World (work/notes/game-world-contract.md §0). The world module and this
 * game never require each other: they meet in a process-global registry under a versioned Symbol.for key (§0.1; this
 * accessor is a copy of modules/game-world/server/world-link.js, deliberately not a require). Without the world module
 * (`reg.hub` null) nothing here runs and the flights are stepped exactly as before.
 *   register(getGame) / unregister()   register.js: the descriptor (host / state functions, page paths, the models)
 *   createSaladWorld({ room, send, lights, now })   salad-game.js while a session is enabled: the room adapter (§0.2) —
 *     vegetables in flight, slingshots and the presenter avatars as world entities, the joined sockets as viewers; the
 *     flight hooks (`hooks()` → the hub's colliders / contact / landed, salad-shots.js); R7 "make way" on an avatar;
 *     the causer's bonus = points in a round (§6.3).
 */

const KEY = Symbol.for('highascg.game-world/1')
const registry = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const hubOf = () => registry().hub || null
const ID = 'salad'
const CAPS = [6, 12, 20]
const MAX_VEG = 30
const BONUS_PTS = { hit: 15, bounce: 15, scatter: 5, spot: 10 }
/** A tracking trait colour [r, g, b] 0–255 (avatar-body.js rgb()) → '#rrggbb'; the neutral shirt otherwise. */
const hex = (rgb) => (Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => typeof v === 'number' && v >= 0 && v <= 255)
	? `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}` : '#c9b9a6')

let mine = null

/** register.js: this game's descriptor in the registry (§0.1). getGame() → the process-wide game service. */
function register(getGame) {
	mine = {
		id: ID,
		title: 'Stage Salad',
		order: 3,
		scale: 1,
		paths: { play: '/game/salad/', spectate: '/game/salad/?spectate=1', host: '/game/salad/?host=1', state: '/api/game/salad/state',
			kit: '/game/salad/kit/', scene: '/api/game/salad/scene', glb: '/api/game/salad/scene.glb' },
		models: { veg: '/game/salad/veg-models.js', sling: '/game/salad/slingshot-model.js', av: '/game/salad/avatar-model.js' },
		host: (body) => getGame().host(body),
		state: () => getGame().state(),
		room: () => getGame().worldAdapter() || null,
	}
	registry().games.set(ID, mine)
}

function unregister() {
	const reg = registry()
	if (reg.games.get(ID) === mine) reg.games.delete(ID)
	mine = null
}

/** The bonus a referee rule gives here (points, round only): by the rule's kind name or number. */
function bonusPts(kind) {
	const k = String(kind || '').toLowerCase()
	if (k.includes('scatter') || k === 'r5') return BONUS_PTS.scatter
	if (k.includes('spot') || k === 'r9') return BONUS_PTS.spot
	return BONUS_PTS.hit
}

/**
 * @param {{ room: () => object|null, send: (conn, msg) => void, lights?: object|null, now?: () => number }} deps
 */
function createSaladWorld(deps) {
	const now = deps.now || Date.now
	const room = () => deps.room() || null
	const caps = new WeakMap()

	const adapter = {
		id: ID,
		entities(t = now()) {
			const r = room()
			const w = r?.world()
			if (!w?.venue) return []
			const out = []
			for (const { rec, f } of r.shots.flights().slice(-MAX_VEG)) {
				out.push({ k: 'veg', id: rec.p.id * 100000 + (rec.n % 10000) * 10 + (f.i | 0), p: f.p.slice(), v: f.v.slice(), yaw: 0, c: rec.veg.color,
					n: rec.p.name, f: 0, s: rec.veg.id, bot: !!rec.p.bot })
			}
			for (const p of w.players.values()) {
				const slot = p.slot != null ? w.venue.slots[p.slot] : null
				if (!slot || (!p.connected && !p.bot)) continue
				out.push({ k: 'sling', id: p.id, p: slot.p.slice(), yaw: p.aim ? p.aim[0] : slot.yaw, c: p.color, n: p.name, f: 0, s: Math.round((p.pull || 0) * 100), bot: !!p.bot })
			}
			const info = new Map(r.presenters.list().map((a) => [a.tid, a]))
			for (const [tid, x, y, z, yaw, height, flags] of r.presenters.wire(t)) {
				const d = r.presenters.dodgeOf(tid)
				const live = d && t >= d.from && t <= d.until
				const { look: colours = null, ...a } = info.get(tid) || {}
				out.push({ k: 'av', id: tid, p: [x, y, z], yaw, c: hex(colours?.top), n: a?.dummy ? 'Stand-in' : a?.name || '', f: flags | (live && d.kind === 'duck' ? 16 : 0) | (live && d.kind === 'step' ? 32 : 0),
					s: Math.round(height * 100), dx: live && d.kind === 'step' ? d.dx : null })
			}
			return out
		},
		viewers() {
			const r = room()
			const w = r?.world()
			if (!w) return []
			return w.conns.map((c) => {
				const p = c.spectator ? null : w.players.get(c.pid)
				const slot = p?.slot != null && w.venue ? w.venue.slots[p.slot] : null
				return { key: c.conn, kind: c.spectator ? 'spectator' : 'player', p: slot ? slot.p.slice() : null, cap: caps.get(c.conn) ?? 12 }
			})
		},
		send: (key, msg) => deps.send(key, msg),
		toAll: (msg) => room()?.ctx.toAll(msg),
		board() {
			const r = room()
			const w = r?.world()
			if (!w) return { phase: 'off', endsAt: null, top: [], players: 0, bots: 0 }
			const all = [...w.players.values()]
			const st = r.snapshot()
			const top = r.order().slice(0, 3).map((o) => ({ name: o.name, color: w.players.get(o.id)?.color || '#cccccc', score: o.score, label: `${o.score}` }))
			return { phase: w.safe ? 'paused' : w.phase, endsAt: st.endsAt ?? null, top, players: all.filter((p) => !p.bot && p.connected).length,
				bots: all.filter((p) => p.bot).length }
		},
		/** Only the avatar's R7 "make way" lands here (Salad has no cars or soldiers); `dir` = [x, z] away from the car. */
		apply(e) {
			const r = room()
			if (!r || e.k !== 'step' || e.soft || r.world().safe) return false
			if (!Array.isArray(e.dir) || e.dir.length < 2 || !r.presenters.has(e.id)) return false
			return !!r.presenters.makeWay(e.id, e.dir)
		},
		bonus(pid, kind) {
			const r = room()
			const w = r?.world()
			const p = w?.players.get(pid)
			if (!p || w.safe) return false
			const pts = w.phase === 'round' ? bonusPts(kind) : 0
			if (pts) {
				p.score += pts
				r.ctx.scored()
			}
			if (p.conn) {
				deps.send(p.conn, { t: 'xbonus', kind: String(kind || ''), pts })
				deps.send(p.conn, { t: 'me', ready: p.readyAt, streak: p.streak, score: p.score })
			}
			return true
		},
		pools() {
			const v = room()?.world().venue
			return v?.hall && deps.lights?.pools ? deps.lights.pools(v.hall.y) : []
		},
		/** The stage (rain falls in front of the presenter), else the hall. */
		area() {
			const v = room()?.world().venue
			const fl = v?.stage || v?.hall
			return fl?.rect ? { rect: fl.rect.slice(), y: Number(fl.y) || 0 } : null
		},
		pause(on) {
			room()?.host('safe', { on: on === true })
		},
	}

	/** salad-shots.js X.xw(): the hub's flight hooks, or null without the world (flights then step exactly as before). */
	const hooks = {
		colliders: () => {
			try {
				const c = hubOf()?.colliders?.(ID)
				return Array.isArray(c) ? c : []
			} catch {
				return [] // a throwing world never reaches the room's 30 Hz tick
			}
		},
		contact: (q) => {
			try {
				return hubOf()?.contact?.(q)
			} catch {
				return null
			}
		},
		landed: (q) => {
			try {
				hubOf()?.landed?.(q)
			} catch {}
		},
	}

	return {
		adapter,
		hooks: () => (hubOf() ? hooks : null),
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
		},
	}
}

module.exports = { register, unregister, createSaladWorld, ID }
