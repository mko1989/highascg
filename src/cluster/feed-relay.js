'use strict'

/**
 * WO-1029 plan 07 C9 — the picture of a screen that is output by ANOTHER linked server.
 *
 * A client talks only to its own node (RULES.md "Linked servers"). It asks its node's /api/video-feed for the plain
 * role of the screen — `pgmN` / `prvN`, N = screen index + 1, the same name it uses for a screen that is here (the
 * screen index is the cluster-wide key; the client never needs a channel number or a server id). When this server has
 * no channel for that role and the screen's owner (screenHosts / dest owners) advertises the `feed-relay` capability,
 * the node subscribes to the OWNER's /api/video-feed for the same role (signed token, feed-relay-auth.js) and re-serves
 * the frames to its clients under that name. GET /api/video-surfaces marks such a role `transport: 'feed'`.
 *
 * Lifecycle, per role (one upstream WS per (owner, role), shared by every local client):
 *   wanted  = some local feed client asks for the role (want()) AND some client holds a live lease on it here
 *             (POST /api/video-surfaces/lease, TTL 15 s): a crashed or hung client stops the owner encoding as a local
 *             role stops its Caspar consumer.
 *   started on the first wanted tick; stopped LINGER_MS after it stops being wanted (a tab switch does not reconnect).
 *   no frame for STALL_MS → state 'stalled' (the client greys the last frame: "no picture from <box>"); for
 *   RECONNECT_MS → the upstream is dropped and opened again with backoff.
 * Small by default: the owner encodes at the relay's size (default 480 px, 10 fps, q8; config `cluster.feedRelay`
 * { width, fps, quality }), never full size scaled down here. Frames are never queued: the owner skips frames for a
 * slow relay, this node skips frames for a slow client (video-feed.js MAX_BUFFERED).
 */

const { makeFeedToken } = require('./feed-relay-auth')
const { createStamper } = require('./call-replay-guard')

const CAP = 'feed-relay'
const DEFAULTS = { width: 480, fps: 10, quality: 8 }
const LIMITS = { width: [160, 960], fps: [1, 15], quality: [2, 20] } // a monitoring picture, never a second program
const TICK_MS = 500
const LINGER_MS = 3000
const STALL_MS = 2000
const RECONNECT_MS = 6000
const RELAY_ROLE_RE = /^(pgm|prv)([1-4])$/

/** cluster.feedRelay → clamped { width, fps, quality }. */
function relayParams(config) {
	const c = config?.cluster?.feedRelay && typeof config.cluster.feedRelay === 'object' ? config.cluster.feedRelay : {}
	const out = {}
	for (const k of Object.keys(DEFAULTS)) {
		const v = Math.round(Number(c[k]))
		out[k] = Number.isFinite(v) ? Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v)) : DEFAULTS[k]
	}
	return out
}

/** `pgm3` → { bus: 'pgm', idx: 2 }; null for a role that is never relayed (inN / chN are channel numbers, opgui is local). */
function relayRole(role) {
	const m = RELAY_ROLE_RE.exec(String(role || ''))
	return m ? { bus: m[1], idx: Number(m[2]) - 1 } : null
}

/** [u8 n][role][jpeg] → { role, jpeg } | null */
function parseFrame(buf) {
	const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
	if (b.length < 4 || b[0] === 0 || b.length < 1 + b[0] + 2) return null
	return { role: b.subarray(1, 1 + b[0]).toString('latin1'), jpeg: b.subarray(1 + b[0]) }
}

/**
 * @param {{ resolve: (role: string) => ({ id: string, name: string, host: string, port: number, fp: string } | null),
 *   isLeased: (role: string) => boolean, sign: (text: string) => string, selfFp: () => string,
 *   onFrame: (role: string, jpeg: Buffer) => void, params?: () => object, connect?: (url: string) => any,
 *   mono?: () => number, setInterval?: Function, clearInterval?: Function, log?: Function }} deps
 */
