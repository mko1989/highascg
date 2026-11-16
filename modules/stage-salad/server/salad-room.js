'use strict'

/**
 * WO-1089 — Stage Salad: the room (pure; clock, timers and senders injected, no I/O). Players join over the game
 * socket (max 20 incl. bots — a joining guest takes a bot's place; max 20 spectators) and get a slingshot slot of the
 * venue (contract §3: lowest free index; in team mode on their team's side). Phases (§8): lobby (practice: flights and
 * reactions, nothing scored) → host start → countdown 3 s → round (`secs`) → results 12 s → lobby; `stop` → lobby.
 * The referee is salad-shots.js, the avatars salad-presenters.js, the bots salad-bots.js.
 * Timers: 1 Hz housekeeping while sockets are open; the 30 Hz tick (avatars, flights, bots, `w` at 15 Hz when
 * something moved) while anyone is connected or bots exist; one phase timer.
 */

const { kit } = require('./salad-kit')
const S = require('./salad-sanitize')
const { createShots } = require('./salad-shots')
const { createBots, MAX_BOTS } = require('./salad-bots')
const { createPresenters } = require('./salad-presenters')

const RULES = Object.freeze({ maxPlayers: 20, maxSpectators: 20, countdownMs: 3000, resultsMs: 12000, secs: { min: 30, max: 600, def: 90 } })
const SILENT_MS = 10000
const UNJOINED_MS = 15000
const TICK_MS = 33
const STATE_GAP_MS = 250
const AIM_HZ = 10

/**
 * @param {{ now?: () => number, timers?: object, rng?: () => number, send: (conn, msg) => void,
 *   close?: (conn, code, reason) => void, decorate?: (s) => object, maxPlayers?: number, maxSpectators?: number }} deps
 */
