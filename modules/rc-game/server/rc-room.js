'use strict'

/**
 * WO-1074 — RC car game: the room (pure; clock and timers injected, no I/O). Players join over the game socket
 * (max 10; spectators do not count), the host drives the phase machine lobby → countdown (5 s) → race → results, the
 * server referees laps from each client's reported checkpoint / lap (in order, never faster than track.length / 24 m/s;
 * §3: 24 × the scene's scale — the host's lap count follows a picked track's suggested `laps`)
 * and relays everyone's car 15 times a second — only while something moved. Physics is the browsers' business. Items
 * (v2: boxes, held items, hazards, effects) live in rc-room-items.js, in the lobby's free roam and in a race.
 * Costs nothing idle: a 1 Hz housekeeping timer only while sockets are open, the 15 Hz world timer only while cars move.
 */

const S = require('./rc-sanitize')
const { sceneScale } = require('./rc-scale')
const { createRoomItems } = require('./rc-room-items')

const COUNTDOWN_MS = 5000
const GRACE_MS = 20000
const SILENT_MS = 10000
const UNJOINED_MS = 15000
const WORLD_MS = Math.round(1000 / 15)
const STATE_HZ = 20
const IDLE_TICKS = 15 // world timer stops after 1 s without movement
const MAX_LAPS = 20

/**
 * @param {{ now?: () => number, timers?: object, send: (conn, msg) => void, close?: (conn, code, reason) => void,
 *   decorate?: (state) => object, maxPlayers?: number, maxSpectators?: number, rng?: () => number }} deps
 */
