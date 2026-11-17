'use strict'

/**
 * WO-1125 — players run a game session themselves (work/notes/game-self-service-contract.md §2–§3): the one rule set of
 * the three games. rc-game.js requires it; Stage Skirmish and Stage Salad reach it through their kit (sk-kit.js /
 * salad-kit.js `createGameCtl`), so no game requires the world and the world requires no game. Pure: clock, sender, the
 * game service's own host() and the room view are injected; no timer, nothing held per socket but a WeakMap.
 *
 *   self (runtime, default false — a module alone is unchanged): host action `{ action: 'self', on }`, sent by the core
 *     (src/games, `games.selfService`) to every loaded game; `state.self` tells the pages to show the session panel.
 *   held: the last operator host action was `disable` (Settings ▸ Games, a host page, the world's host page) — the core
 *     re-opens a closed session only while this is false; `enable` clears it. Memory only (a restart forgets it).
 *   ctl from a player's socket: { t: 'ctl', a: 'start' | 'stop' | 'bots' | 'set', n?, level?, k?, v? }
 *     refused with { t: 'ctl', ok: false, a, error } — 'slow' (> 4 in 2 s from the socket), 'host' (self off),
 *     'seat' (a spectator / not seated / not connected), 'bad' (unknown action / key / value, or the game's host() refused
 *     it: then `msg` carries its text), 'paused' (pause / presenter safe), 'running' (not lobby / results; `stop` outside
 *     results). Never a socket close. Accepted → the game's host() bodies in order (the operator's code path, so every
 *     validation and cap applies) → { t: 'ctl', ok: true, a } to the sender, the state to everyone through the room's
 *     normal push, one info line `[<game>] <name> (#id): <what>`. `stop` in the lobby is a no-op answered ok.
 */

const IDLE = new Set(['lobby', 'results'])
const LEVELS = ['easy', 'normal', 'hard']
const RATE_N = 4
const RATE_MS = 2000
const MAX_N = 64 // a shape bound only; each game's host() keeps its own bot cap

/** The sender's player in a room view ({ conns: [{ conn, pid, spectator, joined }], players: Map }) or null. */
function seatOf(world, conn) {
	const c = Array.isArray(world?.conns) ? world.conns.find((x) => x.conn === conn) : null
	if (!c || c.joined === false || c.spectator) return null
	const p = world.players && typeof world.players.get === 'function' ? world.players.get(c.pid) : null
	return p && !p.bot && p.connected !== false ? p : null
}

/**
 * @param {{ game: string, send: (conn: object, msg: object) => void, host: (body: object) => { status: number, body: object },
 *   world: () => object|null, keys: Record<string, (v: unknown) => object[]|null>, bots: (n: number, level?: string) => object[],
 *   log?: Function, now?: () => number }} o
 *   world: the room view (phase, paused / safe, conns, players) or null while closed; keys: the game's `set` whitelist,
 *   value → host bodies (null = bad value); bots: count + optional level → host bodies.
 */
function createGameCtl(o) {
	const log = o.log || (() => {})
	const now = o.now || Date.now
	const recent = new WeakMap() // socket → ctl times in the last RATE_MS
	let self = false
	let held = false

	function slow(conn) {
		const t = now()
		const list = (recent.get(conn) || []).filter((x) => t - x < RATE_MS)
		list.push(t)
		recent.set(conn, list)
		return list.length > RATE_N
	}

	/** A ctl message → { bodies, label } | 'noop' | null (bad). */
	function shape(m, phase) {
		switch (m.a) {
			case 'start':
				return { bodies: [{ action: 'start' }], label: 'start' }
			case 'stop':
				return phase === 'lobby' ? 'noop' : { bodies: [{ action: 'stop' }], label: 'stop' }
			case 'bots': {
				if (!Number.isInteger(m.n) || m.n < 0 || m.n > MAX_N) return null
				if (m.level != null && !LEVELS.includes(m.level)) return null
				return { bodies: o.bots(m.n, m.level ?? undefined), label: `bots ${m.n}${m.level ? ` ${m.level}` : ''}` }
			}
			case 'set': {
				if (typeof m.k !== 'string' || !Object.hasOwn(o.keys, m.k)) return null
				const bodies = o.keys[m.k](m.v)
				return Array.isArray(bodies) && bodies.length ? { bodies, label: `set ${m.k} ${String(m.v).slice(0, 32)}` } : null
			}
			default:
				return null
		}
	}

	/** One `ctl` message from a game socket (the service's message handler, after its own parse + rate limit). */
	function handle(conn, m) {
		const a = typeof m?.a === 'string' ? m.a.slice(0, 16) : ''
		const no = (error, msg) => (
			o.send(conn, { t: 'ctl', ok: false, a, error, ...(msg ? { msg: String(msg).slice(0, 120) } : {}) }),
			error
		)
		if (slow(conn)) return no('slow')
		if (!self) return no('host')
		const w = o.world()
		const p = w ? seatOf(w, conn) : null
		if (!p) return no('seat')
		const phase = String(w.phase || 'lobby')
		const s = shape(m, phase)
		if (!s) return no('bad')
		if (w.paused === true || w.safe === true) return no('paused')
		if (!IDLE.has(phase)) return no('running') // `stop` too: it never ends a running round
		if (s === 'noop') return (o.send(conn, { t: 'ctl', ok: true, a }), 'ok')
		for (const body of s.bodies) {
			let r
			try {
				r = o.host(body)
			} catch (e) {
				r = { status: 500, body: { ok: false, error: e?.message || 'failed' } }
			}
			if (!(Number(r?.status) < 300) || r?.body?.ok === false) return no('bad', r?.body?.error || 'refused')
		}
		log('info', `[${o.game}] ${p.name} (#${p.id}): ${s.label}`)
		o.send(conn, { t: 'ctl', ok: true, a })
		return 'ok'
	}

	/** Host action `{ action: 'self', on }` → { status, body } (accepted with or without an open session). */
	function hostSelf(a, state, push) {
		if (typeof a?.on !== 'boolean')
			return { status: 400, body: { ok: false, error: '`on` must be true or false', state: state() } }
		if (a.on !== self) {
			self = a.on
			push()
		}
		return { status: 200, body: { ok: true, state: state() } }
	}

	/** Every host action passes here: `disable` holds the session closed for the core's re-open, `enable` lets go. */
	function note(action) {
		if (action === 'disable') held = true
		else if (action === 'enable') held = false
	}

	return { handle, hostSelf, note, self: () => self, held: () => held }
}

/** A whole number in [lo, hi] → the value, else null. */
const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null)

module.exports = { createGameCtl, seatOf, intIn, LEVELS, RATE_N, RATE_MS, IDLE }
