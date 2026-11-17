'use strict'

/**
 * WO-1081 — the Stage Skirmish socket `/api/game/sk/ws` (also under the Companion-style `/instance/<id>` prefix). Its
 * own `upgrade` listener: other paths are left alone for the other listeners. No API password — the socket is public
 * exactly while a session is enabled; disabled, it is accepted only to say `off` and close with 4403. Frames are capped
 * at 2 KB (the RC cap through the kit; ws closes bigger ones with 1009); caps and rate limits in sk-game.js.
 */

const { kit } = require('./sk-kit')

const WS_PATH = '/api/game/sk/ws'
const INSTANCE_RE = new RegExp(`^/instance/[^/]+${WS_PATH.replace(/\//g, '\\/')}$`)

function isSkWsPath(url) {
	const p = String(url || '').split('?')[0]
	return p === WS_PATH || INSTANCE_RE.test(p)
}

/**
 * @param {import('http').Server} httpServer
 * @param {object} ctx  @param {{ game?: object }} [opts] — the game service (default: the process-wide one)
 */
function attachSkWs(httpServer, ctx, opts = {}) {
	const K = kit()
	const WebSocket = K.core('ws')
	const gameOf = () => opts.game || require('./sk-game').getSkGame(ctx) // per upgrade: the process-wide game may be replaced
	const wss = new WebSocket.Server({ noServer: true, maxPayload: K.MAX_MESSAGE_BYTES, perMessageDeflate: false })
	const onUpgrade = (req, socket, head) => {
		if (!isSkWsPath(req.url)) return
		if (!K.core('src/server/auth').isOriginAllowed(req, ctx?.config)) {
			socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
			return socket.destroy()
		}
		const game = gameOf()
		if (game.isEnabled() && game.socketCount() >= game.MAX_SOCKETS) {
			socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
			return socket.destroy()
		}
		wss.handleUpgrade(req, socket, head, (ws) => game.attach(ws, req.socket?.remoteAddress)) // WO-1106 B36: the per-address cap
	}
	httpServer.on('upgrade', onUpgrade)
	return {
		close() {
			httpServer.removeListener('upgrade', onUpgrade)
			wss.close()
		},
	}
}

module.exports = { attachSkWs, isSkWsPath, WS_PATH }
