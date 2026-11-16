'use strict'

/**
 * WO-1081 — Stage Skirmish service: enabled flag (memory only, off after a restart), the room, the game sockets and the
 * served scene (sk-scene.js: the RC bake + arenas). Disabled it holds nothing (no room, no timers, no sockets, no
 * leases); disabling closes every game socket with `off` + 4403. The game never puts anything on a screen: no Caspar,
 * no looks, no layers, no project writes — it serves a web page, an API and a socket.
 * Live room (RC contract §2.6, through the kit exactly as rc-game.js does it): the rig's state (`lxfull` when a socket
 * attaches and on the host switch, `lx` deltas ≤ 10 / s while anyone is connected) and the LED wall pictures (binary
 * frames after `{ t: 'video', on: true }`), each with a host switch (`lights` / `wall`). The wall pictures lease the
 * roles under this module's own lease id (`toy-skirmish`), so the RC game's lease and ours never release each other.
 */

const { kit } = require('./sk-kit')
const { createSkRoom } = require('./sk-room')
const { createSkScene } = require('./sk-scene')
const { parseMessage } = require('./sk-sanitize')
const { setSkGameEnabled } = require('./sk-public')
const { RULES } = require('./sk-rules')

const MAX_SOCKETS = RULES.maxPlayers + RULES.maxSpectators
const MSG_RATE = 60 // messages / s per socket (20 states + automatic fire + its hits + pings), burst the same
const MAX_BUFFERED = 256 * 1024
const LEASE_ID = 'toy-skirmish'

/**
 * @param {{ port?: () => number, lanIps?: () => string[], log?: Function, now?: () => number, timers?: object, rng?: Function,
 *   baker?: object, bakerDeps?: object, ctx?: object, lightsDeps?: object, videoDeps?: object, pause?: Function }} deps
 *   ctx: the app context (production lights / video deps); lightsDeps / videoDeps: smokes and the dev server inject
 *   fakes instead (lightsDeps without `send` — the game's own sender is used). Without ctx and fakes: no lights, no pictures.
 */