function createFeedRelay(deps) {
	const mono = deps.mono || (() => performance.now())
	const log = (lvl, msg) => deps.log?.(lvl, `[feed-relay] ${msg}`)
	const params = deps.params || (() => DEFAULTS)
	const connect = deps.connect || ((url) => new (require('ws'))(url, { perMessageDeflate: false, handshakeTimeout: 4000 }))
	const stamp = createStamper()
	/** role → { role, owner, ws, state, lastFrame, idleSince, attempts, nextTry, adopted } */
	const ups = new Map()
	let subscribed = new Set()

	function urlFor(up) {
		const p = params()
		const relay = makeFeedToken({ from: deps.selfFp(), to: up.owner.fp, ts: stamp.next(up.owner.fp), sign: deps.sign })
		const host = String(up.owner.host).includes(':') ? `[${up.owner.host}]` : up.owner.host
		return `ws://${host}:${up.owner.port}/api/video-feed?width=${p.width}&fps=${p.fps}&quality=${p.quality}&relay=${relay}`
	}

	function open(up) {
		let ws
		try {
			ws = connect(urlFor(up))
		} catch (e) {
			return failed(up, e?.message || String(e))
		}
		up.ws = ws
		up.state = 'connecting'
		up.openedAt = mono()
		ws.on('open', () => {
			if (up.ws !== ws) return
			up.state = 'waiting'
			up.refused = 0
			up.adopted = false // a later restart of either end may need one more catch-up
			ws.send(JSON.stringify({ roles: [up.role], ...params() }))
		})
		ws.on('message', (data, isBinary) => {
			if (up.ws !== ws || isBinary === false) return
			const f = parseFrame(data)
			if (!f || f.role !== up.role) return
			up.lastFrame = mono()
			up.attempts = 0
			up.state = 'live'
			deps.onFrame(up.role, f.jpeg)
		})
		ws.on('unexpected-response', (_req, res) => {
			if (up.ws !== ws) return
			const last = Number(res?.headers?.['x-feed-last'])
			if (res?.statusCode === 409 && Number.isSafeInteger(last) && !up.adopted) {
				stamp.adopt(up.owner.fp, last) // its floor is above our clock (we or it restarted): count on above it, once
				up.adopted = true
				up.nextTry = 0
			} else log('warn', `${up.owner.name} refused ${up.role}: HTTP ${res?.statusCode}`)
			up.refused = res?.statusCode || 0
			drop(up, ws)
		})
		ws.on('error', () => {})
		ws.on('close', () => drop(up, ws))
	}

	function drop(up, ws) {
		if (up.ws !== ws) return
		up.ws = null
		try {
			ws.terminate?.()
		} catch {}
		failed(up)
	}

	function failed(up, why) {
		if (why) log('warn', `${up.owner.name} ${up.role}: ${why}`)
		up.state = up.refused && up.nextTry !== 0 ? 'refused' : up.state === 'live' ? 'stalled' : up.state === 'refused' ? 'refused' : 'connecting'
		up.attempts++
		if (up.nextTry !== 0) up.nextTry = mono() + Math.min(10000, 500 * 2 ** Math.min(up.attempts, 5))
	}

	function close(up) {
		ups.delete(up.role)
		const ws = up.ws
		up.ws = null
		if (ws) {
			try {
				ws.close()
			} catch {}
			setTimeout(() => ws.terminate?.(), 1000).unref?.()
		}
		log('info', `${up.owner.name} ${up.role}: upstream closed (no lease)`)
	}

	function tick() {
		const t = mono()
		for (const role of subscribed) {
			if (!deps.isLeased(role)) continue
			const owner = deps.resolve(role)
			if (!owner) continue
			let up = ups.get(role)
			if (up && up.owner.id !== owner.id) close(up), (up = null)
			if (!up) {
				up = { role, owner, ws: null, state: 'connecting', lastFrame: 0, idleSince: 0, attempts: 0, nextTry: 0, adopted: false, refused: 0 }
				ups.set(role, up)
				log('info', `${owner.name} ${role}: upstream opened`)
			}
			up.idleSince = 0
		}
		for (const up of [...ups.values()]) {
			const wanted = subscribed.has(up.role) && deps.isLeased(up.role)
			if (!wanted) {
				if (!up.idleSince) up.idleSince = t
				if (t - up.idleSince >= LINGER_MS) close(up)
				continue
			}
			if (up.ws) {
				const since = up.lastFrame || up.openedAt
				if (up.state === 'live' && t - up.lastFrame > STALL_MS) up.state = 'stalled'
				if (t - since > RECONNECT_MS) drop(up, up.ws) // a silent owner: ask again (it may have restarted)
			} else if (t >= up.nextTry) {
				if (up.nextTry === 0) up.refused = 0
				up.nextTry = -1
				open(up)
			}
		}
	}

	const timer = (deps.setInterval || setInterval)(tick, TICK_MS)
	timer?.unref?.()

	return {
		/** The roles local feed clients ask for that are not on this server (the full set). */
		want(roles) {
			subscribed = new Set([...roles].filter((r) => relayRole(r)))
			tick()
		},
		tick,
		/** For the descriptors: null when not relayable; else { server: { id, name }, state }. */
		status(role) {
			if (!relayRole(role)) return null
			const owner = deps.resolve(role)
			if (!owner) return null
			const up = ups.get(role)
			return { server: { id: owner.id, name: owner.name }, state: up ? up.state : 'idle' }
		},
		canRelay: (role) => !!(relayRole(role) && deps.resolve(role)),
		close() {
			;(deps.clearInterval || clearInterval)(timer)
			for (const up of [...ups.values()]) close(up)
		},
		_ups: ups,
	}
}

/** The first owner of a remote screen that can relay (linked with a recorded key, advertises CAP); null = none: an
 * older owner, an offline one (no caps) or an unknown one keeps the placeholder. */
function pickOwner(owners, cluster) {
	const { fingerprint } = require('./cluster-media')
	for (const o of owners || []) {
		const peer = cluster.saved(o.id)
		if (!peer?.device_key || !cluster.peerCaps(o.id).includes(CAP)) continue
		return { id: o.id, name: o.name || peer.name || o.id, host: peer.host, port: peer.port, fp: fingerprint(peer.device_key) }
	}
	return null
}

/** The server's relay, bound to ctx (lazy; video-feed.js attaches it). */
function relayForCtx(ctx, onFrame, log) {
	const identity = require('../system/device-identity')
	const { fingerprint } = require('./cluster-media')
	const rc = () => require('../api/routes-cluster')
	const resolve = (role) => {
		const r = relayRole(role)
		if (!r || !ctx._cluster) return null // never starts the cluster service: an unlinked box relays nothing
		const t = require('../api/screen-not-here').screenTarget(ctx, { screenIdx: r.idx })
		if (!t || t.here !== false) return null
		return pickOwner(t.owners, rc().clusterOf(ctx))
	}
	return createFeedRelay({
		resolve,
		isLeased: (role) => require('../system/video-surfaces').getVideoSurfaceManager(ctx).leased(role),
		sign: identity.signMessage,
		selfFp: () => fingerprint(identity.getDevicePublicKeyPem()),
		params: () => relayParams(ctx.config),
		onFrame,
		log,
	})
}

module.exports = { createFeedRelay, relayForCtx, pickOwner, relayParams, parseFrame, CAP, DEFAULTS, LINGER_MS }
