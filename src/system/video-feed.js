'use strict'

/**
 * WO-670 P1 — live pictures for clients that are not on the box. The Godot GUI reads Caspar channels from shared memory
 * (video-surfaces.js) when it runs next to the server; on another machine it opens this WebSocket instead:
 *
 *   ws://<box>:4200/api/video-feed?width=960&fps=15&quality=5
 *   client → server (text):   {"roles":["opgui","pgm1"], "width"?, "fps"?, "quality"?}   (the full set it draws now)
 *   server → client (binary): [u8 n][n bytes role, ASCII][JPEG]
 *
 * Same auth / origin rules as /api/ws. The client keeps leasing runtime roles (POST /api/video-surfaces/lease) exactly
 * as on the box — this feed only READS the segments. Encoding (shm read + ffmpeg MJPEG) runs in one worker thread that
 * exists only while some client wants a picture; a role several clients want is encoded once, at the largest width /
 * fps asked. A client that falls behind (≥ MAX_BUFFERED bytes unsent) skips frames instead of queueing.
 */

const path = require('path')
const { WebSocketServer } = require('ws')
const { feedParams } = require('./video-feed-encoder')

const FEED_PATH = '/api/video-feed'
const ROLE_RE = /^[A-Za-z0-9_-]{1,32}$/
const MAX_BUFFERED = 2 * 1024 * 1024

/** [u8 n][role][jpeg] */
function frameMessage(role, jpeg) {
	const r = Buffer.from(role, 'latin1')
	return Buffer.concat([Buffer.from([r.length]), r, Buffer.from(jpeg)])
}

/** The full wanted set: role → params (max width / fps, best quality = lowest q) across clients. */
function wantedSurfaces(clients) {
	const out = new Map()
	for (const c of clients) {
		for (const role of c.roles) {
			const p = out.get(role)
			out.set(
				role,
				p
					? {
							width: Math.max(p.width, c.params.width),
							fps: Math.max(p.fps, c.params.fps),
							quality: Math.min(p.quality, c.params.quality),
						}
					: { ...c.params }
			)
		}
	}
	return out
}

/**
 * @param {{ log?: Function, makeWorker?: () => any, pathFor?: (role: string) => string }} deps
 */
function createVideoFeed(deps = {}) {
	const log = deps.log || (() => {})
	const pathFor = deps.pathFor || ((role) => `/dev/shm/highascg-${role}`)
	const makeWorker =
		deps.makeWorker || (() => new (require('worker_threads').Worker)(path.join(__dirname, 'video-feed-worker.js')))
	/** @type {Map<any, { roles: Set<string>, params: object }>} ws → subscription */
	const clients = new Map()
	let worker = null

	function onWorkerMessage(m) {
		if (m && m.log) return log(m.log, m.msg)
		if (!m || !m.role || !m.jpeg) return
		let msg = null
		for (const [ws, c] of clients) {
			if (!c.roles.has(m.role) || ws.readyState !== 1 || ws.bufferedAmount >= MAX_BUFFERED) continue
			msg = msg || frameMessage(m.role, m.jpeg)
			ws.send(msg, { binary: true })
		}
	}

	function sync() {
		const wanted = wantedSurfaces(clients.values())
		if (wanted.size === 0) {
			if (worker) {
				// the worker closes its ffmpegs and exits by itself (terminate() would orphan them until stdin EOF)
				const w = worker
				worker = null
				w.postMessage({ type: 'stop' })
				setTimeout(() => void w.terminate(), 2000).unref?.()
			}
			return
		}
		if (!worker) {
			worker = makeWorker()
			worker.on('message', onWorkerMessage)
			worker.on('error', (e) => log('warn', `[video-feed] worker: ${e?.message || e}`))
		}
		worker.postMessage({
			type: 'set',
			surfaces: [...wanted].map(([role, params]) => ({ role, path: pathFor(role), params })),
		})
	}

	function addClient(ws, query = {}) {
		const c = { roles: new Set(), params: feedParams(query) }
		clients.set(ws, c)
		ws.on('message', (data, isBinary) => {
			if (isBinary) return
			let m
			try {
				m = JSON.parse(String(data))
			} catch {
				return
			}
			c.roles = new Set((Array.isArray(m.roles) ? m.roles : []).map(String).filter((r) => ROLE_RE.test(r)))
			if (m.width != null || m.fps != null || m.quality != null) c.params = feedParams({ ...c.params, ...m })
			sync()
		})
		ws.on('close', () => {
			clients.delete(ws)
			sync()
		})
	}

	return { addClient, clients, _sync: sync }
}

/**
 * Attach /api/video-feed to the HTTP server (its own 'upgrade' listener: ws-server.js leaves other paths alone).
 * @returns {{ feed, close(): void }}
 */
function attachVideoFeed(httpServer, ctx, { log } = {}) {
	const feed = createVideoFeed({ log: (lvl, msg) => (log ? log(msg) : undefined) })
	const wss = new WebSocketServer({ noServer: true })
	const onUpgrade = (req, socket, head) => {
		const url = new URL(req.url || '', 'http://127.0.0.1')
		if (url.pathname !== FEED_PATH) return
		const { checkWebSocketAuth, isOriginAllowed } = require('../server/auth')
		if (!isOriginAllowed(req, ctx?.config)) {
			socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
			return socket.destroy()
		}
		const auth = checkWebSocketAuth(req, ctx)
		if (!auth.ok) {
			socket.write(`HTTP/1.1 ${auth.status || 401} Unauthorized\r\n\r\n`)
			return socket.destroy()
		}
		wss.handleUpgrade(req, socket, head, (ws) => feed.addClient(ws, Object.fromEntries(url.searchParams)))
	}
	httpServer.on('upgrade', onUpgrade)
	return {
		feed,
		close() {
			httpServer.removeListener('upgrade', onUpgrade)
			for (const ws of feed.clients.keys()) ws.terminate()
		},
	}
}

module.exports = { attachVideoFeed, createVideoFeed, frameMessage, wantedSurfaces, FEED_PATH }