function createSkGame(deps = {}) {
	const K = kit()
	const WebSocket = K.core('ws')
	const log = deps.log || (() => {})
	const now = deps.now || Date.now
	const port = deps.port || (() => 4200)
	const lanIps = deps.lanIps || (() => K.core('src/utils/lan-ipv4').getLanIPv4Addresses())
	const baker = deps.baker || K.createSceneBaker({ log, ...(deps.bakerDeps || {}) })
	const scene = createSkScene({ baker, log, pause: deps.pause })
	let room = null
	const sockets = new Set()
	let lastRev = null
	const text = new WeakMap() // message object → its JSON (a broadcast is stringified once)

	const json = (m) => {
		let s = text.get(m)
		if (!s) text.set(m, (s = JSON.stringify(m)))
		return s
	}
	// venue network first: 100.64/10 (VPN / carrier NAT) addresses are no use to a guest's phone, so they go last
	const cgnat = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
	const joinUrls = () => [...lanIps()].sort((a, b) => cgnat(a) - cgnat(b)).map((ip) => `http://${ip}:${port()}/game/sk/`)

	function sendTo(ws, m) {
		if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return
		try {
			ws.send(json(m))
		} catch {
			/* socket going away */
		}
	}

	// creating them costs nothing — no timer, no feed client, no lease until a socket attaches / asks
	// the wall pictures lease the roles under OUR id (also with injected deps), so the RC game's lease is never touched
	const vd = deps.videoDeps || (deps.ctx ? K.rcVideoDeps(deps.ctx, { log }) : null)
	const videoDeps = vd ? { ...vd, lease: (_id, roles) => (vd.lease ? vd.lease(LEASE_ID, roles) : undefined) } : null
	const lightsDeps = deps.lightsDeps || (deps.ctx ? K.rcLightsDeps(deps.ctx, { send: sendTo, log }) : null)
	const lights = lightsDeps ? K.createRcLights({ log, ...lightsDeps, send: sendTo }) : null
	const video = videoDeps ? K.createRcVideo({ log, ...videoDeps }) : null
	let house = true // WO-1099 house lights (as rc-game.js): off = the room dark in every client, the rig / walls / game lit
	const decorate = (s) => ({ enabled: true, ...s, joinUrls: joinUrls(), sceneRev: lastRev,
		lights: lights ? lights.isOn() : false, wall: video ? video.isOn() : false, house })

	/** Bake (or reuse) the scene + arenas and hand them to the room. */
	function refreshScene() {
		return scene.get().then((out) => {
			lastRev = out.rev
			if (room) room.setScene(out.json)
			video?.refresh()
			return out
		})
	}

	function rev() {
		const r = scene.rev()
		if (room && r !== lastRev) refreshScene().catch((e) => log('warn', `[toy-skirmish] scene failed: ${e.message}`))
		return r
	}

	function enable() {
		if (room) return
		room = createSkRoom({ now, timers: deps.timers, rng: deps.rng, send: sendTo, decorate, maxPlayers: RULES.maxPlayers, maxSpectators: RULES.maxSpectators,
			close: (ws, code, reason) => {
				try {
					ws.close(code, reason)
				} catch {
					/* already closed */
				}
			} })
		setSkGameEnabled(true)
		lastRev = scene.rev()
		refreshScene().catch((e) => log('warn', `[toy-skirmish] scene failed: ${e.message}`))
		log('info', '[toy-skirmish] enabled')
	}

	function disable() {
		if (!room) return
		setSkGameEnabled(false)
		for (const ws of sockets) {
			sendTo(ws, { t: 'off' })
			try {
				ws.close(4403, 'game disabled')
			} catch {
				/* gone */
			}
		}
		sockets.clear()
		lights?.stop()
		video?.stop() // closes the feed client and releases the lease
		room.dispose()
		room = null
		log('info', '[toy-skirmish] disabled')
	}

	/** POST /api/game/sk/host body → { status, body }. */
	function host(a) {
		const action = a && typeof a === 'object' ? String(a.action || '') : ''
		if (action === 'enable') enable()
		else if (action === 'disable') disable()
		else if (!room) return { status: 409, body: { ok: false, error: 'the game is not enabled', state: state() } }
		else {
			if (action === 'lights' || action === 'wall' || action === 'house') {
				if (typeof a.on !== 'boolean') return { status: 400, body: { ok: false, error: '`on` must be true or false', state: state() } }
				if (action === 'house') house = a.on // WO-1099: only state — every client dims its own room
				else (action === 'lights' ? lights : video)?.setOn(a.on)
			}
			const r = room.host(action, a)
			if (!r.ok) return { status: r.status || 400, body: { ok: false, error: r.error, state: state() } }
		}
		return { status: 200, body: { ok: true, state: state() } }
	}

	function state() {
		if (!room) return { enabled: false }
		rev()
		return room.state()
	}

	/** A new game socket (already upgraded). Disabled → `off` and close 4403. */
	function attach(ws) {
		ws.on('error', () => {})
		if (!room) {
			sendTo(ws, { t: 'off' })
			return ws.close(4403, 'game disabled')
		}
		if (sockets.size >= MAX_SOCKETS) return ws.close(1013, 'full')
		sockets.add(ws)
		room.connect(ws)
		lights?.attach(ws) // lxfull now (while on); the 10 Hz timer runs while ≥ 1 socket is attached
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
				if (room) video?.subscribe(ws, m.on === true) // never re-subscribe a socket the disable is closing
				return
			}
			if (room) room.handle(ws, m)
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
		/** The served scene (enabled only; the caller checks). */
		scene: () => refreshScene(),
		/** The served scene + the live `lights` / `screens` (spliced into the cached text). */
		sceneWithLive: () =>
			refreshScene().then((out) => ({ ...out,
				text: K.withLiveScene(out.text, { lights: lights ? lights.list() : [], screens: videoDeps?.screens ? videoDeps.screens() : [] }) })),
		attach,
		socketCount: () => sockets.size,
		room: () => room,
		baker,
		live: () => ({ lights, video }),
		MAX_SOCKETS,
	}
}

let _game = null

/** Smokes / the dev server: install a game built with injected deps as the process-wide one (null = forget it). */
function useSkGame(game) {
	_game = game
}

/** The process-wide game (created on first use; port from the live config). */
function getSkGame(ctx) {
	if (!_game) {
		_game = createSkGame({
			ctx,
			port: () => Number(ctx?.config?.server?.httpPort) || 4200,
			log: (level, msg) => (typeof ctx?.log === 'function' ? ctx.log(level, msg) : undefined),
		})
	}
	return _game
}

/** Module shutdown: end the running session (sockets, lights, wall feed) and forget the game; nothing is created. */
function shutdownSkGame() {
	if (_game) _game.disable()
	_game = null
}

module.exports = { createSkGame, getSkGame, useSkGame, shutdownSkGame, MAX_SOCKETS, LEASE_ID }
