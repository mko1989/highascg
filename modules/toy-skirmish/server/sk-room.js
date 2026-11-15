'use strict'

/**
 * WO-1081 — Stage Skirmish: the room (pure; clock, timers and senders injected, no I/O). Players join over the game
 * socket (max 10 incl. bots — a joining guest takes a bot's place; max 20 spectators), the host drives the phase
 * machine lobby (warm-up: run, shoot, pick up, nothing scored, deaths respawn at once) → countdown 3 s (frozen at the
 * spawns, full reset) → match (frag or time limit) → results 15 s (frozen) → lobby; `stop` → lobby. Modes: `dm` (score =
 * kills − suicides), `tdm` (red 0 / blue 1, joiners to the smaller team, the host may move players) and `spot`
 * (WO-1083 "Spotlight": hold the moving pool alone, a point a second — sk-spot.js, ticked every 250 ms while the mode is
 * on). The referee (fire / hit / boom / pick, damage, respawns) is sk-combat.js, the bots sk-bots.js. Contract §3 / §5 /
 * §6 / §7.
 * Positions: a soldier's own `s` (≤ 20 / s) is ignored outside the arena rect + 2 u, faster than 6 u/s is clamped (with
 * 0.1 s of slack for network bunching), frozen outside lobby / match and while dead.
 * Timers: 1 Hz housekeeping while sockets are open, the 20 Hz `w` timer while anyone plays (sends only when something
 * changed), the bot timer only while bots exist, one phase timer, one respawn timer per dead soldier.
 */

const { kit } = require('./sk-kit')
const S = require('./sk-sanitize')
const { RULES, SOLDIER } = require('./sk-rules')
const { createCombat } = require('./sk-combat')
const { createBots } = require('./sk-bots')
const { createSpot, SPOT } = require('./sk-spot')
const G = require('./sk-grid')
const { floorOcc, sceneScaleOf } = require('./sk-arena-check')

const SILENT_MS = 10000
const UNJOINED_MS = 15000
const WORLD_MS = 50
const STATE_HZ = 20

/**
 * @param {{ now?: () => number, timers?: object, send: (conn, msg) => void, close?: (conn, code, reason) => void,
 *   decorate?: (state) => object, maxPlayers?: number, maxSpectators?: number, rng?: () => number }} deps
 */
