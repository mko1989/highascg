'use strict'

/**
 * WO-1074 — RC car game service: enabled flag (memory only, off after a restart), the room, the game sockets and the
 * baked scene. Disabled it holds nothing (no room, no timers, no sockets); disabling closes every game socket with 4403.
 * The game never puts anything on a screen: no Caspar, no looks, no layers — it serves a web page, an API and a socket.
 * §2.6 (rc-lights.js, rc-video.js): the live lighting state and the LED wall pictures inside the game world, each with a
 * host switch (`lights` / `wall`); both idle (no timer, no feed client, no lease) while disabled or nobody is connected.
 */

const { core } = require('./host')
const WebSocket = core('ws')
const { createRcRoom } = require('./rc-room')
const { createRoomBots, MAX_BOTS, LEVELS } = require('./rc-room-bots')
const { createSceneBaker, setSceneCtx } = require('./rc-scene')
const { parseMessage } = require('./rc-sanitize')
const { setRcGameEnabled } = require('./rc-public')
const { createRcLights, rcLightsDeps, withLiveScene } = require('./rc-lights')
const { createRcVideo, rcVideoDeps } = require('./rc-video')

const MAX_PLAYERS = 10
const MAX_SPECTATORS = 20
const MAX_SOCKETS = MAX_PLAYERS + MAX_SPECTATORS
const MSG_RATE = 40 // messages / s per socket (20 car states + pings + ready), burst the same
const MAX_BUFFERED = 256 * 1024

/**
 * @param {{ port?: () => number, lanIps?: () => string[], log?: Function, now?: () => number, timers?: object,
 *   baker?: object, bakerDeps?: object, ctx?: object, lightsDeps?: object, videoDeps?: object }} deps
 *   ctx: the app context (production lights / video deps); lightsDeps / videoDeps: smokes inject fakes instead
 *   (lightsDeps without `send` — the game's own sender is used). Without ctx and fakes: no lights, no pictures.
 */
