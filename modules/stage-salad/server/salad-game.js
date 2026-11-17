'use strict'

/**
 * WO-1089 — Stage Salad service: enabled flag (memory only, off after a restart), the room, the game sockets, the
 * served scene (salad-scene.js: the shared RC bake) and the venue built from it (venue.js: frame, slots, colliders —
 * the live LED walls / lights move colliders, so it is rebuilt when they change: `venueRev`). Disabled it holds
 * nothing (no room, no timers, no sockets, no leases, no tracking poll); disabling closes every game socket with `off`
 * + 4403. The game never puts anything on a screen: no Caspar, no looks, no layers, no project writes.
 * Presenters: the tracking module's detections (world persons), read in-process through the module registry at 10 Hz
 * while a session runs and someone (or a bot) is in the room. Live room as the other games (RC contract §2.6 through
 * the kit): the rig (`lxfull` / `lx`) and the LED wall pictures, leased under this module's own id (`stage-salad`).
 */

const { kit, shared } = require('./salad-kit')
const { createSaladRoom, RULES } = require('./salad-room')
const { createSaladScene } = require('./salad-scene')
const { parseMessage } = require('./salad-sanitize')
const { setSaladEnabled } = require('./salad-public')
const { createSaladWorld } = require('./salad-world')
const { MAX_BOTS } = require('./salad-bots')

const MAX_SOCKETS = RULES.maxPlayers + RULES.maxSpectators
const MSG_RATE = 30 // messages / s per socket (aim ≤ 10 + fire ≤ 3 + pings), burst the same
const MAX_BUFFERED = 256 * 1024
const MAX_PER_ADDRESS = 0 // WO-1106 B36: default per-address cap, 0 = off (phones behind NAT'd guest Wi-Fi share one address); deps.maxPerAddress turns it on
const LEASE_ID = 'stage-salad'
const POLL_MS = 100
const VENUE_EVERY = 50 // polls between live venue checks (5 s)

/** The tracking module's detections snapshot, in-process (no HTTP); null when tracking is not loaded / running. */
/**
 * WO-1106 B36: the remote address a per-device cap can trust, or null. Loopback = a proxy on the box in front of the
 * game (every guest would share it): not capped.
 */
function addressOf(req) {
	const a = req?.socket?.remoteAddress
	if (typeof a !== 'string' || !a) return null
	const ip = a.startsWith('::ffff:') ? a.slice(7) : a
	return ip === '::1' || ip.startsWith('127.') ? null : ip
}

async function readTrackingLive() {
	const m = kit().core('src/module-registry').get('tracking')
	if (!m || typeof m.handleApi !== 'function') return null
	const r = await m.handleApi({ method: 'GET', path: '/api/tracking/detections', body: '', req: null })
	if (!r || r.status !== 200) return null
	return typeof r.body === 'string' ? JSON.parse(r.body) : r.body
}

/**
 * @param {{ port?: () => number, lanIps?: () => string[], log?: Function, now?: () => number, timers?: object, rng?: Function,
 *   baker?: object, bakerDeps?: object, ctx?: object, lightsDeps?: object, videoDeps?: object, readTracking?: Function, maxPerAddress?: number }} deps
 */
