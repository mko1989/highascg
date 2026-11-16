'use strict'

/**
 * WO-1101 / WO-1102 — the Game World service: `state()` (GET /api/game/world/state) and `host(body)` (POST
 * /api/game/world/host), work/notes/game-world-contract.md §3–§4. It never requires a game: it calls the registered
 * descriptors' own `host()` / `state()` / `room()` (the very functions the games' routes call), each in try/catch.
 *
 * Host actions (body `{ action, … }`) → { status, body: { ok, action, results?: { id: { ok, status, error? } }, state } }:
 *   enable {game?} / disable {game?}   one game or every registered game (descriptor host({ action }))
 *   start {game?} / stop {game?}       one or every ENABLED game; a game that refuses is reported, the others still go
 *   bots {game, n}                     in the game's own shape: rc { action: 'bots', count }, sk / salad { action: 'bots', n }
 *   safe {on}                          presenter safe: salad { action: 'safe', on }, rc / sk (any other) { action: 'pause', on }
 *                                      to every enabled game + the hub's safe (ends events, stops every effect); a game
 *                                      enabled while safe gets the same right after its enable
 *   lights {on} / wall {on}            passed to every enabled game as is
 *   house {level 0..1}                 passed to every enabled game (`on` true / false accepted as 1 / 0)
 *   affect {game, mode}                'on' | 'soft' | 'off' (WO-1102 "others can affect this game")
 *   event {kind: 'rain'|'spot'|'none', secs 5–60}   rain default 10 s, spot 30 s; refused while safe
 */

const GAME_ID = /^[a-z][a-z0-9-]{0,15}$/
const MODES = ['on', 'soft', 'off']
const EVENT_DEFAULT = Object.freeze({ rain: 10, spot: 30 })

/**
 * @param {{ hub: object, registry: { games: Map } }} deps
 */
