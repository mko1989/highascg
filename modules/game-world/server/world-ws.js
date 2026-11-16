'use strict'

/**
 * WO-1101 — the world pages' socket `/api/game/world/ws` (also under the Companion-style `/instance/<id>` prefix), work/
 * notes/game-world-contract.md §3. Its own `upgrade` listener next to the core's and the games' (other paths are left
 * alone). Spectator only: the server talks, the page listens — `{ t: 'hello', v: 1, state }`, then from the hub `wst`,
 * `wv` (all games, cap 80), `{ t: 'board', games }` 2 Hz and `{ t: 'xev', … }`. Incoming frames are ignored (≤ 2 KB,
 * bigger ones closed by ws with 1009; > 20 per second closes 1008). No API password: public exactly while a game session
 * runs (world-public.js); otherwise the socket is accepted only to say `{ t: 'off' }` and close with 4403. At most 20
 * sockets (the 21st upgrade gets 503). The Origin check of src/server/auth.js applies (403).
 */

const { core } = require('./host')
const { anyGameEnabled } = require('./world-public')

const WS_PATH = '/api/game/world/ws'
const MAX_SOCKETS = 20
const MAX_MESSAGE_BYTES = 2048
const MSG_RATE = 20

const ESC = WS_PATH.replace(/\//g, '\\/')
const INSTANCE = new RegExp(`^/instance/[^/]+${ESC}$`)

function isWorldWsPath(url) {
	const p = String(url || '').split('?')[0]
	return p === WS_PATH || INSTANCE.test(p)
}

/**
 * @param {import('http').Server} httpServer
 * @param {object} ctx
 * @param {{ hub: object, service: object, registry: object, now?: () => number }} deps
 */
function attachWorldWs(httpServer, ctx, deps) {
	const WebSocket = core('ws')
	const { hub, service, registry: reg } = deps
	const now = deps.now || Date.now
	const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })
	const socks = new Set()
	const send = (ws, m) => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
	}

	function onConnection(ws) {
		ws.on('error', () => {})
		if (!anyGameEnabled(reg)) {
			send(ws, { t: 'off' })
			return ws.close(4403, 'no game running')
		}
		const h = hub.openWorld((m) => send(ws, m))
		if (!h) return ws.close(1013, 'full')
		socks.add(ws)
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
		ws.on('close', () => {
			socks.delete(ws)
			h.close()
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
			for (const ws of socks) {
				try {
					ws.terminate()
				} catch {}
			}
			socks.clear()
			wss.close()
		},
	}
}

module.exports = { attachWorldWs, isWorldWsPath, WS_PATH, MAX_SOCKETS }
