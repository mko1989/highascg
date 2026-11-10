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
 *
 * WO-1029 plan 07 C9 — linked servers (src/cluster/feed-relay.js, feed-relay-auth.js):
 *   - a role this server has no channel for (`pgmN` / `prvN` of a screen output by another linked server) is RELAYED:
 *     deps.relay subscribes to the owner's feed and its frames go out here under the same role name;
 *   - an upgrade with `relay=<token>` is a linked server's relay: the signed token replaces the password, the client is
 *     in its own tier (encoded separately, at the size IT asked — never the full-size encode a laptop client asked for),
 *     may get only roles that are here (no relay chains), and its roles are leased here while it is connected.
 */

const path = require('path')
const { WebSocketServer } = require('ws')
const { feedParams } = require('./video-feed-encoder')

const FEED_PATH = '/api/video-feed'
const ROLE_RE = /^[A-Za-z0-9_-]{1,32}$/
const MAX_BUFFERED = 2 * 1024 * 1024
const RELAY_TIER = 'relay' // worker key suffix `<role>~relay`: the relay tier's own encoder
const RELAY_LEASE_EVERY_MS = 5000

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
 * @param {{ log?: Function, makeWorker?: () => any, pathFor?: (role: string) => string,
 *   isLocal?: (role: string) => boolean, relay?: { want: Function } | null,
 *   lease?: (clientId: string, roles: string[]) => any }} deps
 *   isLocal: this server has the role (default: every role); relay: feed-relay.js (roles that are not local);
 *   lease: video-surfaces lease for a linked server's relay client
 */
function createVideoFeed(deps = {}) {
	const log = deps.log || (() => {})
	const sandboxShm = require('../bootstrap/sandbox').isSandbox() ? path.join(process.cwd(), 'shm') : '/dev/shm' // WO-719: never the live segments
	const pathFor = deps.pathFor || ((role) => `${sandboxShm}/highascg-${role}`)
	const makeWorker =
		deps.makeWorker || (() => new (require('worker_threads').Worker)(path.join(__dirname, 'video-feed-worker.js')))
	/** @type {Map<any, { roles: Set<string>, params: object }>} ws → subscription */
	const clients = new Map()
	const isLocal = deps.isLocal || (() => true)
	let worker = null

	/** One frame to every client of `tier` that wants `role` (and is not behind). */
	function fanOut(role, tier, jpeg) {
		let msg = null
		for (const [ws, c] of clients) {
			if (c.tier !== tier || !c.roles.has(role) || ws.readyState !== 1 || ws.bufferedAmount >= MAX_BUFFERED) continue
			msg = msg || frameMessage(role, jpeg)
			ws.send(msg, { binary: true })
		}
	}

	function onWorkerMessage(m) {
		if (m && m.log) return log(m.log, m.msg)
		if (!m || !m.role || !m.jpeg) return
		const [role, tier = ''] = String(m.role).split('~')
		fanOut(role, tier, m.jpeg)
	}

	/** WO-1029 C9: a relayed frame (feed-relay.js) → the local clients that asked for that remote role. */
	const deliver = (role, jpeg) => fanOut(role, '', jpeg) // a relayed role is never also encoded here (sync splits them)

	function sync() {
		const local = []
		const remote = new Set()
		for (const c of clients.values()) {
			const mine = { params: c.params, roles: [] }
			for (const r of c.roles) {
				if (isLocal(r)) mine.roles.push(c.tier ? `${r}~${c.tier}` : r)
				else if (!c.tier) remote.add(r) // a relay client never gets a relayed role (no chains)
			}
			local.push(mine)
		}
		deps.relay?.want(remote)
		const wanted = wantedSurfaces(local)
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
			surfaces: [...wanted].map(([role, params]) => ({ role, path: pathFor(role.split('~')[0]), params })),
		})
	}

	/** `relayFrom`: a linked server's relay (feed-relay-auth.js verified it) — its own tier, its roles leased here. */
	function addClient(ws, query = {}, { relayFrom = null } = {}) {
		const c = { roles: new Set(), params: feedParams(query), tier: relayFrom ? RELAY_TIER : '' }
		clients.set(ws, c)
		let leaseTimer = null
		const leaseId = relayFrom ? `relay-${relayFrom.fp}-${Math.random().toString(36).slice(2, 8)}` : ''
		const lease = (roles) => {
			try {
				Promise.resolve(deps.lease?.(leaseId, roles)).catch(() => {})
			} catch {}
		}
		// WO-830a: an oversize / invalid-UTF-8 frame makes ws emit 'error'; with no listener node exits (process-guards)
		ws.on('error', (e) => log('warn', `[video-feed] client: ${e?.message || e}`))
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
			if (relayFrom) {
				c.roles = new Set([...c.roles].filter((r) => isLocal(r)))
				lease([...c.roles]) // the owner's Caspar consumer exists only while leased (video-surfaces.js)
				if (!leaseTimer) (leaseTimer = setInterval(() => lease([...c.roles]), RELAY_LEASE_EVERY_MS)), leaseTimer.unref?.()
			}
			sync()
		})
		ws.on('close', () => {
			clients.delete(ws)
			if (leaseTimer) clearInterval(leaseTimer)
			if (relayFrom) lease([])
			sync()
		})
	}

	return { addClient, deliver, clients, _sync: sync }
}

