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
const { createRcRoom, MAX_LAPS } = require('./rc-room')
const { createRoomBots, MAX_BOTS, LEVELS } = require('./rc-room-bots')
const { createSceneBaker, setSceneCtx } = require('./rc-scene')
const { parseMessage } = require('./rc-sanitize')
const { setRcGameEnabled } = require('./rc-public')
const { createRcLights, rcLightsDeps, withLiveScene } = require('./rc-lights')
const { createRcVideo, rcVideoDeps } = require('./rc-video')
const { createRcWorld } = require('./rc-world')
const { createGameCtl, intIn } = require('./rc-ctl')

const MAX_PLAYERS = 10
const MAX_SPECTATORS = 20
const MAX_SOCKETS = MAX_PLAYERS + MAX_SPECTATORS
const MSG_RATE = 40 // messages / s per socket (20 car states + pings + ready), burst the same
const MAX_BUFFERED = 256 * 1024
const MAX_PER_ADDRESS = 0 // WO-1106 B36: default per-address cap, 0 = off (phones behind NAT'd guest Wi-Fi share one address); deps.maxPerAddress turns it on

/** The client's address for the per-address cap; null when unknown or loopback (a local proxy / the box itself). */
function remoteAddress(req) {
	const a = String(req?.socket?.remoteAddress || '').replace(/^::ffff:/, '')
	return !a || a === '::1' || /^127\./.test(a) ? null : a
}