function createSkRoom(deps) {
	const now = deps.now || Date.now
	const T = deps.timers || { setTimeout, clearTimeout, setInterval, clearInterval }
	const send = deps.send
	const close = deps.close || (() => {})
	const decorate = deps.decorate || ((s) => s)
	const maxPlayers = deps.maxPlayers || RULES.maxPlayers
	const maxSpectators = deps.maxSpectators ?? RULES.maxSpectators
	const conns = new Map() // conn → { conn, pid, spectator, joined, opened, last, sTimes[] }
	let nextId = 1
	let phase = 'lobby'
	let mode = 'dm'
	const limits = { frags: RULES.frags.dm, minutes: RULES.minutes.def }
	let scene = null
	let arenas = []
	let arenaId = null
	let startAt = null
	let endsAt = null
	const timer = { phase: null, house: null, world: null, spot: null }
	let dirty = false

	const X = {
		now, T, rng: deps.rng || Math.random, players: new Map(), teams: [0, 0], arena: null, grid: null, mask: null, u: 1,
		phase: () => phase, mode: () => mode,
		toAll: (msg) => toAll(msg),
		toPlayer: (p, msg) => p.conn && send(p.conn, msg),
		dirty: () => {
			dirty = true
			ensureWorld()
		},
		scored: () => {
			broadcastState()
			checkLimit()
		},
		spot: () => (mode === 'spot' ? spot.info() : null),
	}
	const players = X.players
	const combat = createCombat(X)
	const bots = createBots(X, combat, {
		add: (name, color) => addPlayer({ name, color, bot: true, conn: null }),
		remove: (p) => removePlayer(p),
		room: () => ({ maxPlayers, humans: humans().length }),
	})

	const spot = createSpot(X, { changed: () => broadcastState() })
	/** The Spotlight tick runs while the mode is `spot` (any phase: the pool is there in the lobby, scores in a match). */
	function syncSpotTimer() {
		if (mode === 'spot' && !timer.spot) timer.spot = T.setInterval(spot.tick, SPOT.tickMs)
		if (mode !== 'spot' && timer.spot) T.clearInterval(timer.spot), (timer.spot = null), spot.reset()
	}

	const humans = () => [...players.values()].filter((p) => !p.bot && p.connected)
	const spectators = () => [...conns.values()].filter((c) => c.joined && c.spectator).length
	const teamOf = () => {
		if (mode !== 'tdm') return null
		const n = [0, 0]
		for (const p of players.values()) if ((p.connected || p.bot) && (p.team === 0 || p.team === 1)) n[p.team]++
		return n[1] < n[0] ? 1 : 0
	}

	function snapshot() {
		return {
			maxPlayers, phase, mode, arenaId, limits: { ...limits }, startAt: phase === 'countdown' ? startAt : null, endsAt, bots: bots.wanted(), botLevel: bots.level(),
			players: [...players.values()].sort((a, b) => a.id - b.id).map((p) => ({ id: p.id, name: p.name, color: p.color, team: p.team, bot: p.bot,
				connected: p.connected || p.bot, kills: p.kills, deaths: p.deaths, score: p.score })),
			teams: X.teams.slice(), pk: combat.pkList(), spectators: spectators(), spot: X.spot(),
		}
	}
	const state = () => decorate(snapshot())
	function toAll(msg) {
		for (const c of conns.values()) if (c.joined) send(c.conn, msg)
	}
	const broadcastState = () => toAll({ t: 'state', state: state() })

	function addPlayer({ name, color, bot, conn }) {
		const id = nextId++
		const p = { id, name, color, team: teamOf(), bot, connected: !bot, conn, kills: 0, deaths: 0, suicides: 0, score: 0,
			alive: false, pos: null, yaw: 0, mv: 0, moveAt: 0, protectUntil: 0, respawnTimer: null, sent: '' }
		combat.reset(p)
		players.set(id, p)
		return p
	}

	function removePlayer(p) {
		combat.clearRespawn(p)
		players.delete(p.id)
		X.dirty()
	}

	function worldTick() {
		const live = [...players.values()].filter((p) => p.connected || p.bot)
		if (!live.length) {
			T.clearInterval(timer.world)
			timer.world = null
			return
		}
		const t = now()
		const a = []
		for (const p of live) {
			if (!p.pos) continue
			const flags = (p.mv ? 1 : 0) | (p.alive ? 0 : 2) | (p.protectUntil > t ? 4 : 0) | (p.surgeUntil > t ? 8 : 0)
			const e = [p.id, p.pos[0], p.pos[1], p.yaw, flags, p.held || 'pea'] // 6th: the weapon shown (contract §12)
			const key = e.join(',')
			if (key !== p.sent) (p.sent = key), (dirty = true)
			a.push(e)
		}
		if (!dirty) return
		dirty = false
		toAll({ t: 'w', ts: t, a })
	}

	function ensureWorld() {
		if (!timer.world && [...players.values()].some((p) => p.connected || p.bot)) timer.world = T.setInterval(worldTick, WORLD_MS)
	}

	function housekeeping() {
		const t = now()
		for (const c of [...conns.values()]) {
			if (c.pid != null && !c.spectator && players.has(c.pid) && t - c.last > SILENT_MS) {
				drop(c)
				close(c.conn, 4408, 'silent')
			} else if (!c.joined && t - c.opened > UNJOINED_MS) {
				conns.delete(c.conn)
				close(c.conn, 4408, 'no join')
			}
		}
		if (!conns.size && timer.house) {
			T.clearInterval(timer.house)
			timer.house = null
		}
	}

	const you = (c) => {
		const p = players.get(c.pid)
		if (c.spectator || !p) return { id: c.pid, name: c.name, color: null, team: null, spectator: true }
		return { id: p.id, name: p.name, color: p.color, team: p.team, spectator: false }
	}

	function join(c, m) {
		if (c.joined) return send(c.conn, { t: 'welcome', id: c.pid, you: you(c), state: state() })
		const K = kit()
		if (m.spectator === true) {
			if (spectators() >= maxSpectators) return send(c.conn, { t: 'full' })
			c.pid = nextId++
			c.joined = c.spectator = true
			c.name = K.cleanName(m.name, `Spectator ${c.pid}`)
			send(c.conn, { t: 'welcome', id: c.pid, you: you(c), state: state() })
			return broadcastState()
		}
		if (humans().length >= maxPlayers) return send(c.conn, { t: 'full' })
		const p = addPlayer({ name: null, color: null, bot: false, conn: c.conn })
		p.name = K.cleanName(m.name, `Player ${p.id}`)
		p.color = K.cleanColor(m.color, p.id - 1)
		c.pid = p.id
		c.joined = true
		bots.sync() // a guest takes a bot's place when the room is full
		send(c.conn, { t: 'welcome', id: p.id, you: you(c), state: state() })
		combat.spawn(p, phase === 'countdown' ? { until: startAt + RULES.protectMs } : {})
		broadcastState()
	}

	/** A socket is gone: lobby → the player is removed; otherwise listed (disconnected) until the lobby. */
	function drop(c) {
		conns.delete(c.conn)
		const p = c.pid != null && !c.spectator ? players.get(c.pid) : null
		if (p) {
			combat.clearRespawn(p)
			if (phase === 'lobby') players.delete(p.id)
			else Object.assign(p, { connected: false, conn: null, alive: false, pos: null, mv: 0 })
			bots.sync()
			X.dirty()
		}
		if (c.joined) broadcastState()
	}

	function move(c, m) {
		const p = players.get(c.pid)
		if (!p || c.spectator || !p.alive || !p.pos || !X.arena || (phase !== 'lobby' && phase !== 'match')) return
		const v = S.cleanMove(m)
		if (!v) return
		const t = now()
		if (c.sTimes.length >= STATE_HZ && t - c.sTimes[0] < 1000) return // over 20 per second: dropped
		c.sTimes.push(t)
		if (c.sTimes.length > STATE_HZ) c.sTimes.shift()
		const r = X.arena.rect, sl = RULES.posSlack * X.u
		let [x, z] = v.p
		if (x < r[0] - sl || x > r[2] + sl || z < r[1] - sl || z > r[3] + sl) return
		const dx = x - p.pos[0], dz = z - p.pos[1]
		const d = Math.hypot(dx, dz)
		const allowed = SOLDIER.maxSpeed * X.u * (Math.max(0, t - p.moveAt) / 1000 + 0.1)
		if (d > allowed) {
			x = Math.round((p.pos[0] + (dx / d) * allowed) * 1e4) / 1e4
			z = Math.round((p.pos[1] + (dz / d) * allowed) * 1e4) / 1e4
		}
		p.pos = [x, z]
		p.yaw = v.yaw
		p.mv = v.mv
		p.moveAt = t
		if (v.w && p.w[v.w] !== undefined) p.held = v.w
		X.dirty()
	}

	function clearPhaseTimer() {
		if (timer.phase) T.clearTimeout(timer.phase)
		timer.phase = null
	}

	function order() {
		return [...players.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id)
			.map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, score: p.score }))
	}

	function checkLimit() {
		if (phase !== 'match') return
		const hit = mode === 'tdm' ? X.teams.some((s) => s >= limits.frags) : [...players.values()].some((p) => p.score >= limits.frags)
		if (hit) endMatch()
	}

	function endMatch() {
		if (phase !== 'match' && phase !== 'countdown') return
		clearPhaseTimer()
		phase = 'results'
		for (const p of players.values()) combat.clearRespawn(p), (p.mv = 0)
		endsAt = now() + RULES.resultsMs
		toAll({ t: 'results', mode, order: order(), teams: X.teams.slice(), final: true })
		timer.phase = T.setTimeout(() => {
			timer.phase = null
			toLobby()
			broadcastState()
		}, RULES.resultsMs)
		X.dirty()
		broadcastState()
	}

	function toLobby(respawn = true) {
		clearPhaseTimer()
		phase = 'lobby'
		startAt = endsAt = null
		for (const p of [...players.values()]) if (!p.connected && !p.bot) players.delete(p.id)
		// a new scene rev reshapes the arenas: pick the same id up again (or the first arena)
		if (!X.arena || !arenas.includes(X.arena)) setArena(arenas.some((a) => a.id === arenaId) ? arenaId : arenas[0]?.id ?? null)
		combat.resetPickups()
		spot.reset()
		if (respawn) combat.spawnAll()
	}

	function start() {
		if (!X.arena) return { ok: false, status: 409, error: 'no arena' }
		if (!players.size) return { ok: false, status: 409, error: 'no players' }
		toLobby(false)
		for (const p of players.values()) Object.assign(p, { kills: 0, deaths: 0, suicides: 0, score: 0 })
		X.teams = [0, 0]
		phase = 'countdown'
		startAt = now() + RULES.countdownMs
		endsAt = startAt + limits.minutes * 60000
		combat.spawnAll({ until: startAt + RULES.protectMs, spread: true })
		timer.phase = T.setTimeout(() => {
			phase = 'match'
			timer.phase = T.setTimeout(endMatch, limits.minutes * 60000)
			broadcastState()
		}, RULES.countdownMs)
		toAll({ t: 'countdown', startAt })
		broadcastState()
		return { ok: true }
	}

	function setArena(id) {
		const a = arenas.find((x) => x.id === id) || null
		arenaId = a ? a.id : null
		X.arena = a
		X.grid = a ? G.arenaGrid(a, floorOcc(scene, a.floor), X.u) : null
		X.mask = X.grid ? G.passable(X.grid, SOLDIER.radius * X.u) : null
		combat.resetPickups()
		spot.reset()
		bots.arenaChanged()
	}

	/** Host actions (arena / mode / limits / bots / start / stop / kick / team; lights / wall only broadcast). */
	function host(action, a = {}) {
		const idle = phase === 'lobby' || phase === 'results'
		const busy = { ok: false, status: 409, error: 'a match is running' }
		switch (action) {
			case 'arena': {
				const id = String(a.id ?? a.arenaId ?? '')
				if (!idle) return busy
				if (!arenas.some((x) => x.id === id)) return { ok: false, status: 400, error: 'unknown arena' }
				setArena(id)
				toLobby()
				break
			}
			case 'mode': {
				if (!idle) return busy
				if (!['dm', 'tdm', 'spot'].includes(a.mode)) return { ok: false, status: 400, error: "mode 'dm', 'tdm' or 'spot'" }
				if (limits.frags === RULES.frags[mode]) limits.frags = RULES.frags[a.mode]
				mode = a.mode
				let n = 0
				for (const p of [...players.values()].sort((x, y) => x.id - y.id)) p.team = mode === 'tdm' ? n++ % 2 : null
				toLobby()
				syncSpotTimer()
				break
			}
			case 'limits': {
				if (!idle) return busy
				const f = a.frags ?? limits.frags, mi = a.minutes ?? limits.minutes
				if (!Number.isInteger(f) || f < RULES.frags.min || f > RULES.frags.max) return { ok: false, status: 400, error: `frags ${RULES.frags.min}–${RULES.frags.max}` }
				if (!Number.isInteger(mi) || mi < RULES.minutes.min || mi > RULES.minutes.max) return { ok: false, status: 400, error: `minutes ${RULES.minutes.min}–${RULES.minutes.max}` }
				Object.assign(limits, { frags: f, minutes: mi })
				break
			}
			case 'bots': {
				if (!Number.isInteger(a.n) || a.n < 0 || a.n > RULES.maxBots) return { ok: false, status: 400, error: `bots 0–${RULES.maxBots}` }
				bots.setWanted(a.n)
				break
			}
			case 'botlevel': // WO-1083: easy / normal / hard (reaction, turn rate, aim error — never the view rule)
				if (!bots.setLevel(a.level)) return { ok: false, status: 400, error: "level 'easy', 'normal' or 'hard'" }
				break
			case 'start':
				if (!idle) return busy
				return start()
			case 'stop':
				toLobby()
				break
			case 'kick': {
				const id = Number(a.id)
				const c = [...conns.values()].find((x) => x.pid === id)
				const p = players.get(id)
				if (!c && !p) return { ok: false, status: 404, error: 'no such player' }
				if (p?.bot) bots.kick(p)
				else if (p) removePlayer(p)
				if (c) {
					conns.delete(c.conn)
					close(c.conn, 4409, 'kicked')
				}
				bots.sync()
				break
			}
			case 'team': {
				const p = players.get(Number(a.id))
				if (mode !== 'tdm') return { ok: false, status: 409, error: 'teams exist in tdm only' }
				if (!p) return { ok: false, status: 404, error: 'no such player' }
				if (a.team !== 0 && a.team !== 1) return { ok: false, status: 400, error: 'team 0 or 1' }
				p.team = a.team
				if (p.alive && (phase === 'lobby' || phase === 'match')) combat.spawn(p)
				break
			}
			case 'lights':
			case 'wall':
				break // §2.6 switches: flipped by the service; only the state broadcast happens here
			default:
				return { ok: false, status: 400, error: 'unknown action' }
		}
		broadcastState()
		return { ok: true }
	}

	return {
		state,
		snapshot,
		/** The served scene (sk-scene.js output json): its arenas; the running match keeps its arena while it still exists. */
		setScene(json) {
			if (json === scene) return
			scene = json
			X.u = sceneScaleOf(json)
			arenas = Array.isArray(json?.arenas) ? json.arenas : []
			if (phase !== 'lobby' && X.arena) return // a match keeps its arena (and grid) until the lobby picks the new one up
			toLobby()
			if (conns.size) broadcastState()
		},
		connect(conn) {
			conns.set(conn, { conn, pid: null, spectator: false, joined: false, opened: now(), last: now(), sTimes: [] })
			if (!timer.house) timer.house = T.setInterval(housekeeping, 1000)
		},
		/** One parsed message (an object) from `conn`. */
		handle(conn, m) {
			const c = conns.get(conn)
			if (!c || !m || typeof m !== 'object') return
			c.last = now()
			if (m.t === 'join') return join(c, m)
			if (m.t === 'ping') return send(conn, { t: 'pong', c: Number.isFinite(m.c) ? m.c : null, s: now() })
			const p = c.joined && !c.spectator ? players.get(c.pid) : null
			if (!p) return
			if (m.t === 's') return move(c, m)
			const v = m.t === 'fire' ? S.cleanFire(m) : m.t === 'hit' ? S.cleanHit(m) : m.t === 'boom' ? S.cleanBoom(m) : m.t === 'pick' ? S.cleanPick(m) : null
			if (v) combat[m.t](p, v)
		},
		disconnect(conn) {
			const c = conns.get(conn)
			if (c) drop(c)
		},
		host,
		/** Everything stops (the game is disabled): timers cleared, the room emptied. */
		dispose() {
			clearPhaseTimer()
			for (const k of ['house', 'world', 'spot']) if (timer[k]) T.clearInterval(timer[k])
			timer.house = timer.world = timer.spot = null
			for (const p of players.values()) combat.clearRespawn(p)
			bots.dispose()
			conns.clear()
			players.clear()
		},
		/** Diagnostics for the smokes. */
		timers: () => ({ phase: !!timer.phase, house: !!timer.house, world: !!timer.world, spot: !!timer.spot, bots: bots.running() }),
		connections: () => conns.size,
		ctx: X,
		combat,
	}
}

module.exports = { createSkRoom, WORLD_MS }