/**
 * Attach /api/video-feed to the HTTP server (its own 'upgrade' listener: ws-server.js leaves other paths alone).
 * @returns {{ feed, close(): void }}
 */
function attachVideoFeed(httpServer, ctx, { log } = {}) {
	const logTo = (lvl, msg) => (log ? log(msg) : undefined)
	const surfaces = () => require('./video-surfaces').getVideoSurfaceManager(ctx)
	const { roleIndex } = require('./video-surfaces')
	let relay = null
	const feed = createVideoFeed({
		log: logTo,
		...feedFrameHook(),
		// WO-1029 C9: a leasable role (pgmN, prvN, inN, chN) without a channel here is not local; opgui always is
		isLocal: (role) => roleIndex(role) == null || surfaces().has(role) || !relay?.canRelay(role),
		relay: { want: (roles) => relay?.want(roles) },
		lease: (id, roles) => surfaces().lease(id, roles),
	})
	relay = require('../cluster/feed-relay').relayForCtx(ctx, (role, jpeg) => feed.deliver(role, jpeg), logTo)
	let gate = null
	const gateOf = () => {
		if (gate) return gate
		const identity = require('./device-identity')
		const { createFeedGate } = require('../cluster/feed-relay-auth')
		const cluster = () => (ctx._cluster ? require('../api/routes-cluster').clusterOf(ctx) : null) // an unlinked box trusts no one
		gate = createFeedGate({ peers: () => cluster()?.list() || [], selfKey: identity.getDevicePublicKeyPem, verify: identity.verifyMessage })
		return gate
	}
	const wss = new WebSocketServer({ noServer: true })
	const onUpgrade = (req, socket, head) => {
		// WO-830a: `GET //` makes `new URL('//', base)` throw before auth — an uncaught throw here is a remote node restart
		let url
		try {
			url = new URL(req.url || '', 'http://127.0.0.1')
		} catch {
			socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
			return socket.destroy()
		}
		if (url.pathname !== FEED_PATH) return
		const { checkWebSocketAuth, isOriginAllowed } = require('../server/auth')
		const token = url.searchParams.get('relay')
		if (token != null) {
			// WO-1029 C9: a linked server's relay — the signed token is the auth (feed-relay-auth.js), never the password
			const g = gateOf().check(token)
			if (!g.ok) {
				const last = g.last != null ? `x-feed-last: ${g.last}\r\n` : ''
				socket.write(`HTTP/1.1 ${g.status} ${g.status === 409 ? 'Conflict' : g.status === 400 ? 'Bad Request' : 'Forbidden'}\r\n${last}\r\n`)
				return socket.destroy()
			}
			const q = Object.fromEntries(url.searchParams)
			delete q.relay
			return wss.handleUpgrade(req, socket, head, (ws) => feed.addClient(ws, q, { relayFrom: g }))
		}
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
		relay,
		close() {
			relay.close()
			httpServer.removeListener('upgrade', onUpgrade)
			for (const ws of feed.clients.keys()) ws.terminate()
		},
	}
}

/** WO-1029 C9 bed: a sandbox started with HIGHASCG_SANDBOX_FEED_FRAMES=<label> encodes nothing — a generated JPEG
 * per role (tools/e2e/feed-frame-provider.js) stands in for the fake Caspar's missing pictures. Never outside a sandbox. */
function feedFrameHook() {
	const label = String(process.env.HIGHASCG_SANDBOX_FEED_FRAMES || '')
	if (!label || !require('../bootstrap/sandbox').isSandbox()) return {}
	const { createFakeFeedWorker } = require(path.join(require('../repo-paths').REPO_ROOT, 'tools', 'e2e', 'feed-frame-provider.js'))
	return { makeWorker: () => createFakeFeedWorker({ label }) }
}

module.exports = { attachVideoFeed, createVideoFeed, frameMessage, wantedSurfaces, FEED_PATH }
