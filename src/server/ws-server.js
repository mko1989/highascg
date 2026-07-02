/**
 * WebSocket server on the same HTTP port (upgrade `/api/ws`, `/ws`, and Companion-style `/instance/<id>/api/ws`).
 * @see companion-module-casparcg-server/src/web-server.js
 */

'use strict'

const WebSocket = require('ws')
const { dispatchStructuredAmcp, isStructuredAmcpMessage } = require('./ws-amcp-dispatch')
const { dispatchCatalogWsMessage } = require('./ws-catalog-handlers')
const { getCompanionBridgeRegistry } = require('../companion-bridge/registry')
const { WS: COMPANION_WS } = require('../companion-bridge/contract')

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
	const replWss = new WebSocket.Server({ noServer: true })

	function notifyOperatorClientCount() {
		try {
			const { notifyOperatorWsCount } = require('../replication/replication-service')
			notifyOperatorWsCount(ctx, clients.size)
		} catch {
			/* replication optional */
		}
	}

	const logLineMaxHzRaw = parseInt(process.env.HIGHASCG_WS_LOG_LINE_MAX_HZ || '50', 10)
	const logLineMaxHz = Number.isFinite(logLineMaxHzRaw) ? logLineMaxHzRaw : 50
	const LOG_LINE_WINDOW_MS = 1000
	/** @type {number[]} */
	const logLineTimestamps = []
	let logLineThrottleWarnAt = 0

	let logLineDropped = 0

	function logLineSendAllowed() {
		if (!Number.isFinite(logLineMaxHz) || logLineMaxHz <= 0) return true
		const now = Date.now()
		while (logLineTimestamps.length && now - logLineTimestamps[0] > LOG_LINE_WINDOW_MS) logLineTimestamps.shift()
		if (logLineTimestamps.length >= logLineMaxHz) {
			logLineDropped++
			if (now - logLineThrottleWarnAt >= 10_000) {
				logLineThrottleWarnAt = now
				log(`[WS] log_line traffic exceeded ${logLineMaxHz}/s (rolling ${LOG_LINE_WINDOW_MS}ms); dropping excess. Set HIGHASCG_WS_LOG_LINE_MAX_HZ=0 to disable.`)
			}
			return false
		}
		logLineTimestamps.push(now)
		return true
	}

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

	function getSnapshot(preferFullCatalog = false) {
		const slimWs =
			process.env.HIGHASCG_WS_SLIM_BOOTSTRAP === '1' ||
			String(process.env.HIGHASCG_WS_SLIM_BOOTSTRAP || '').toLowerCase() === 'true'
		if (slimWs && !preferFullCatalog && typeof ctx.getStateWsBootstrap === 'function') {
			try {
				return ctx.getStateWsBootstrap()
			} catch (e) {
				log('ws slim bootstrap: ' + (e?.message || e))
			}
		}
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
	const STATE_BYTES_WARN = parseInt(process.env.HIGHASCG_WS_FULL_STATE_BYTES || '0', 10) || 0
	let lastStatePayloadWarnAt = 0

	function broadcast(event, data) {
		if (event === 'log_line' && !logLineSendAllowed()) return
		const msg = safeStringify({ type: event, data })
		if (event === 'state' && STATE_BYTES_WARN > 0) {
			const len = Buffer.byteLength(msg, 'utf8')
			if (len >= STATE_BYTES_WARN) {
				const now = Date.now()
				if (now - lastStatePayloadWarnAt > 60_000) {
					lastStatePayloadWarnAt = now
					log(
						`[WS] state message ~${len} B (threshold ${STATE_BYTES_WARN} via HIGHASCG_WS_FULL_STATE_BYTES); large catalogs dominate CPU/bandwidth — see PF-01.`,
					)
				}
			}
		}
		for (const ws of clients) {
			if (ws.readyState === WebSocket.OPEN) ws.send(msg)
		}
	}

	const CHANGE_COALESCE_MS = Math.max(
		0,
		Math.min(500, parseInt(process.env.HIGHASCG_WS_CHANGE_COALESCE_MS || '75', 10) || 75),
	)
	/** @type {Map<string, unknown>} */
	const pendingStateChanges = new Map()
	/** @type {ReturnType<typeof setTimeout> | null} */
	let stateChangeTimer = null

	function flushPendingStateChanges() {
		if (stateChangeTimer) {
			clearTimeout(stateChangeTimer)
			stateChangeTimer = null
		}
		if (pendingStateChanges.size === 0) return
		for (const [path, value] of pendingStateChanges) {
			broadcast('change', { path, value })
		}
		pendingStateChanges.clear()
	}

	function queueStateChange(path, value) {
		pendingStateChanges.set(String(path), value)
		if (CHANGE_COALESCE_MS <= 0) {
			flushPendingStateChanges()
			return
		}
		if (stateChangeTimer) clearTimeout(stateChangeTimer)
		stateChangeTimer = setTimeout(flushPendingStateChanges, CHANGE_COALESCE_MS)
	}

	ctx._wsBroadcast = broadcast
	ctx.companionBridge = getCompanionBridgeRegistry()
 
	// Hook into StateManager for real-time push
	if (ctx.state && typeof ctx.state.on === 'function') {
		ctx.state.on('variables', (changed) => {
			broadcast('variable_update', changed)
		})
		ctx.state.on('change', (path, value) => {
			queueStateChange(path, value)
		})
	}

	function sendOscBootstrap(ws) {
		if (!ctx.oscState || typeof ctx.oscState.getSnapshot !== 'function') return
		try {
			const oscSnap = ctx.oscState.getSnapshot()
			ws.send(safeStringify({ type: 'osc', data: oscSnap }))
		} catch (e) {
			log('ws initial osc: ' + (e?.message || e))
		}
	}

	function refreshLiveInputMetersOnConnect() {
		try {
			const { repairLiveInputMetersIfStale, broadcastOscSnapshot } = require('../audio/meter-health')
			void repairLiveInputMetersIfStale(ctx, { broadcastOsc: true, staleMs: 3000 }).catch((e) => {
				if (typeof ctx.log === 'function') ctx.log('debug', '[meter] ws connect repair: ' + (e?.message || e))
			})
			// Push current OSC even when repair is a no-op (UI reload / navigation).
			setTimeout(() => broadcastOscSnapshot(ctx), 250)
		} catch (e) {
			log('[meter] ws connect refresh: ' + (e?.message || e))
		}
	}

	const onUpgrade = (req, socket, head) => {
		const urlRaw = req.url || ''
		const p = urlRaw.split('?')[0]
		const isReplPath = p === '/api/replication/ws'
		const isWsPath =
			p === '/api/ws' ||
			p === '/ws' ||
			/^\/instance\/[^/]+\/api\/ws$/.test(p) ||
			/^\/instance\/[^/]+\/ws$/.test(p)
		if (isReplPath || isWsPath) {
			log(`[WS Upgrade] Attempt for path: ${p}`)
		}
		if (isReplPath) {
			try {
				const qs = new URL(urlRaw, 'http://127.0.0.1')
				const token = qs.searchParams.get('token') || ''
				const replToken = ctx.config?.replication?.peer?.token || ''
				const replEnabled = !!ctx.config?.replication?.enabled
				if (!replEnabled || !replToken || token !== replToken) {
					socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
					socket.destroy()
					return
				}
				replWss.handleUpgrade(req, socket, head, (ws) => {
					replWss.emit('connection', ws, req)
				})
			} catch (e) {
				log(`[WS Upgrade] replication error: ${e?.message || e}`)
			}
			return
		}
		if (isWsPath) {
			try {
				const { checkWebSocketAuth, isOriginAllowed } = require('../server/auth')
				if (!isOriginAllowed(req, ctx?.config)) {
					socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
					socket.destroy()
					return
				}
				const auth = checkWebSocketAuth(req, ctx)
				if (!auth.ok) {
					socket.write(`HTTP/1.1 ${auth.status || 401} Unauthorized\r\n\r\n`)
					socket.destroy()
					return
				}
				wss.handleUpgrade(req, socket, head, (ws) => {
					wss.emit('connection', ws, req)
				})
			} catch (e) {
				log(`[WS Upgrade] Error: ${e?.message || e}`)
			}
		} else {
			// Not our WS endpoint; leave the socket for other upgrade handlers.
			return
		}
	}
	httpServer.on('upgrade', onUpgrade)

	wss.on('connection', (ws) => {
		const firstClient = clients.size === 0
		clients.add(ws)
		notifyOperatorClientCount()
		log('[WS] client connected')
		if (firstClient && typeof ctx.onFirstWebSocketClient === 'function') {
			try {
				Promise.resolve(ctx.onFirstWebSocketClient(ctx)).catch((e) => log('onFirstWebSocketClient: ' + (e?.message || e)))
			} catch (e) {
				log('onFirstWebSocketClient: ' + (e?.message || e))
			}
		}
		try {
			const snap = getSnapshot()
			ws.send(safeStringify({ type: 'state', data: snap }))
			sendOscBootstrap(ws)
			refreshLiveInputMetersOnConnect()
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
				
				if (typeof ctx.log === 'function') {
					ctx.log('info', `[WS] Incoming: ${trimmed.length > 300 ? trimmed.slice(0, 300) + '...' : trimmed}`)
				}

				if (msg.type === 'amcp' && msg.cmd) {
					if (!ctx.amcp) {
						ws.send(safeStringify({ type: 'error', data: 'AMCP not connected', id: msg.id }))
						return
					}
					const { normalizeDecklinkPlayAmcpLine } = require('../config/decklink-amcp')
					const cmd = normalizeDecklinkPlayAmcpLine(msg.cmd, ctx.config)
					const r = await ctx.amcp.raw(cmd)
					ws.send(safeStringify({ type: 'amcp_result', data: r, id: msg.id }))
				} else if (isStructuredAmcpMessage(msg)) {
					if (!ctx.amcp) {
						ws.send(safeStringify({ type: 'error', data: 'AMCP not connected', id: msg.id }))
						return
					}
					const data = await dispatchStructuredAmcp(ctx, msg)
					ws.send(safeStringify({ type: 'amcp_result', data, id: msg.id }))
				} else if (await dispatchCatalogWsMessage(ws, ctx, msg, safeStringify)) {
					return
				} else if (msg.type === 'osc_resync') {
					sendOscBootstrap(ws)
					refreshLiveInputMetersOnConnect()
					ws.send(safeStringify({ type: 'osc_resync_ok', id: msg.id }))
				} else if (msg.type === 'multiview_sync' && msg.data) {
					ctx._multiviewLayout = msg.data
					const persistence = ctx.persistence || require('../utils/persistence')
					persistence.set('multiviewLayout', msg.data)
					if (typeof ctx.log === 'function') ctx.log('debug', 'Multiview layout synced from web UI')
				} else if (msg.type === 'selection_sync' && msg.data) {
					if (typeof ctx.setUiSelection === 'function') ctx.setUiSelection(ctx, msg.data)
				} else if (msg.type === COMPANION_WS.COMPANION_HELLO && msg.data) {
					if (getCompanionBridgeRegistry().register(ws, msg.data)) {
						ws.send(safeStringify({ type: 'companion.hello_ack', data: { ok: true } }))
						if (typeof ctx.log === 'function') {
							ctx.log(
								'debug',
								`[companion] hello instance=${String(msg.data.instanceId || '').slice(0, 32) || 'unknown'}`,
							)
						}
					}
				} else if (msg.type === 'scene_deck_sync' && msg.data) {
					const { mergeDeckSyncIntoProject, buildSceneDeckForApi } = require('../engine/project-scenes')
					const merged = mergeDeckSyncIntoProject(ctx, msg.data)
					if (merged) {
						try {
							const deck = buildSceneDeckForApi(ctx)
							broadcast('change', { path: 'scene.deck', value: deck })
						} catch (e) {
							if (typeof ctx.log === 'function') {
								ctx.log('warn', '[WS] scene.deck broadcast: ' + (e?.message || e))
							}
						}
					}
				}
			} catch (e) {
				const m = e instanceof Error ? e.message : String(e)
				ws.send(safeStringify({ type: 'error', data: m }))
			}
		})

		ws.on('close', () => {
			clients.delete(ws)
			getCompanionBridgeRegistry().unregister(ws)
			notifyOperatorClientCount()
		})
	})

	replWss.on('connection', (ws) => {
		log('[WS] replication peer connected')
		try {
			const { registerPeerWsClient, getReplicationRuntime } = require('../replication/replication-service')
			const { snapshotLiveState, broadcastLiveState } = require('../replication/live-state-feed')
			registerPeerWsClient(ws)
			const rt = getReplicationRuntime(ctx)
			if (rt) {
				const snap = snapshotLiveState(rt, ctx)
				ws.send(safeStringify({ type: 'live_state', data: snap }))
			}
		} catch (e) {
			log('ws replication connect: ' + (e?.message || e))
		}
		ws.on('message', async (raw) => {
			try {
				const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
				const msg = JSON.parse(text.trim())
				const { handlePeerWsMessage } = require('../replication/replication-service')
				await handlePeerWsMessage(ctx, msg)
			} catch {
				/* ignore malformed peer frames */
			}
		})
	})

	/** @type {ReturnType<typeof setInterval> | null} */
	let timer = null
	if (intervalMs > 0) {
		timer = setInterval(() => {
			try {
				broadcast('state', getSnapshot(true))
			} catch (e) {
				log('ws periodic state: ' + (e?.message || e))
			}
		}, intervalMs)
		if (timer.unref) timer.unref()
	}

	log('[HighAsCG] WebSocket: /api/ws, /ws, /api/replication/ws, and /instance/<id>/api/ws (same port as HTTP)')

	return {
		wss,
		clients,
		getLogLineStats: () => ({
			dropped: logLineDropped,
			maxHz: logLineMaxHz,
		}),
		stop() {
			flushPendingStateChanges()
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
				replWss.close()
			} catch (_) {}
			if (ctx._wsBroadcast === broadcast) delete ctx._wsBroadcast
		},
	}
}

module.exports = { attachWebSocketServer }