/**
 * @param {{ port?: () => number, lanIps?: () => string[], log?: Function, now?: () => number, timers?: object,
 *   baker?: object, bakerDeps?: object, ctx?: object, lightsDeps?: object, videoDeps?: object, maxPerAddress?: number }} deps
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
	let world = null // WO-1101 Game World link while enabled (does nothing without the world module)
	const sockets = new Set()
	const maxPerAddress = Number(deps.maxPerAddress ?? MAX_PER_ADDRESS) || 0
	const perAddress = new Map() // remote address → open game sockets (WO-1106 B36)
	let lastRev = null
	let appliedRev = null // WO-1106 B37: the rev the room / bots hold (null = none yet in this session)
	const text = new WeakMap() // message object → its JSON (a broadcast is stringified once)

	const json = (m) => {
		let s = text.get(m)
		if (!s) text.set(m, (s = JSON.stringify(m)))
		return s
	}
	// WO-1106 B53: 100.64/10 (VPN / carrier NAT) addresses are no use to a guest's phone and must not reach the public state
	const cgnat = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
	const joinUrls = () => [...lanIps()].filter((ip) => !cgnat(ip)).map((ip) => `http://${ip}:${port()}/game/rc/`)

	/** → true when handed to the socket (or a bot), false when skipped: not open, over MAX_BUFFERED, send threw (WO-1106 A5). */
	function sendTo(ws, m) {
		if (ws.botSink) {
			ws.botSink(m) // WO-1082: a server bot's virtual socket (rc-room-bots.js)
			return true
		}
		if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return false
		try {
			ws.send(json(m))
			return true
		} catch {
			return false // socket going away
		}
	}

	// §2.6: creating them costs nothing — no timer, no feed client, no lease until a socket attaches / asks
	const videoDeps = deps.videoDeps || (deps.ctx ? rcVideoDeps(deps.ctx, { log }) : null)
	const lightsDeps = deps.lightsDeps || (deps.ctx ? rcLightsDeps(deps.ctx, { send: sendTo, log }) : null)
	const lights = lightsDeps ? createRcLights({ log, ...lightsDeps, send: sendTo }) : null
	const video = videoDeps ? createRcVideo({ log, ...videoDeps }) : null
	let house = 1 // WO-1099 house lights LEVEL 0..1 (1 = the room lit): every client dims its own room (world.js setHouse); lives like lights / wall
	let trackList = [] // WO-1125: the baked scene's tracks as the session panel lists them ({ id, title })
	const decorate = (s) => ({ enabled: true, ...s, joinUrls: joinUrls(), sceneRev: lastRev,
		lights: lights ? lights.isOn() : false, wall: video ? video.isOn() : false, house, bots: bots ? bots.count() : 0, botLevel: bots ? bots.level() : 'normal',
		self: ctl.self(), tracks: trackList, botMax: MAX_BOTS })
	/** WO-1125 §3: players' `ctl` → this service's host() (the operator's path); `self` from the core (games.selfService). */
	const ctlHost = (b) => {
		const r = host(b)
		if (b.action === 'bots' && r.status < 300) room?.host('house', {}) // `bots` alone pushes nothing until a bot joins / leaves
		return r
	}
	const ctl = createGameCtl({ game: 'rc-game', log, now, send: sendTo, host: ctlHost, world: () => room?.world() || null,
		keys: { track: (v) => (typeof v === 'string' && v.length <= 64 ? [{ action: 'track', trackId: v }] : null),
			laps: (v) => (intIn(v, 1, MAX_LAPS) != null ? [{ action: 'laps', laps: v }] : null) },
		bots: (n, level) => [{ action: 'bots', count: n, ...(level ? { level } : {}) }] })

	/**
	 * Bake (or reuse) the current scene and hand its tracks to the room. Errors are logged, not thrown. WO-1106 B37: only
	 * a new rev reaches the room and the bots — every `/scene` GET lands here, and bots.setScene sends every bot back to the grid.
	 */
	function refreshScene() {
		return baker.get().then((out) => {
			lastRev = out.rev
			if (room && out.rev !== appliedRev) {
				appliedRev = out.rev
				trackList = (Array.isArray(out.json?.tracks) ? out.json.tracks : []).map((t) => ({ id: String(t.id), title: String(t.name || t.id) }))
				room.setScene(out.json)
				bots?.setScene(out.json)
			}
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
			connect: (c) => r.connect(c), handle: (c, m) => r.handle(c, m), disconnect: (c) => r.disconnect(c),
			patches: () => world?.patches() || [] }) // WO-1106 A35: R2 slick patches reach the bots as they reach the players
		bots.preload()
		world = createRcWorld({ room: () => room, send: sendTo, lights, now })
		setRcGameEnabled(true)
		lastRev = baker.rev()
		appliedRev = null // a new room has no scene yet
		refreshScene().catch((e) => log('warn', `[rc-game] scene bake failed: ${e.message}`))
		world.attach()
		log('info', '[rc-game] enabled')
	}

	function disable() {
		if (!room) return
		world?.detach()
		world = null
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
		appliedRev = null
		baker.drop?.() // WO-1106 B52: disabled holds nothing — not the last bake (~10 MB) either
		log('info', '[rc-game] disabled')
	}

	/** POST /api/game/rc/host body → { status, body }. */
	function host(a) {
		const action = a && typeof a === 'object' ? String(a.action || '') : ''
		if (action === 'self') return ctl.hostSelf(a, state, () => room?.host('house', {})) // WO-1125: room 'house' = only the state push
		ctl.note(action) // WO-1125: an operator's disable holds the session closed for games.selfService
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
			if (action === 'bots') {
				const n = Number(a.count)
				if (!Number.isInteger(n) || n < 0 || n > MAX_BOTS) return { status: 400, body: { ok: false, error: `count 0–${MAX_BOTS}`, state: state() } }
				// WO-1106 A23: own keys only (`constructor` passed `LEVELS[x]`, then add() threw)
				if (a.level != null && !Object.hasOwn(LEVELS, a.level)) return { status: 400, body: { ok: false, error: 'level easy | normal | hard', state: state() } }
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

	/** A new game socket (already upgraded; req = its upgrade request). Disabled → `off` and close 4403. */
	function attach(ws, req) {
		ws.on('error', () => {})
		if (!room) {
			sendTo(ws, { t: 'off' })
			return ws.close(4403, 'game disabled')
		}
		if (sockets.size >= MAX_SOCKETS) return ws.close(1013, 'full')
		const addr = remoteAddress(req)
		if (addr && maxPerAddress > 0 && (perAddress.get(addr) || 0) >= maxPerAddress) return ws.close(1013, 'too many from this address')
		if (addr) perAddress.set(addr, (perAddress.get(addr) || 0) + 1)
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
			if (m.t === 'wq') return world?.quality(ws, m) // WO-1101: the visitor cap of the client's quality tier
			if (m.t === 'ctl') return room ? ctl.handle(ws, m) : undefined // WO-1125 §3 player control
			if (room && room.handle(ws, m) === 'bad' && ++bad > 20) ws.close(1008, 'invalid') // WO-1106 B34: a wrong resume token
		})
		ws.on('close', () => {
			sockets.delete(ws)
			const n = addr ? (perAddress.get(addr) || 1) - 1 : 0
			if (n > 0) perAddress.set(addr, n)
			else if (addr) perAddress.delete(addr)
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
		/** WO-1101 Game World: the room adapter while enabled (rc-world.js). */
		worldAdapter: () => world?.adapter || null,
		/** WO-1125: the last operator host action closed the session (the core does not re-open it). */
		held: () => ctl.held(),
		baker,
		/** §2.6 smokes / probes. */
		live: () => ({ lights, video }),
		MAX_SOCKETS,
		MAX_PER_ADDRESS,
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

module.exports = { createRcGame, getRcGame, useRcGame, MAX_SOCKETS, MAX_PER_ADDRESS, remoteAddress }