function createSaladRoom(deps) {
	const now = deps.now || Date.now
	const T = deps.timers || { setTimeout, clearTimeout, setInterval, clearInterval }
	const send = deps.send
	const close = deps.close || (() => {})
	const decorate = deps.decorate || ((s) => s)
	const maxPlayers = deps.maxPlayers || RULES.maxPlayers
	const maxSpectators = deps.maxSpectators ?? RULES.maxSpectators
	const rng = deps.rng || Math.random
	const conns = new Map()
	const players = new Map()
	let nextId = 1
	let phase = 'lobby'
	let secs = RULES.secs.def
	let teams = false
	let safe = false
	let venue = null
	let startAt = null
	let endsAt = null
	const timer = { phase: null, house: null, tick: null }
	let tickN = 0
	let lastW = ''
	let stateAt = 0
	let stateTimer = null
	let joining = 0
	let lastSnap = null

	const X = {
		now, rng, players,
		phase: () => phase,
		safe: () => safe,
		venue: () => venue,
		toAll: (m) => toAll(m),
		toPlayer: (p, m) => p.conn && send(p.conn, m),
		scored: () => stateSoon(),
		xw: () => (deps.xw ? deps.xw() : null), // WO-1102 Game World flight hooks (salad-world.js), null without the world
	}
	const presenters = createPresenters({ now, rng, venue: () => venue, onEvent: (m) => toAll(m) })
	const shots = createShots(X, presenters)
	const bots = createBots(X, shots, presenters, {
		add: (name, color) => addPlayer({ name, color, bot: true, conn: null }),
		remove: (p) => removePlayer(p),
		room: () => ({ maxPlayers, humans: humans().length + joining }),
	})

	const humans = () => [...players.values()].filter((p) => !p.bot && p.connected)
	const spectators = () => [...conns.values()].filter((c) => c.joined && c.spectator).length
	const teamScores = () => {
		if (!teams) return null
		const s = [0, 0]
		for (const p of players.values()) if (p.team === 0 || p.team === 1) s[p.team] += p.score
		return s
	}

	function snapshot() {
		return {
			maxPlayers, phase, startAt: phase === 'countdown' ? startAt : null, endsAt, secs, teams, teamScores: teamScores(), safe,
			bots: bots.wanted(), botLevel: bots.level(), target: presenters.mode(), targets: presenters.list(), venueRev: venue?.rev || null,
			players: [...players.values()].sort((a, b) => a.id - b.id).map((p) => ({ id: p.id, name: p.name, color: p.color, slot: p.slot, team: p.team,
				bot: p.bot, connected: p.connected || p.bot, score: p.score, hits: p.hits, shots: p.shots, best: p.best })),
			spectators: spectators(),
		}
	}
	const state = () => decorate(snapshot())
	function toAll(msg) {
		for (const c of conns.values()) if (c.joined) send(c.conn, msg)
	}
	function broadcastState() {
		stateAt = now()
		if (stateTimer) T.clearTimeout(stateTimer), (stateTimer = null)
		toAll({ t: 'state', state: state() })
	}
	/** Score changes: at most 4 state messages a second. */
	function stateSoon() {
		if (stateTimer) return
		const wait = Math.max(0, STATE_GAP_MS - (now() - stateAt))
		if (!wait) return broadcastState()
		stateTimer = T.setTimeout(() => ((stateTimer = null), broadcastState()), wait)
	}

	function freeSlot(team) {
		if (!venue) return null
		const used = new Set([...players.values()].map((p) => p.slot))
		const free = venue.slots.filter((s) => !used.has(s.i))
		return (free.find((s) => team == null || s.team === team) || free[0] || { i: null }).i
	}
	function smallerTeam() {
		const n = [0, 0]
		for (const p of players.values()) if (p.team === 0 || p.team === 1) n[p.team]++
		return n[1] < n[0] ? 1 : 0
	}

	function addPlayer({ name, color, bot, conn }) {
		if (players.size >= maxPlayers) return null
		const team = teams ? smallerTeam() : null
		const slot = freeSlot(team)
		const id = nextId++
		const p = { id, name, color, bot, conn, connected: !bot, slot, team: teams && slot != null ? venue.slots[slot].team : null,
			score: 0, hits: 0, shots: 0, streak: 0, best: 0, readyAt: 0, lastN: -1, fireTimes: [], aim: null, pull: 0 }
		players.set(id, p)
		ensureTick()
		return p
	}
	function removePlayer(p) {
		players.delete(p.id)
	}

	/** Slots after a venue change / team switch: everyone keeps theirs when it still fits, else the next free. */
	function reseat() {
		const order = [...players.values()].sort((a, b) => a.id - b.id)
		for (const p of order) p.slot = null
		for (const p of order) {
			const want = teams ? smallerTeamFor(order, p) : null
			p.slot = freeSlot(want)
			p.team = teams && p.slot != null ? venue.slots[p.slot].team : null
		}
	}
	function smallerTeamFor(order, me) {
		const n = [0, 0]
		for (const p of order) if (p !== me && p.slot != null) n[venue.slots[p.slot].team]++
		return n[1] < n[0] ? 1 : 0
	}

	function tick() {
		const t = now()
		const anyone = [...conns.values()].some((c) => c.joined) || bots.count() > 0
		if (!anyone && !shots.active()) {
			T.clearInterval(timer.tick)
			timer.tick = null
			return
		}
		presenters.tick(t)
		bots.tick(t)
		shots.tick(t)
		if (++tickN % 2) return
		const sl = [...players.values()].filter((p) => p.aim).map((p) => [p.id, p.aim[0], p.aim[1], p.pull])
		const msg = { t: 'w', ts: t, av: presenters.wire(t), sl }
		const key = JSON.stringify([msg.av, sl])
		if (key === lastW) return
		lastW = key
		toAll(msg)
	}
	function ensureTick() {
		if (!timer.tick) timer.tick = T.setInterval(tick, TICK_MS)
	}

	function housekeeping() {
		const t = now()
		for (const c of [...conns.values()]) {
			if (c.joined && !c.spectator && t - c.last > SILENT_MS) {
				drop(c)
				close(c.conn, 4408, 'silent')
			} else if (!c.joined && t - c.opened > UNJOINED_MS) {
				conns.delete(c.conn)
				close(c.conn, 4408, 'no join')
			}
		}
		if (!conns.size && timer.house) T.clearInterval(timer.house), (timer.house = null)
	}

	const you = (c) => {
		const p = players.get(c.pid)
		if (c.spectator || !p) return { id: c.pid, name: c.name, color: null, slot: null, team: null, spectator: true }
		return { id: p.id, name: p.name, color: p.color, slot: p.slot, team: p.team, spectator: false }
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
			lastW = '' // the newcomer needs the avatars even when nothing moves
			ensureTick()
			return broadcastState()
		}
		if (humans().length >= maxPlayers) return send(c.conn, { t: 'full' })
		if (players.size >= maxPlayers) {
			joining = 1 // a bot makes room: bots.sync counts the guest already
			bots.sync()
			joining = 0
		}
		const p = addPlayer({ name: null, color: null, bot: false, conn: c.conn })
		if (!p) return send(c.conn, { t: 'full' })
		p.name = K.cleanName(m.name, `Player ${p.id}`)
		p.color = K.cleanColor(m.color, p.id - 1)
		c.pid = p.id
		c.joined = true
		bots.sync()
		send(c.conn, { t: 'welcome', id: p.id, you: you(c), state: state() })
		send(c.conn, { t: 'me', ready: p.readyAt, streak: p.streak, score: p.score })
		lastW = '' // the newcomer needs the avatars even when nothing moves
		broadcastState()
	}

	function drop(c) {
		conns.delete(c.conn)
		const p = c.pid != null && !c.spectator ? players.get(c.pid) : null
		if (p) {
			if (phase === 'lobby') players.delete(p.id)
			else Object.assign(p, { connected: false, conn: null, aim: null, pull: 0 })
			bots.sync()
		}
		if (c.joined) broadcastState()
	}

	function aim(c, p, m) {
		const v = S.cleanAim(m)
		if (!v) return
		const t = now()
		c.aimTimes = c.aimTimes.filter((x) => t - x < 1000)
		if (c.aimTimes.length >= AIM_HZ) return
		c.aimTimes.push(t)
		p.aim = v.a
		p.pull = v.p
	}

	function clearPhaseTimer() {
		if (timer.phase) T.clearTimeout(timer.phase)
		timer.phase = null
	}

	function order() {
		return [...players.values()].sort((a, b) => b.score - a.score || b.hits - a.hits || a.shots - b.shots || a.id - b.id)
			.map((p) => ({ id: p.id, name: p.name, team: p.team, score: p.score, hits: p.hits, shots: p.shots, best: p.best }))
	}

	function endRound() {
		if (phase !== 'round' && phase !== 'countdown') return
		clearPhaseTimer()
		shots.tick(now())
		phase = 'results'
		presenters.setRound(false)
		endsAt = now() + RULES.resultsMs
		const o = order()
		const ts = teamScores()
		const winner = ts ? { team: ts[1] > ts[0] ? 1 : ts[0] > ts[1] ? 0 : null } : { id: o[0]?.id ?? null }
		toAll({ t: 'results', order: o, teams: ts, winner })
		timer.phase = T.setTimeout(() => {
			timer.phase = null
			toLobby()
			broadcastState()
		}, RULES.resultsMs)
		broadcastState()
	}

	function toLobby() {
		clearPhaseTimer()
		phase = 'lobby'
		startAt = endsAt = null
		presenters.setRound(false)
		for (const p of [...players.values()]) if (!p.connected && !p.bot) players.delete(p.id)
	}

	function start() {
		if (!venue) return { ok: false, status: 409, error: 'no venue yet' }
		if (!players.size) return { ok: false, status: 409, error: 'no players' }
		toLobby()
		shots.clear()
		for (const p of players.values()) Object.assign(p, { score: 0, hits: 0, shots: 0, streak: 0, best: 0, readyAt: 0 })
		phase = 'countdown'
		startAt = now() + RULES.countdownMs
		endsAt = startAt + secs * 1000
		timer.phase = T.setTimeout(() => {
			phase = 'round'
			presenters.setRound(true)
			timer.phase = T.setTimeout(endRound, secs * 1000)
			broadcastState()
		}, RULES.countdownMs)
		toAll({ t: 'countdown', startAt })
		broadcastState()
		return { ok: true }
	}

	function host(action, a = {}) {
		const idle = phase === 'lobby' || phase === 'results'
		const busy = { ok: false, status: 409, error: 'a round is running' }
		switch (action) {
			case 'start':
				if (!idle) return busy
				return start()
			case 'stop':
				shots.clear()
				toLobby()
				break
			case 'round':
				if (!idle) return busy
				if (!Number.isInteger(a.secs) || a.secs < RULES.secs.min || a.secs > RULES.secs.max) return { ok: false, status: 400, error: `secs ${RULES.secs.min}–${RULES.secs.max}` }
				secs = a.secs
				break
			case 'bots':
				if (!Number.isInteger(a.n) || a.n < 0 || a.n > MAX_BOTS) return { ok: false, status: 400, error: `bots 0–${MAX_BOTS}` }
				bots.setWanted(a.n)
				break
			case 'botlevel':
				if (!bots.setLevel(a.level)) return { ok: false, status: 400, error: "level 'easy', 'normal' or 'hard'" }
				break
			case 'teams':
				if (!idle) return busy
				if (typeof a.on !== 'boolean') return { ok: false, status: 400, error: '`on` must be true or false' }
				teams = a.on
				reseat()
				for (const p of players.values()) p.aim = null
				break
			case 'target': {
				const ids = Array.isArray(a.ids) ? a.ids : []
				if (a.mode === 'ids' && !ids.length) return { ok: false, status: 400, error: 'ids: at least one tracked id' }
				if (!presenters.setMode(a.mode, ids)) return { ok: false, status: 400, error: "mode 'auto', 'dummy' or 'ids'" }
				break
			}
			case 'safe':
				if (typeof a.on !== 'boolean') return { ok: false, status: 400, error: '`on` must be true or false' }
				safe = a.on
				presenters.setSafe(safe)
				if (safe) shots.clear()
				break
			case 'kick': {
				const id = Number(a.id)
				const c = [...conns.values()].find((x) => x.pid === id)
				const p = players.get(id)
				if (!c && !p) return { ok: false, status: 404, error: 'no such player' }
				if (p?.bot) bots.kick(p)
				else if (p) removePlayer(p)
				if (c) conns.delete(c.conn), close(c.conn, 4409, 'kicked')
				bots.sync()
				break
			}
			case 'lights':
			case 'wall':
			case 'house': // WO-1099 house lights
				break // switched by the service; only the state broadcast happens here
			default:
				return { ok: false, status: 400, error: 'unknown action' }
		}
		broadcastState()
		return { ok: true }
	}

	return {
		state,
		snapshot,
		/** The venue (venue.js buildVenue output); a new one reseats players when its slots changed. */
		setVenue(v) {
			if (!v || v.rev === venue?.rev) return
			const reslot = !venue || JSON.stringify(v.slots) !== JSON.stringify(venue.slots)
			venue = v
			if (reslot) reseat()
			presenters.ingest(lastSnap) // the stand-in's spot / floors follow the new venue
			if (conns.size) broadcastState()
		},
		/** A tracking snapshot (or null): the avatars. Broadcasts the state when the target list changed. */
		ingestTracking(snap) {
			const before = JSON.stringify(presenters.list())
			lastSnap = snap
			presenters.ingest(snap)
			if (JSON.stringify(presenters.list()) !== before) stateSoon()
		},
		connect(conn) {
			conns.set(conn, { conn, pid: null, spectator: false, joined: false, opened: now(), last: now(), aimTimes: [] })
			if (!timer.house) timer.house = T.setInterval(housekeeping, 1000)
			ensureTick()
		},
		handle(conn, m) {
			const c = conns.get(conn)
			if (!c || !m || typeof m !== 'object') return
			c.last = now()
			if (m.t === 'join') return join(c, m)
			if (m.t === 'ping') return send(conn, { t: 'pong', c: Number.isFinite(m.c) ? m.c : null, s: now() })
			const p = c.joined && !c.spectator ? players.get(c.pid) : null
			if (!p) return
			if (m.t === 'aim') return aim(c, p, m)
			if (m.t === 'fire') {
				const v = S.cleanFire(m)
				if (v) shots.fire(p, v)
			}
		},
		disconnect(conn) {
			const c = conns.get(conn)
			if (c) drop(c)
		},
		host,
		/** Something to do for the tracking poll (sockets joined or bots). */
		busy: () => [...conns.values()].some((c) => c.joined) || bots.count() > 0,
		dispose() {
			clearPhaseTimer()
			for (const k of ['house', 'tick']) if (timer[k]) T.clearInterval(timer[k])
			timer.house = timer.tick = null
			if (stateTimer) T.clearTimeout(stateTimer), (stateTimer = null)
			bots.dispose()
			shots.clear()
			presenters.clear()
			conns.clear()
			players.clear()
		},
		timers: () => ({ phase: !!timer.phase, house: !!timer.house, tick: !!timer.tick }),
		/** WO-1101 Game World (salad-world.js): joined sockets, players, the venue, the standings. */
		world: () => ({ phase, safe, startAt, conns: [...conns.values()].filter((c) => c.joined), players, venue }),
		order: () => order(),
		connections: () => conns.size,
		ctx: X,
		shots,
		bots,
		presenters,
		tick,
	}
}

module.exports = { createSaladRoom, RULES, TICK_MS }