function createRcGame(deps = {}) {
	const log = deps.log || (() => {})
	const now = deps.now || Date.now
	const port = deps.port || (() => 4200)
	const lanIps = deps.lanIps || (() => core('src/utils/lan-ipv4').getLanIPv4Addresses())
	const baker = deps.baker || createSceneBaker({ log, ...(deps.bakerDeps || {}) })
	let room = null
	let bots = null // WO-1082: rc-room-bots.js while enabled
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
	const joinUrls = () => [...lanIps()].sort((a, b) => cgnat(a) - cgnat(b)).map((ip) => `http://${ip}:${port()}/game/rc/`)

	function sendTo(ws, m) {
		if (ws.botSink) return ws.botSink(m) // WO-1082: a server bot's virtual socket (rc-room-bots.js)
		if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return
		try {
			ws.send(json(m))
		} catch {
			/* socket going away */
		}
	}

	// §2.6: creating them costs nothing — no timer, no feed client, no lease until a socket attaches / asks
	const videoDeps = deps.videoDeps || (deps.ctx ? rcVideoDeps(deps.ctx, { log }) : null)
	const lightsDeps = deps.lightsDeps || (deps.ctx ? rcLightsDeps(deps.ctx, { send: sendTo, log }) : null)
	const lights = lightsDeps ? createRcLights({ log, ...lightsDeps, send: sendTo }) : null
	const video = videoDeps ? createRcVideo({ log, ...videoDeps }) : null
	let house = true // WO-1099 house lights: the room's general light in the game world (off = only the rig, walls, game lights)
	const decorate = (s) => ({ enabled: true, ...s, joinUrls: joinUrls(), sceneRev: lastRev,
		lights: lights ? lights.isOn() : false, wall: video ? video.isOn() : false, house, bots: bots ? bots.count() : 0, botLevel: bots ? bots.level() : 'normal' })

	/** Bake (or reuse) the current scene and hand its tracks to the room. Errors are logged, not thrown. */
	function refreshScene() {
		return baker.get().then((out) => {
			lastRev = out.rev
			if (room) room.setScene(out.json)
			bots?.setScene(out.json)
			video?.refresh() // walls may have moved / changed source
			return out
		})
	}

	function rev() {
		const r = baker.rev()
		if (room && r !== lastRev) refreshScene().catch((e) => log('warn', `[rc-game] scene bake failed: ${e.message}`))
		return r
	}

	function enable() {
		if (room) return
		room = createRcRoom({ now, timers: deps.timers, send: sendTo, decorate, maxPlayers: MAX_PLAYERS, maxSpectators: MAX_SPECTATORS,
			close: (ws, code, reason) => {
				try {
					ws.close(code, reason)
				} catch {
					/* already closed */
				}
			} })
		const r = room
		bots = createRoomBots({ now, timers: deps.timers, log, load: deps.loadBots,
			connect: (c) => r.connect(c), handle: (c, m) => r.handle(c, m), disconnect: (c) => r.disconnect(c) })
		bots.preload()
		setRcGameEnabled(true)
		lastRev = baker.rev()
		refreshScene().catch((e) => log('warn', `[rc-game] scene bake failed: ${e.message}`))
		log('info', '[rc-game] enabled')
	}

	function disable() {
		if (!room) return
		setRcGameEnabled(false)
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
		video?.stop() // closes the feed client (its worker stops if nobody else watches) and releases the lease
		bots?.dispose()
		bots = null
		room.dispose()
		room = null
		log('info', '[rc-game] disabled')
	}

	/** POST /api/game/rc/host body → { status, body }. */
	function host(a) {
		const action = a && typeof a === 'object' ? String(a.action || '') : ''
		if (action === 'enable') enable()
		else if (action === 'disable') disable()
		else if (!room) return { status: 409, body: { ok: false, error: 'the game is not enabled', state: state() } }
		else {
			if (action === 'lights' || action === 'wall' || action === 'house') {
				if (typeof a.on !== 'boolean') return { status: 400, body: { ok: false, error: '`on` must be true or false', state: state() } }
				if (action === 'house') house = a.on // only state: every client dims its own room (world.js setHouse)
				else (action === 'lights' ? lights : video)?.setOn(a.on)
			}
			if (action === 'bots') {
				const n = Number(a.count)
				if (!Number.isInteger(n) || n < 0 || n > MAX_BOTS) return { status: 400, body: { ok: false, error: `count 0–${MAX_BOTS}`, state: state() } }
				if (a.level != null && !LEVELS[a.level]) return { status: 400, body: { ok: false, error: 'level easy | normal | hard', state: state() } }
				const ph = room.state().phase
				if (ph !== 'lobby' && ph !== 'results') return { status: 409, body: { ok: false, error: 'a race is running', state: state() } }
				bots.setCount(n, a.level)
				return { status: 200, body: { ok: true, state: state() } }
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
		lights?.attach(ws) // sends lxfull now (while on); the 10 Hz timer runs while ≥ 1 socket is attached
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
		/** The baked scene (enabled only; the caller checks). */
		scene: () => refreshScene(),
		/** The baked scene + the live `lights` / `screens` (spliced into the cached text; the bake and its rev stay as they are). */
		sceneWithLive: () =>
			refreshScene().then((out) => ({ ...out,
				text: withLiveScene(out.text, { lights: lights ? lights.list() : [], screens: videoDeps ? videoDeps.screens() : [] }) })),
		attach,
		socketCount: () => sockets.size,
		room: () => room,
		baker,
		/** §2.6 smokes / probes. */
		live: () => ({ lights, video }),
		MAX_SOCKETS,
	}
}

let _game = null

/** Smokes: install a game built with injected deps (synthetic project, temp cache) as the process-wide one. */
function useRcGame(game) {
	_game = game
}

/** The process-wide game (created on first use; port from the live config). */
function getRcGame(ctx) {
	setSceneCtx(ctx) // WO-1082: the venue .glb is looked up in this context's project folder
	if (!_game) {
		_game = createRcGame({
			ctx,
			port: () => Number(ctx?.config?.server?.httpPort) || 4200,
			log: (level, msg) => (typeof ctx?.log === 'function' ? ctx.log(level, msg) : undefined),
		})
	}
	return _game
}

module.exports = { createRcGame, getRcGame, useRcGame, MAX_SOCKETS }
