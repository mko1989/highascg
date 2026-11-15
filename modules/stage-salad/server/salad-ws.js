'use strict'

/**
 * WO-1089 — the Stage Salad socket `/api/game/salad/ws` (also under the Companion-style `/instance/<id>` prefix). Its
 * own `upgrade` listener: other paths are left alone. No API password — public exactly while a session is enabled;
 * disabled, a socket is accepted only to say `off` and close with 4403. Frames capped at 2 KB (the kit's cap).
 */

const { kit } = require('./salad-kit')

const WS_PATH = '/api/game/salad/ws'
const INSTANCE_RE = new RegExp(`^/instance/[^/]+${WS_PATH.replace(/\//g, '\\/')}$`)

function isSaladWsPath(url) {
	const p = String(url || '').split('?')[0]
	return p === WS_PATH || INSTANCE_RE.test(p)
}

/** @param {import('http').Server} httpServer @param {object} ctx @param {{ game?: object }} [opts] */
function attachSaladWs(httpServer, ctx, opts = {}) {
	const K = kit()
	const WebSocket = K.core('ws')
	const gameOf = () => opts.game || require('./salad-game').getSaladGame(ctx)
	const wss = new WebSocket.Server({ noServer: true, maxPayload: K.MAX_MESSAGE_BYTES, perMessageDeflate: false })
	const onUpgrade = (req, socket, head) => {
		if (!isSaladWsPath(req.url)) return
		if (!K.core('src/server/auth').isOriginAllowed(req, ctx?.config)) {
			socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
			return socket.destroy()
		}
		const game = gameOf()
		if (game.isEnabled() && game.socketCount() >= game.MAX_SOCKETS) {
			socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
			return socket.destroy()
		}
		wss.handleUpgrade(req, socket, head, (ws) => game.attach(ws))
	}
	httpServer.on('upgrade', onUpgrade)
	return {
		close() {
			httpServer.removeListener('upgrade', onUpgrade)
			wss.close()
		},
	}
}

module.exports = { attachSaladWs, isSaladWsPath, WS_PATH }
