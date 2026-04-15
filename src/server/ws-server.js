/**
 * WebSocket server on the same HTTP port (upgrade `/api/ws`, `/ws`, and Companion-style `/instance/<id>/api/ws`).
 * @see companion-module-casparcg-server/src/web-server.js
 */

'use strict'

const WebSocket = require('ws')

/**
 * @typedef {object} WsAppContext
 * @property {import('../state/state-manager').StateManager} [state]
 * @property {import('../caspar/amcp-client').AmcpClient} [amcp]
 * @property {Record<string, unknown>} [config]
 * @property {Record<string, string>} [variables]
 * @property {object} [persistence] — default: `../utils/persistence`
 * @property {(_ctx: WsAppContext, data: unknown) => void} [setUiSelection]
 * @property {(level: string, msg: string) => void} [log]
 * @property {() => object} [getState] — override snapshot for `state` messages
 */

/**
 * @param {import('http').Server} httpServer
 * @param {WsAppContext} ctx — `_wsBroadcast` is assigned here
 * @param {{
 *   stateBroadcastIntervalMs?: number,
 *   log?: (msg: string) => void,
 * }} [options]
 */
function attachWebSocketServer(httpServer, ctx, options = {}) {
	const log = options.log || (() => {})
	const intervalMs = options.stateBroadcastIntervalMs ?? 0
	const clients = new Set()
	const wss = new WebSocket.Server({ noServer: true })

	function safeStringify(payload) {
		try {
			return JSON.stringify(payload)
		} catch (e) {
			log('ws JSON.stringify failed: ' + (e?.message || e))
			return JSON.stringify({
				type: 'error',
				data: 'State serialization failed — check server logs',
			})
		}
	}

	function getSnapshot() {
		if (typeof ctx.getState === 'function') return ctx.getState()
		if (ctx.state && typeof ctx.state.getState === 'function') return ctx.state.getState()
		return {
			channels: [],
			media: [],
			templates: [],
			serverInfo: {},
			variables: ctx.variables || {},
		}
	}

	/**
	 * @param {string} event
	 * @param {unknown} data
	 */
	function broadcast(event, data) {
		const msg = safeStringify({ type: event, data })
		for (const ws of clients) {
			if (ws.readyState === WebSocket.OPEN) ws.send(msg)
		}
	}

	ctx._wsBroadcast = broadcast
 
	// Hook into StateManager variables for real-time push
	if (ctx.state && typeof ctx.state.on === 'function') {
		ctx.state.on('variables', (changed) => {
			broadcast('variable_update', changed)
		})
	}

	const onUpgrade = (req, socket, head) => {
		const p = (req.url || '').split('?')[0]
		const isWsPath =
			p === '/api/ws' ||
			p === '/ws' ||
			/^\/instance\/[^/]+\/api\/ws$/.test(p) ||
			/^\/instance\/[^/]+\/ws$/.test(p)
		if (isWsPath) {
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit('connection', ws, req)
			})
		} else {
			socket.destroy()
		}
	}
	httpServer.on('upgrade', onUpgrade)

	wss.on('connection', (ws) => {
		clients.add(ws)
		log('[WS] client connected')
		try {
			const snap = getSnapshot()
			ws.send(safeStringify({ type: 'state', data: snap }))
		} catch (e) {
			log('ws initial state: ' + (e?.message || e))
			try {
				ws.send(
					safeStringify({
						type: 'state',
						data: { error: 'initial_state_failed', message: String(e?.message || e) },
					}),
				)
			} catch (_) {}
		}

		ws.on('message', async (raw) => {
			try {
				const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
				const trimmed = text.trim()
				if (!trimmed) return
				if (trimmed[0] !== '{' && trimmed[0] !== '[') return
				const msg = JSON.parse(trimmed)
				if (msg.type === 'amcp' && msg.cmd) {
					if (!ctx.amcp) {
						ws.send(safeStringify({ type: 'error', data: 'AMCP not connected', id: msg.id }))
						return
					}
					const r = await ctx.amcp.raw(msg.cmd)
					ws.send(safeStringify({ type: 'amcp_result', data: r, id: msg.id }))
				} else if (msg.type === 'multiview_sync' && msg.data) {
					ctx._multiviewLayout = msg.data
					const persistence = ctx.persistence || require('../utils/persistence')
					persistence.set('multiviewLayout', msg.data)
					if (typeof ctx.log === 'function') ctx.log('debug', 'Multiview layout synced from web UI')
				} else if (msg.type === 'selection_sync' && msg.data) {
					if (typeof ctx.setUiSelection === 'function') ctx.setUiSelection(ctx, msg.data)
				} else if (msg.type === 'scene_deck_sync' && msg.data) {
					const raw = msg.data.looks
					const looks = Array.isArray(raw)
						? raw
								.map((x) => ({
									id: String(x?.id != null ? x.id : ''),
									name: String(x?.name != null ? x.name : ''),
								}))
								.filter((x) => x.id)
						: []
					const prvRaw = msg.data.previewSceneId
					const previewSceneId =
						prvRaw != null && String(prvRaw).trim() ? String(prvRaw).trim() : null
					/** Full scene JSON per look (browser-only until project Save) — for Companion take without disk project. */
					const snapRaw = msg.data.sceneSnapshots
					const sceneSnapshots = Array.isArray(snapRaw)
						? snapRaw.filter((s) => s && typeof s === 'object' && s.id != null && String(s.id).trim())
						: null
					ctx.sceneDeck = {
						looks,
						previewSceneId,
						...(sceneSnapshots && sceneSnapshots.length ? { sceneSnapshots } : {}),
					}
					const persistence = ctx.persistence || require('../utils/persistence')
					try {
						persistence.set('scene_deck', { looks, previewSceneId })
					} catch (e) {
						if (typeof ctx.log === 'function') ctx.log('warn', 'scene_deck persist: ' + (e?.message || e))
					}
					broadcast('change', { path: 'scene.deck', value: ctx.sceneDeck })
				}
			} catch (e) {
				const m = e instanceof Error ? e.message : String(e)
				ws.send(safeStringify({ type: 'error', data: m }))
			}
		})

		ws.on('close', () => clients.delete(ws))
	})

	/** @type {ReturnType<typeof setInterval> | null} */
	let timer = null
	if (intervalMs > 0) {
		timer = setInterval(() => {
			try {
				broadcast('state', getSnapshot())
			} catch (e) {
				log('ws periodic state: ' + (e?.message || e))
			}
		}, intervalMs)
		if (timer.unref) timer.unref()
	}

	log('[HighAsCG] WebSocket: /api/ws, /ws, and /instance/<id>/api/ws (same port as HTTP)')

	return {
		wss,
		clients,
		stop() {
			if (timer) {
				clearInterval(timer)
				timer = null
			}
			httpServer.removeListener('upgrade', onUpgrade)
			for (const ws of clients) {
				try {
					ws.close()
				} catch (_) {}
			}
			clients.clear()
			try {
				wss.close()
			} catch (_) {}
			if (ctx._wsBroadcast === broadcast) delete ctx._wsBroadcast
		},
	}
}

module.exports = { attachWebSocketServer }