function createRcRoom(deps) {
	const now = deps.now || Date.now
	const T = deps.timers || { setTimeout, clearTimeout, setInterval, clearInterval }
	const send = deps.send
	const close = deps.close || (() => {})
	const decorate = deps.decorate || ((s) => s)
	const maxPlayers = deps.maxPlayers || 10
	const maxSpectators = deps.maxSpectators ?? 20
	const conns = new Map() // conn → { conn, pid, spectator, joined, opened, last, sTimes[] }
	const players = new Map() // id → player
	let nextId = 1
	let phase = 'lobby'
	let tracks = []
	let bounds = null
	let scale = 1 // §3: the scene's scale (speed cap, lap minimum, item reach)
	let trackId = null
	let raceTrack = null
	let laps = 3
	let startAt = null
	let firstFinish = null
	const timer = { phase: null, house: null, world: null, worldIdle: 0 }
	let dirty = false
	let phaseFn = null // the pending phase step and when it is due (WO-1101: a world pause holds it)
	let phaseDue = 0
	let paused = null // WO-1101 Game World pause: { at, fn, rem } while paused
	const items = createRoomItems({
		now, timers: T, rng: deps.rng, toAll: (msg) => toAll(msg),
		toPlayer: (pid, msg) => {
			const p = players.get(pid)
			if (p?.conn) send(p.conn, msg)
		},
		position, carOf: (pid) => players.get(pid)?.car || null, isPlayer: (pid) => players.has(pid),
	})
	/** Items follow the race's track, or the selected one in the lobby. */
	const syncItems = () => items.setTrack(raceTrack || tracks.find((t) => t.id === trackId) || null, bounds, scale)
	const suggestLaps = (t) => {
		if (Number.isInteger(t?.laps) && t.laps >= 1 && t.laps <= MAX_LAPS) laps = t.laps // §3: a track's suggested lap count
	}

	const connected = () => [...players.values()].filter((p) => p.connected)
	const spectators = () => [...conns.values()].filter((c) => c.joined && c.spectator).length

	function snapshot() {
		return {
			maxPlayers, phase, trackId, laps, startAt: phase === 'countdown' || phase === 'race' ? startAt : null,
			players: [...players.values()].sort((a, b) => a.id - b.id).map((p) => ({ id: p.id, name: p.name, color: p.color, ready: p.ready,
				connected: p.connected, slot: p.slot, racing: p.racing, ...(p.bot ? { bot: true } : {}) })),
			spectators: spectators(),
			...items.snapshot(),
			...(paused ? { paused: true } : {}), // only while paused: a game alone sends the very same state
		}
	}
	const state = () => decorate(snapshot())
	const toAll = (msg) => {
		for (const c of conns.values()) if (c.joined) send(c.conn, msg)
	}
	const broadcastState = () => toAll({ t: 'state', state: state() })

	function clearPhaseTimer() {
		if (timer.phase) T.clearTimeout(timer.phase)
		timer.phase = null
		phaseFn = null
	}
	function phaseTimer(fn, ms) {
		clearPhaseTimer()
		phaseFn = fn
		phaseDue = now() + ms
		timer.phase = T.setTimeout(() => ((timer.phase = null), (phaseFn = null), fn()), ms)
	}

	/** WO-1101 world pause: actions and car states are dropped, the phase step waits, clocks shift by the paused time. */
	function pause(on) {
		if (on && !paused) {
			paused = { at: now(), fn: phaseFn, rem: Math.max(0, phaseDue - now()) }
			if (timer.phase) T.clearTimeout(timer.phase)
			timer.phase = null
		} else if (!on && paused) {
			const d = now() - paused.at
			const { fn, rem } = paused
			paused = null
			if (startAt != null) startAt += d
			if (firstFinish != null) firstFinish += d
			for (const p of players.values()) if (p.race && !p.race.finished) p.race.lapStart += d
			if (fn) phaseTimer(fn, rem)
			if (phase === 'countdown') toAll({ t: 'countdown', startAt })
		} else return
		broadcastState()
	}

	function housekeeping() {
		const t = now()
		for (const c of [...conns.values()]) {
			const p = c.pid != null ? players.get(c.pid) : null
			if (p && !c.spectator && t - c.last > SILENT_MS) {
				drop(c, 4408, 'silent')
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

	function worldTick() {
		if (!dirty) {
			if (++timer.worldIdle >= IDLE_TICKS) {
				T.clearInterval(timer.world)
				timer.world = null
			}
			return
		}
		dirty = false
		timer.worldIdle = 0
		const cars = []
		for (const p of players.values()) if (p.connected && p.car) cars.push([p.id, ...p.car])
		toAll({ t: 'w', ts: now(), cars })
	}

	function moved() {
		dirty = true
		timer.worldIdle = 0
		if (!timer.world) timer.world = T.setInterval(worldTick, WORLD_MS)
	}

	function freeSlot() {
		const used = new Set(connected().map((p) => p.slot))
		for (let s = 0; s < maxPlayers; s++) if (!used.has(s)) return s
		return null
	}

	function join(c, m) {
		if (c.joined) return send(c.conn, { t: 'welcome', id: c.pid, state: state(), you: you(c) })
		if (m.spectator === true) {
			if (spectators() >= maxSpectators) return send(c.conn, { t: 'full' })
			c.pid = nextId++
			c.joined = c.spectator = true
			c.name = S.cleanName(m.name, `Spectator ${c.pid}`)
			send(c.conn, { t: 'welcome', id: c.pid, state: state(), you: you(c) })
			return broadcastState()
		}
		const slot = freeSlot()
		if (slot == null || connected().length >= maxPlayers) return send(c.conn, { t: 'full' })
		const id = nextId++
		const p = { id, name: S.cleanName(m.name, `Player ${id}`), color: S.cleanColor(m.color, slot), ready: false, connected: true, slot,
			racing: false, car: null, race: null, conn: c.conn, bot: !!c.conn?.botSink } // WO-1082: a server bot (rc-room-bots.js); a socket cannot claim it
		players.set(id, p)
		c.pid = id
		c.joined = true
		send(c.conn, { t: 'welcome', id, state: state(), you: you(c) })
		broadcastState()
	}

	function you(c) {
		const p = players.get(c.pid)
		if (c.spectator || !p) return { id: c.pid, name: c.name, color: null, slot: null, spectator: true }
		return { id: p.id, name: p.name, color: p.color, slot: p.slot, spectator: false }
	}

	/** A player's socket is gone: lobby → removed; in a race a racer stays listed (disconnected) until the lobby. */
	function drop(c, _code, _why) {
		conns.delete(c.conn)
		const p = c.pid != null ? players.get(c.pid) : null
		if (p && !c.spectator) {
			items.forget(p.id)
			if (phase === 'lobby' || !p.racing) players.delete(p.id)
			else {
				p.connected = false
				p.car = null
				p.conn = null
			}
			if (phase === 'race') checkAllFinished()
		}
		if (c.joined) broadcastState()
	}

	function referee(p, cp, lap) {
		const r = p.race
		const k = raceTrack.checkpoints.length
		if (!r || r.finished || (cp === r.cp && lap === r.lap)) return
		if (lap === r.lap && cp === r.cp + 1 && cp < k) {
			r.cp = cp
			return
		}
		if (lap !== r.lap + 1 || cp !== 0 || r.cp !== k - 1) return // out of order: ignored (the server's count stands)
		const t = now()
		const ms = t - r.lapStart
		if (ms < (raceTrack.length / (S.MAX_SPEED * scale)) * 1000) return // faster than the hard cap (24 m/s × scale) on average: not a lap
		r.lap = lap
		r.cp = 0
		r.lapStart = t
		r.best = r.best == null ? ms : Math.min(r.best, ms)
		toAll({ t: 'lap', id: p.id, lap, ms, best: r.best })
		if (lap >= laps) {
			r.finished = true
			r.total = t - startAt
			if (firstFinish == null) {
				firstFinish = t
				phaseTimer(finishRace, GRACE_MS)
			}
			checkAllFinished()
		}
	}

	function carState(c, m) {
		const p = players.get(c.pid)
		if (!p || c.spectator) return
		const v = S.cleanCar(m, bounds, raceTrack ? raceTrack.checkpoints.length : 0, laps, scale)
		if (!v) return
		if (phase === 'race' && p.racing && v.cp != null && v.lap != null) referee(p, v.cp, v.lap)
		const t = now()
		if (c.sTimes.length >= STATE_HZ && t - c.sTimes[0] < 1000) return // over 20 per second: dropped
		c.sTimes.push(t)
		if (c.sTimes.length > STATE_HZ) c.sTimes.shift()
		const car = [v.x, v.y, v.z, v.yaw, v.v, v.st, v.fx]
		if (!p.car || car.some((x, i) => x !== p.car[i])) {
			p.car = car
			moved()
		}
	}

	function checkAllFinished() {
		if (phase !== 'race') return
		const racers = [...players.values()].filter((p) => p.racing && p.connected)
		if (!racers.length || racers.every((p) => p.race.finished)) finishRace()
	}

	function order() {
		const all = [...players.values()].filter((p) => p.racing && p.race)
		all.sort((a, b) => {
			const ra = a.race, rb = b.race
			if (ra.finished !== rb.finished) return ra.finished ? -1 : 1
			if (ra.finished) return ra.total - rb.total || a.id - b.id
			return rb.lap - ra.lap || rb.cp - ra.cp || a.id - b.id
		})
		return all.map((p) => ({ id: p.id, name: p.name, totalMs: p.race.finished ? p.race.total : null, bestMs: p.race.best, laps: p.race.lap }))
	}

	/** Race position of a player for the item roll: 0 leading … 1 last; null outside a race. */
	function position(pid) {
		if (phase !== 'race') return null
		const ids = order().map((o) => o.id)
		const i = ids.indexOf(pid)
		return i < 0 ? null : ids.length > 1 ? i / (ids.length - 1) : 0
	}

	function finishRace() {
		clearPhaseTimer()
		if (phase !== 'race' && phase !== 'countdown') return
		phase = 'results'
		items.clear()
		toAll({ t: 'results', order: order(), final: true })
		broadcastState()
	}

	function toLobby() {
		clearPhaseTimer()
		phase = 'lobby'
		startAt = null
		firstFinish = null
		raceTrack = null
		items.clear()
		syncItems()
		for (const p of [...players.values()]) {
			if (!p.connected) players.delete(p.id)
			else {
				p.racing = false
				p.race = null
			}
		}
	}

	function start() {
		const track = tracks.find((t) => t.id === trackId)
		if (!track) return { ok: false, status: 409, error: 'no track' }
		const racers = connected()
		if (!racers.length) return { ok: false, status: 409, error: 'no players' }
		toLobby()
		raceTrack = track
		syncItems()
		items.clear()
		startAt = now() + COUNTDOWN_MS
		for (const p of players.values()) {
			p.racing = true
			p.race = { cp: 0, lap: 0, lapStart: startAt, best: null, total: null, finished: false }
		}
		phase = 'countdown'
		phaseTimer(() => {
			phase = 'race'
			broadcastState()
		}, COUNTDOWN_MS)
		toAll({ t: 'countdown', startAt })
		broadcastState()
		return { ok: true }
	}

	/** Host actions (track / laps / start / stop / kick; lights / wall / house only broadcast); enable / disable belong to the service. */
	function host(action, a = {}) {
		const idle = phase === 'lobby' || phase === 'results'
		switch (action) {
			case 'track': {
				const id = String(a.trackId ?? a.id ?? '')
				if (!idle) return { ok: false, status: 409, error: 'a race is running' }
				if (!tracks.some((t) => t.id === id)) return { ok: false, status: 400, error: 'unknown track' }
				trackId = id
				suggestLaps(tracks.find((t) => t.id === id))
				syncItems()
				break
			}
			case 'laps': {
				const n = Number(a.laps)
				if (!idle) return { ok: false, status: 409, error: 'a race is running' }
				if (!Number.isInteger(n) || n < 1 || n > MAX_LAPS) return { ok: false, status: 400, error: `laps 1–${MAX_LAPS}` }
				laps = n
				break
			}
			case 'start': {
				if (!idle) return { ok: false, status: 409, error: 'a race is running' }
				if (paused) return { ok: false, status: 409, error: 'paused' }
				return start()
			}
			case 'stop':
				toLobby()
				if (paused) paused.fn = null
				break
			case 'pause': // WO-1101 Game World: presenter safe / pause everything
				if (typeof a.on !== 'boolean') return { ok: false, status: 400, error: '`on` must be true or false' }
				pause(a.on)
				return { ok: true }
			case 'kick': {
				const id = Number(a.id)
				const c = [...conns.values()].find((x) => x.pid === id)
				const p = players.get(id)
				if (!c && !p) return { ok: false, status: 404, error: 'no such player' }
				if (p) players.delete(id), items.forget(id)
				if (c) {
					conns.delete(c.conn)
					close(c.conn, 4409, 'kicked')
				}
				if (phase === 'race') checkAllFinished()
				break
			}
			case 'lights':
			case 'wall':
			case 'house': // WO-1099 house lights
				break // §2.6 switches: flipped by the service (rc-game.js); only the state broadcast happens here
			default:
				return { ok: false, status: 400, error: 'unknown action' }
		}
		broadcastState()
		return { ok: true }
	}

	return {
		state,
		snapshot,
		/** The baked scene's tracks + bounds; the race in progress keeps its own track. */
		setScene(scene) {
			tracks = Array.isArray(scene?.tracks) ? scene.tracks : []
			bounds = scene?.bounds || null
			scale = sceneScale(scene)
			if (!tracks.some((t) => t.id === trackId)) {
				trackId = tracks[0]?.id ?? null
				suggestLaps(tracks[0])
				syncItems()
				if (conns.size) broadcastState()
			} else syncItems()
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
			if (!c.joined || paused) return
			if (m.t === 's') return carState(c, m)
			if ((m.t === 'box' || m.t === 'use' || m.t === 'hit') && !c.spectator && players.has(c.pid) && (phase === 'lobby' || phase === 'race')) {
				return items.handle(c.pid, m)
			}
			if (m.t === 'ready' && !c.spectator && players.has(c.pid)) {
				players.get(c.pid).ready = m.ready === true
				broadcastState()
			}
		},
		disconnect(conn) {
			const c = conns.get(conn)
			if (c) drop(c)
		},
		host,
		/** Everything stops (the game is disabled): timers cleared, the room emptied. */
		dispose() {
			clearPhaseTimer()
			for (const k of ['house', 'world']) if (timer[k]) T.clearInterval(timer[k])
			timer.house = timer.world = null
			paused = null
			conns.clear()
			players.clear()
			toLobby()
			items.clear()
		},
		/** WO-1101 Game World (rc-world.js): joined sockets, players, the track in play, a send to all, the standings. */
		world: () => ({ phase, startAt, paused: !!paused, conns: [...conns.values()].filter((c) => c.joined), players,
			track: raceTrack || tracks.find((t) => t.id === trackId) || null, scale }),
		toAll: (msg) => toAll(msg),
		order: () => (phase === 'lobby' ? [] : order()),
		/** Diagnostics for the smokes: which timers run. */
		timers: () => ({ phase: !!timer.phase, house: !!timer.house, world: !!timer.world }),
		connections: () => conns.size,
	}
}

module.exports = { createRcRoom, COUNTDOWN_MS, GRACE_MS, WORLD_MS }