function createSaladGame(deps = {}) {
	const K = kit()
	const V = shared().venue
	const WebSocket = K.core('ws')
	const log = deps.log || (() => {})
	const now = deps.now || Date.now
	const T = deps.timers || { setTimeout, clearTimeout, setInterval, clearInterval }
	const port = deps.port || (() => 4200)
	const lanIps = deps.lanIps || (() => K.core('src/utils/lan-ipv4').getLanIPv4Addresses())
	const readTracking = deps.readTracking || readTrackingLive
	const baker = deps.baker || K.createSceneBaker({ log, ...(deps.bakerDeps || {}) })
	const scene = createSaladScene({ baker })
	let room = null
	let world = null // WO-1101 Game World link while enabled (does nothing without the world module)
	let lastRev = null
	let sceneJson = null
	let venue = null
	let poll = null
	let polls = 0
	let reading = false
	const sockets = new Set()
	const maxPerAddress = Number(deps.maxPerAddress ?? MAX_PER_ADDRESS) || 0
	const perAddr = new Map() // remote address → open game sockets (WO-1106 B36)
	const text = new WeakMap()

	const json = (m) => {
		let s = text.get(m)
		if (!s) text.set(m, (s = JSON.stringify(m)))
		return s
	}
	// venue network first, then VPN (100.64/10 …), then local-only (169.254 / docker0 …): lan-ipv4.js ranks them (WO-1106 D3)
	const joinUrls = () => [...lanIps()].map((ip) => `http://${ip}:${port()}/game/salad/`)

	/** → true when handed to the socket, false when skipped (closed / over MAX_BUFFERED) — WO-1106 A5: the world hub commits on true only. */
	function sendTo(ws, m) {
		if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return false
		try {
			ws.send(json(m))
			return true
		} catch {
			return false /* socket going away */
		}
	}

	const vd = deps.videoDeps || (deps.ctx ? K.rcVideoDeps(deps.ctx, { log }) : null)
	const videoDeps = vd ? { ...vd, lease: (_id, roles) => (vd.lease ? vd.lease(LEASE_ID, roles) : undefined) } : null
	const lightsDeps = deps.lightsDeps || (deps.ctx ? K.rcLightsDeps(deps.ctx, { send: sendTo, log }) : null)
	const lights = lightsDeps ? K.createRcLights({ log, ...lightsDeps, send: sendTo }) : null
	const video = videoDeps ? K.createRcVideo({ log, ...videoDeps }) : null
	const liveLists = () => ({ lights: lights ? lights.list() : [], screens: videoDeps?.screens ? videoDeps.screens() : [] })
	let house = 1 // WO-1099 house lights LEVEL 0..1 (1 = the room lit): every client dims its own room (world.js setHouse); lives like lights / wall
	const decorate = (s) => ({ enabled: true, ...s, joinUrls: joinUrls(), sceneRev: lastRev,
		lights: lights ? lights.isOn() : false, wall: video ? video.isOn() : false, house, self: ctl.self(), botMax: MAX_BOTS })
	/** WO-1125 §3: players' `ctl` → this service's host() (the operator's path; only round + teams, never target / safe / …). */
	const ctl = K.createGameCtl({ game: 'stage-salad', log, now, timers: deps.timers, send: sendTo, host: (b) => host(b), world: () => room?.world() || null,
		keys: { round: (v) => (K.intIn(v, RULES.secs.min, RULES.secs.max) != null ? [{ action: 'round', secs: v }] : null),
			teams: (v) => (typeof v === 'boolean' ? [{ action: 'teams', on: v }] : null) },
		bots: (n, level) => [{ action: 'bots', n }, ...(level ? [{ action: 'botlevel', level }] : [])] })

	/** Venue from the scene + the live screens / lights; the room gets it when its rev changed. */
	function rebuildVenue() {
		if (!sceneJson) return venue
		let v
		try {
			v = V.buildVenue(sceneJson, liveLists())
		} catch (e) {
			log('warn', `[stage-salad] venue failed: ${e.message}`)
			return venue
		}
		if (!venue || v.rev !== venue.rev) {
			venue = v
			if (room) room.setVenue(v)
		}
		return venue
	}

	function refreshScene() {
		return scene.get().then((out) => {
			lastRev = out.rev
			sceneJson = out.json
			rebuildVenue()
			video?.refresh()
			return out
		})
	}

	function rev() {
		const r = scene.rev()
		if (room && r !== lastRev) refreshScene().catch((e) => log('warn', `[stage-salad] scene failed: ${e.message}`))
		return r
	}

	function pollOnce() {
		if (!room || reading) return
		if (!room.busy()) return stopPoll()
		if (++polls % VENUE_EVERY === 0) rebuildVenue()
		reading = true
		Promise.resolve()
			.then(readTracking)
			.catch(() => null)
			.then((snap) => {
				reading = false
				if (room) room.ingestTracking(snap)
			})
	}
	function startPoll() {
		if (!poll && room) poll = T.setInterval(pollOnce, POLL_MS)
	}
	function stopPoll() {
		if (poll) T.clearInterval(poll)
		poll = null
	}

	function enable() {
		if (room) return
		world = createSaladWorld({ room: () => room, send: sendTo, lights, now })
		const w = world
		room = createSaladRoom({ now, timers: deps.timers, rng: deps.rng, send: sendTo, decorate, xw: () => w.hooks(),
			close: (ws, code, reason) => {
				try {
					ws.close(code, reason)
				} catch {
					/* already closed */
				}
			} })
		setSaladEnabled(true)
		lastRev = scene.rev()
		if (venue) room.setVenue(venue)
		refreshScene().catch((e) => log('warn', `[stage-salad] scene failed: ${e.message}`))
		world.attach()
		log('info', '[stage-salad] enabled')
	}

	function disable() {
		if (!room) return
		world?.detach()
		world = null
		setSaladEnabled(false)
		for (const ws of sockets) {
			sendTo(ws, { t: 'off' })
			try {
				ws.close(4403, 'game disabled')
			} catch {
				/* gone */
			}
		}
		sockets.clear()
		stopPoll()
		lights?.stop()
		video?.stop()
		room.dispose()
		room = null
		log('info', '[stage-salad] disabled')
	}

	/** POST /api/game/salad/host body → { status, body }. */
	function host(a) {
		const action = a && typeof a === 'object' ? String(a.action || '') : ''
		if (action === 'self') return ctl.hostSelf(a, state, () => room?.host('house', {})) // WO-1125: room 'house' = only the state push
		ctl.note(action, a) // WO-1125: an operator's disable holds the session closed for games.selfService; its bots = the default
		if (action === 'enable') enable()
		else if (action === 'disable') disable()
		else if (!room) return { status: 409, body: { ok: false, error: 'the game is not enabled', state: state() } }
		else {
			if (action === 'house') {
				const lv = a.level !== undefined ? a.level : typeof a.on === 'boolean' ? (a.on ? 1 : 0) : undefined // `on` kept for older hosts
				if (typeof lv !== 'number' || Number.isNaN(lv)) return { status: 400, body: { ok: false, error: '`level` must be a number 0..1 (or `on` true / false)', state: state() } }
				house = Math.min(1, Math.max(0, lv)) // WO-1099: only state
			} else if (action === 'lights' || action === 'wall') {
				if (typeof a.on !== 'boolean') return { status: 400, body: { ok: false, error: '`on` must be true or false', state: state() } }
				;(action === 'lights' ? lights : video)?.setOn(a.on)
			}
			const r = room.host(action, a)
			if (!r.ok) return { status: r.status || 400, body: { ok: false, error: r.error, state: state() } }
			if (room.busy()) startPoll()
		}
		return { status: 200, body: { ok: true, state: state() } }
	}

	function state() {
		if (!room) return { enabled: false }
		rev()
		return room.state()
	}

	/** `req` = the upgrade request (salad-ws.js): its remote address caps the sockets per device. */
	function attach(ws, req = null) {
		ws.on('error', () => {})
		if (!room) {
			sendTo(ws, { t: 'off' })
			return ws.close(4403, 'game disabled')
		}
		if (sockets.size >= MAX_SOCKETS) return ws.close(1013, 'full')
		const addr = addressOf(req)
		if (addr && maxPerAddress > 0 && (perAddr.get(addr) || 0) >= maxPerAddress) return ws.close(1013, 'too many connections from this device')
		if (addr) {
			perAddr.set(addr, (perAddr.get(addr) || 0) + 1)
			ws.once('close', () => {
				const n = (perAddr.get(addr) || 1) - 1
				if (n > 0) perAddr.set(addr, n)
				else perAddr.delete(addr)
			})
		}
		sockets.add(ws)
		room.connect(ws)
		lights?.attach(ws)
		let tokens = MSG_RATE
		let at = now()
		let bad = 0
		ws.on('message', (data, isBinary) => {
			const t = now()
			tokens = Math.min(MSG_RATE, tokens + ((t - at) / 1000) * MSG_RATE)
			at = t
			if (--tokens < -MSG_RATE) return ws.close(1008, 'rate')
			if (tokens < 0) return
			const m = parseMessage(data, isBinary)
			if (!m) {
				if (++bad > 20) ws.close(1008, 'invalid')
				return
			}
			if (m.t === 'video') {
				if (room) video?.subscribe(ws, m.on === true)
				return
			}
			if (m.t === 'wq') return world?.quality(ws, m) // WO-1101: the visitor cap of the client's quality tier
			if (!room) return
			if (m.t === 'ctl') return ctl.handle(ws, m) // WO-1125 §3 player control
			if (room.handle(ws, m) === 'bad' && ++bad > 20) return ws.close(1008, 'invalid') // WO-1106 B34: a wrong resume token
			if (m.t === 'join') startPoll()
		})
		ws.on('close', () => {
			sockets.delete(ws)
			if (room) room.disconnect(ws)
			lights?.detach(ws)
			video?.detach(ws)
		})
	}

	return {
		isEnabled: () => !!room,
		enable,
		disable,
		host,
		state,
		scene: () => refreshScene(),
		/** The served scene + `salad` (the venue) + the live `lights` / `screens`. */
		sceneWithLive: () =>
			refreshScene().then((out) => ({ ...out, text: K.withLiveScene(JSON.stringify({ ...out.json, salad: rebuildVenue() }), liveLists()) })),
		attach,
		socketCount: () => sockets.size,
		room: () => room,
		/** WO-1101 Game World: the room adapter while enabled (salad-world.js). */
		worldAdapter: () => world?.adapter || null,
		/** WO-1125: the last operator host action closed the session (the core does not re-open it). */
		held: () => ctl.held(),
		venue: () => venue,
		polling: () => !!poll,
		pollOnce,
		baker,
		live: () => ({ lights, video }),
		MAX_SOCKETS,
		MAX_PER_ADDRESS,
	}
}

let _game = null

/** Smokes / the dev server: install a game built with injected deps as the process-wide one (null = forget it). */
function useSaladGame(game) {
	_game = game
}

/** The process-wide game (created on first use; port from the live config). */
function getSaladGame(ctx) {
	if (!_game) {
		_game = createSaladGame({
			ctx,
			port: () => Number(ctx?.config?.server?.httpPort) || 4200,
			log: (level, msg) => (typeof ctx?.log === 'function' ? ctx.log(level, msg) : undefined),
		})
	}
	return _game
}

/** Module shutdown: end the running session and forget the game; nothing is created. */
function shutdownSaladGame() {
	if (_game) _game.disable()
	_game = null
}

module.exports = { createSaladGame, getSaladGame, useSaladGame, shutdownSaladGame, MAX_SOCKETS, MAX_PER_ADDRESS, LEASE_ID }
