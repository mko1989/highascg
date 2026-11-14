'use strict'

/**
 * WO-1074 — RC car game service: enabled flag (memory only, off after a restart), the room, the game sockets and the
 * baked scene. Disabled it holds nothing (no room, no timers, no sockets); disabling closes every game socket with 4403.
 * The game never puts anything on a screen: no Caspar, no looks, no layers — it serves a web page, an API and a socket.
 */

const WebSocket = require('ws')
const { createRcRoom } = require('./rc-room')
const { createSceneBaker } = require('./rc-scene')
const { parseMessage } = require('./rc-sanitize')
const { setRcGameEnabled } = require('./rc-public')

const MAX_PLAYERS = 10
const MAX_SPECTATORS = 20
const MAX_SOCKETS = MAX_PLAYERS + MAX_SPECTATORS
const MSG_RATE = 40 // messages / s per socket (20 car states + pings + ready), burst the same
const MAX_BUFFERED = 256 * 1024

/**
 * @param {{ port?: () => number, lanIps?: () => string[], log?: Function, now?: () => number, timers?: object,
 *   baker?: object, bakerDeps?: object }} deps
 */
function createRcGame(deps = {}) {
	const log = deps.log || (() => {})
	const now = deps.now || Date.now
	const port = deps.port || (() => 4200)
	const lanIps = deps.lanIps || (() => require('../utils/lan-ipv4').getLanIPv4Addresses())
	const baker = deps.baker || createSceneBaker({ log, ...(deps.bakerDeps || {}) })
	let room = null
	const sockets = new Set()
	let lastRev = null
	const text = new WeakMap() // message object → its JSON (a broadcast is stringified once)

	const json = (m) => {
		let s = text.get(m)
		if (!s) text.set(m, (s = JSON.stringify(m)))
		return s
	}
	const joinUrls = () => lanIps().map((ip) => `http://${ip}:${port()}/game/rc/`)
	const decorate = (s) => ({ enabled: true, ...s, joinUrls: joinUrls(), sceneRev: lastRev })

	function sendTo(ws, m) {
		if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return
		try {
			ws.send(json(m))
		} catch {
			/* socket going away */
		}
	}

	/** Bake (or reuse) the current scene and hand its tracks to the room. Errors are logged, not thrown. */
	function refreshScene() {
		return baker.get().then((out) => {
			lastRev = out.rev
			if (room) room.setScene(out.json)
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
			if (room) room.handle(ws, m)
		})
		ws.on('close', () => {
			sockets.delete(ws)
			if (room) room.disconnect(ws)
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
		attach,
		socketCount: () => sockets.size,
		room: () => room,
		baker,
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
	if (!_game) {
		_game = createRcGame({
			port: () => Number(ctx?.config?.server?.httpPort) || 4200,
			log: (level, msg) => (typeof ctx?.log === 'function' ? ctx.log(level, msg) : undefined),
		})
	}
	return _game
}

module.exports = { createRcGame, getRcGame, useRcGame, MAX_SOCKETS }
