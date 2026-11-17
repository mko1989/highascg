'use strict'

/**
 * WO-1074 — the RC game socket `/api/game/rc/ws` (also under the Companion-style `/instance/<id>` prefix). Its own
 * `upgrade` listener next to src/server/ws-server.js: other paths are left alone for the other listeners. No API
 * password — the socket is public exactly while the game is enabled; disabled, it is accepted only to say `off` and
 * close with 4403. Frames are capped at 2 KB (ws closes bigger ones with 1009); caps and rate limits in rc-game.js.
 */

const { core } = require('./host')
const WebSocket = core('ws')
const { MAX_MESSAGE_BYTES } = require('./rc-sanitize')

const WS_PATH = '/api/game/rc/ws'

function isGamePath(url) {
	const p = String(url || '').split('?')[0]
	return p === WS_PATH || new RegExp(`^/instance/[^/]+${WS_PATH.replace(/\//g, '\\/')}$`).test(p)
}

/**
 * @param {import('http').Server} httpServer
 * @param {object} ctx  @param {{ game?: object }} [opts] — the game service (default: the process-wide one)
 */
function attachRcGameWs(httpServer, ctx, opts = {}) {
	const game = opts.game || require('./rc-game').getRcGame(ctx)
	const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })
	const onUpgrade = (req, socket, head) => {
		if (!isGamePath(req.url)) return
		const { isOriginAllowed } = core('src/server/auth')
		if (!isOriginAllowed(req, ctx?.config)) {
			socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
			return socket.destroy()
		}
		if (game.isEnabled() && game.socketCount() >= game.MAX_SOCKETS) {
			socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
			return socket.destroy()
		}
		wss.handleUpgrade(req, socket, head, (ws) => game.attach(ws, req)) // req: the per-address cap (WO-1106 B36)
	}
	httpServer.on('upgrade', onUpgrade)
	return {
		close() {
			httpServer.removeListener('upgrade', onUpgrade)
			wss.close()
		},
	}
}

module.exports = { attachRcGameWs, isGamePath, WS_PATH }