function createWorldService({ hub, registry: reg }) {
	const world = { house: null, lights: null, wall: null }

	const call = (fn, dflt = null) => {
		try {
			const r = fn()
			return r === undefined ? dflt : r
		} catch {
			return dflt
		}
	}
	const descs = () =>
		[...reg.games.values()]
			.filter((d) => d && typeof d.id === 'string' && GAME_ID.test(d.id) && typeof d.host === 'function')
			.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.id < b.id ? -1 : 1))
	const roomOf = (d) => (typeof d.room === 'function' ? call(() => d.room()) : null)
	const enabled = (d) => !!roomOf(d)
	const anyEnabled = () => descs().some(enabled)

	function gameInfo(d) {
		const room = roomOf(d)
		const st = (typeof d.state === 'function' && call(() => d.state())) || {}
		const b = (room && typeof room.board === 'function' && call(() => room.board())) || null
		const players = b && Number.isFinite(b.players) ? b.players : Array.isArray(st.players) ? st.players.length : Number(st.players) || 0
		return {
			id: d.id,
			title: String(d.title || d.id),
			enabled: !!room,
			phase: (b && b.phase) || st.phase || (room ? null : 'off'),
			players,
			bots: b && Number.isFinite(b.bots) ? b.bots : Number(st.bots) || 0,
			endsAt: (b && Number.isFinite(b.endsAt) ? b.endsAt : Number.isFinite(st.endsAt) ? st.endsAt : null) ?? null,
			paths: d.paths && typeof d.paths === 'object' ? { ...d.paths } : {},
			joinUrl: Array.isArray(st.joinUrls) && st.joinUrls.length ? String(st.joinUrls[0]) : null,
			top: b && Array.isArray(b.top) ? b.top.slice(0, 3) : [],
			_rev: st.sceneRev || null,
		}
	}

	function state() {
		call(() => hub.sync())
		const games = descs().map(gameInfo)
		const pub = games.map(({ _rev, ...g }) => g)
		if (!games.some((g) => g.enabled)) return { on: false, v: 1, games: pub }
		const first = games.find((g) => g.enabled && g.paths.scene)
		const scene = first ? { json: first.paths.scene, glb: first.paths.glb ? first.paths.glb + (first._rev ? `?rev=${encodeURIComponent(first._rev)}` : '') : null } : null
		return {
			on: true,
			v: 1,
			safe: hub.isSafe(),
			affect: Object.fromEntries(descs().map((d) => [d.id, hub.affect(d.id)])),
			house: world.house,
			lights: world.lights,
			wall: world.wall,
			events: call(() => hub.events()),
			games: pub,
			scene,
			stats: call(() => hub.stats(), {}),
		}
	}

	/** One descriptor host call → { ok, status, error? }. */
	function hostOne(d, body) {
		const r = call(() => d.host(body), { status: 500, body: { ok: false, error: 'the game failed' } })
		const status = Number(r && r.status) || 500
		const ok = status < 300 && !(r.body && r.body.ok === false)
		const out = { ok, status }
		if (!ok) out.error = String((r.body && r.body.error) || 'refused')
		return out
	}
	const safeBody = (d, on) => (d.id === 'salad' ? { action: 'safe', on } : { action: 'pause', on })

	/** Run one host body on several games → per-game results. */
	function fan(list, bodyOf) {
		const results = {}
		for (const d of list) results[d.id] = hostOne(d, bodyOf(d))
		return results
	}

	const reply = (status, body) => ({ status, body: { ...body, state: state() } })
	const bad = (error) => reply(400, { ok: false, error })

	function targets(a, onlyEnabled) {
		if (a.game == null || a.game === '') {
			const all = descs()
			return { list: onlyEnabled ? all.filter(enabled) : all }
		}
		const d = descs().find((x) => x.id === a.game)
		if (!d) return { error: reply(404, { ok: false, error: `no such game: ${String(a.game).slice(0, 16)}` }) }
		return { list: [d] }
	}
	const done = (action, results) => {
		const ids = Object.keys(results)
		if (!ids.length) return reply(409, { ok: false, action, error: 'no game to do this', results })
		return reply(200, { ok: ids.every((id) => results[id].ok), action, results })
	}

	function host(a) {
		const action = a && typeof a === 'object' ? String(a.action || '') : ''
		switch (action) {
			case 'enable':
			case 'disable': {
				const t = targets(a, false)
				if (t.error) return t.error
				const results = fan(t.list, () => ({ action }))
				if (action === 'enable' && hub.isSafe()) for (const d of t.list) if (results[d.id].ok) hostOne(d, safeBody(d, true))
				call(() => hub.sync())
				return done(action, results)
			}
			case 'start':
			case 'stop': {
				const t = targets(a, true)
				if (t.error) return t.error
				return done(action, fan(t.list, () => ({ action })))
			}
			case 'bots': {
				if (a.game == null) return bad('`game` is required')
				const t = targets(a, false)
				if (t.error) return t.error
				if (!Number.isInteger(a.n) || a.n < 0) return bad('`n` must be a whole number ≥ 0')
				return done(action, fan(t.list, (d) => (d.id === 'rc' ? { action: 'bots', count: a.n } : { action: 'bots', n: a.n })))
			}
			case 'safe': {
				if (typeof a.on !== 'boolean') return bad('`on` must be true or false')
				hub.setSafe(a.on)
				const results = fan(descs().filter(enabled), (d) => safeBody(d, a.on))
				return reply(200, { ok: Object.values(results).every((r) => r.ok), action, results })
			}
			case 'lights':
			case 'wall': {
				if (typeof a.on !== 'boolean') return bad('`on` must be true or false')
				world[action] = a.on
				return done(action, fan(descs().filter(enabled), () => ({ action, on: a.on })))
			}
			case 'house': {
				const lv = a.level !== undefined ? a.level : typeof a.on === 'boolean' ? (a.on ? 1 : 0) : undefined
				if (typeof lv !== 'number' || !Number.isFinite(lv)) return bad('`level` must be a number 0..1')
				world.house = Math.min(1, Math.max(0, lv))
				return done(action, fan(descs().filter(enabled), () => ({ action: 'house', level: world.house })))
			}
			case 'affect': {
				if (a.game == null) return bad('`game` is required')
				const t = targets(a, false)
				if (t.error) return t.error
				if (!MODES.includes(a.mode)) return bad("`mode` must be 'on', 'soft' or 'off'")
				hub.setAffect(a.game, a.mode)
				return reply(200, { ok: true, action })
			}
			case 'event': {
				const kind = a.kind
				if (kind === 'none') {
					hub.endEvent('none')
					return reply(200, { ok: true, action })
				}
				if (kind !== 'rain' && kind !== 'spot') return bad("`kind` must be 'rain', 'spot' or 'none'")
				const secs = a.secs === undefined ? EVENT_DEFAULT[kind] : a.secs
				if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 5 || secs > 60) return bad('`secs` must be 5–60')
				if (hub.isSafe()) return reply(409, { ok: false, action, error: 'presenter safe is on' })
				hub.startEvent(kind, secs)
				return reply(200, { ok: true, action })
			}
			default:
				return bad('unknown action')
		}
	}

	return { state, host, anyEnabled }
}

module.exports = { createWorldService, EVENT_DEFAULT }
