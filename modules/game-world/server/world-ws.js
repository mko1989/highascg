'use strict'

/**
 * WO-1101 — the world pages' socket `/api/game/world/ws` (also under the Companion-style `/instance/<id>` prefix), work/
 * notes/game-world-contract.md §3. Its own `upgrade` listener next to the core's and the games' (other paths are left
 * alone). Spectator only: the server talks, the page listens — `{ t: 'hello', v: 1, state }`, then from the hub `wst`,
 * `wv` (all games, cap 80), `{ t: 'board', games }` 2 Hz and `{ t: 'xev', … }`. Incoming frames are ignored (≤ 2 KB,
 * bigger ones closed by ws with 1009; > 20 per second closes 1008). No API password: public exactly while a game session
 * runs (world-public.js); otherwise the socket is accepted only to say `{ t: 'off' }` and close with 4403. At most 20
 * sockets (the 21st upgrade gets 503) — a rejected socket counts too until it has closed (WO-1106 A18). The Origin
 * check of src/server/auth.js applies (403).
 * WO-1106 A15: a page that stops reading (> 256 KB waiting in its socket) is terminated, and every socket is pinged
 * every 15 s — no pong by the next ping (15–30 s) → terminated. WO-1106 A18: the last game gone → the hub calls each
 * page's off() (`{ t: 'off' }` + close 4403); the ping sweep checks the same as a backstop.
 */

const { core } = require('./host')
const { anyGameEnabled } = require('./world-public')

const WS_PATH = '/api/game/world/ws'
const MAX_SOCKETS = 20
const MAX_MESSAGE_BYTES = 2048
const MSG_RATE = 20
const MAX_BUFFERED = 256 * 1024
const PING_MS = 15000

const ESC = WS_PATH.replace(/\//g, '\\/')
const INSTANCE = new RegExp(`^/instance/[^/]+${ESC}$`)

function isWorldWsPath(url) {
	const p = String(url || '').split('?')[0]
	return p === WS_PATH || INSTANCE.test(p)
}

const unrefTimers = {
	setInterval(fn, ms) {
		const t = setInterval(fn, ms)
		if (t && typeof t.unref === 'function') t.unref()
		return t
	},
	clearInterval: (t) => clearInterval(t),
}
const kill = (ws) => {
	try {
		ws.terminate()
	} catch {}
}

/**
 * @param {import('http').Server} httpServer
 * @param {object} ctx
 * @param {{ hub: object, service: object, registry: object, now?: () => number, WebSocket?: object,
 *   timers?: { setInterval, clearInterval } }} deps  WebSocket / timers: the smokes' fakes
 */
function attachWorldWs(httpServer, ctx, deps) {
	const WebSocket = deps.WebSocket || core('ws')
	const T = deps.timers || unrefTimers
	const { hub, service, registry: reg } = deps
	const now = deps.now || Date.now
	const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })
	const socks = new Set() // every socket until it has closed, rejected ones too (A18)
	const alive = new Set() // answered the last ping (A15)
	let pinger = null

	/** → true when handed to the socket (the hub re-sends what was not, WO-1106 A5). */
	const send = (ws, m) => {
		if (ws.readyState !== WebSocket.OPEN) return false
		if (ws.bufferedAmount > MAX_BUFFERED) return (kill(ws), false) // A15: the page stopped reading
		ws.send(JSON.stringify(m))
		return true
	}
	const sayOff = (ws) => {
		if (ws.readyState !== WebSocket.OPEN) return
		send(ws, { t: 'off' })
		ws.close(4403, 'no game running')
	}

	/** A15: ping liveness; A18 backstop: no game enabled any more → off + 4403. */
	function sweep() {
		const off = !anyGameEnabled(reg)
		for (const ws of [...socks]) {
			if (!alive.has(ws)) {
				kill(ws)
				continue
			}
			alive.delete(ws)
			if (off) sayOff(ws)
			else if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.ping()
				} catch {}
			}
		}
	}
	function track(ws) {
		socks.add(ws)
		alive.add(ws)
		ws.on('pong', () => {
			if (socks.has(ws)) alive.add(ws)
		})
		ws.on('close', () => {
			socks.delete(ws)
			alive.delete(ws)
			if (!socks.size && pinger) (T.clearInterval(pinger), (pinger = null))
		})
		if (!pinger) pinger = T.setInterval(sweep, PING_MS)
	}

	function onConnection(ws) {
		ws.on('error', () => {})
		track(ws)
		if (!anyGameEnabled(reg)) return sayOff(ws)
		const h = hub.openWorld((m) => send(ws, m), () => sayOff(ws))
		if (!h) return ws.close(1013, 'full')
		ws.on('close', () => h.close())
		let state
		try {
			state = service.state()
		} catch {
			state = { on: false, v: 1, games: [] }
		}
		send(ws, { t: 'hello', v: 1, state })
		let tokens = MSG_RATE
		let at = now()
		ws.on('message', () => {
			const t = now()
			tokens = Math.min(MSG_RATE, tokens + ((t - at) / 1000) * MSG_RATE)
			at = t
			if (--tokens < 0) ws.close(1008, 'rate')
		})
	}

	const onUpgrade = (req, socket, head) => {
		if (!isWorldWsPath(req.url)) return
		const { isOriginAllowed } = core('src/server/auth')
		if (!isOriginAllowed(req, ctx && ctx.config)) {
			socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
			return socket.destroy()
		}
		if (socks.size >= MAX_SOCKETS) {
			socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
			return socket.destroy()
		}
		wss.handleUpgrade(req, socket, head, onConnection)
	}
	httpServer.on('upgrade', onUpgrade)
	return {
		count: () => socks.size,
		close() {
			httpServer.removeListener('upgrade', onUpgrade)
			if (pinger) (T.clearInterval(pinger), (pinger = null))
			for (const ws of socks) kill(ws)
			socks.clear()
			alive.clear()
			wss.close()
		},
	}
}

module.exports = { attachWorldWs, isWorldWsPath, WS_PATH, MAX_SOCKETS, MAX_BUFFERED, PING_MS }
