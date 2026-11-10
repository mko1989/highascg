'use strict'

/**
 * WO-1029 plan 07 C9 — the picture relay (src/cluster/feed-relay.js, feed-relay-auth.js, src/system/video-feed.js):
 * one upstream per (owner, role) shared by every local client, lease lapse stops it, signed clock-free auth
 * (unlinked / unsigned / replayed refused), an older owner keeps the placeholder, stall handling, the reduced size asked
 * upstream and encoded at that size on the owner.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { createFeedRelay, relayParams, pickOwner, parseFrame, LINGER_MS } = require('../../src/cluster/feed-relay')
const { createFeedGate, makeFeedToken, parseFeedToken } = require('../../src/cluster/feed-relay-auth')
const { createVideoFeed, frameMessage } = require('../../src/system/video-feed')
const { fingerprint } = require('../../src/cluster/cluster-media')

const JPEG = (n) => Buffer.from([0xff, 0xd8, n, 0xff, 0xd9])

function keys() {
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
	const pem = publicKey.export({ type: 'spki', format: 'pem' })
	return {
		pem,
		fp: fingerprint(pem),
		sign: (text) => crypto.sign(null, Buffer.from(text), privateKey).toString('base64'),
	}
}
const verify = (pem, text, sig) => {
	try {
		return crypto.verify(null, Buffer.from(text), pem, Buffer.from(sig, 'base64'))
	} catch {
		return false
	}
}
const memStore = () => {
	const m = new Map()
	return { get: (k) => m.get(k) || 0, set: (k, v) => m.set(k, v) }
}

/** A relay with a fake clock, fake sockets and a manual tick. */
function harness({ resolve, leased = () => true, params } = {}) {
	let t = 1000
	const sockets = []
	const frames = []
	const owner = { id: 'vb-b', name: 'box B', host: '127.0.0.9', port: 4200, fp: 'ab'.repeat(8) }
	const relay = createFeedRelay({
		resolve: resolve || (() => owner),
		isLeased: (r) => leased(r),
		sign: () => 'sig',
		selfFp: () => 'cd'.repeat(8),
		onFrame: (role, jpeg) => frames.push([role, jpeg]),
		params,
		connect: (url) => {
			const ws = Object.assign(new EventEmitter(), { url, sent: [], closed: false })
			ws.send = (m) => ws.sent.push(m)
			ws.close = () => (ws.closed = true)
			ws.terminate = () => (ws.closed = true)
			sockets.push(ws)
			return ws
		},
		mono: () => t,
		setInterval: () => 0,
		clearInterval: () => {},
	})
	return { relay, sockets, frames, owner, advance: (ms) => ((t += ms), relay.tick()) }
}

describe('WO-1029 C9 relay lifecycle', () => {
	it('one upstream per (owner, role) for every local client; frames fan out under the plain role name', () => {
		const h = harness()
		h.relay.want(new Set(['pgm3']))
		h.relay.want(new Set(['pgm3'])) // a second client asking the same role
		assert.equal(h.sockets.length, 1, 'one upstream')
		h.sockets[0].emit('open')
		assert.deepEqual(JSON.parse(h.sockets[0].sent[0]).roles, ['pgm3'])
		h.sockets[0].emit('message', frameMessage('pgm3', JPEG(1)), true)
		h.sockets[0].emit('message', frameMessage('pgm4', JPEG(2)), true) // not what it asked: ignored
		assert.deepEqual(h.frames.map(([r, j]) => [r, j[2]]), [['pgm3', 1]])
		assert.equal(h.relay.status('pgm3').state, 'live')
		assert.deepEqual(h.relay.status('pgm3').server, { id: 'vb-b', name: 'box B' })
	})

	it('inN / chN / opgui are never relayed (channel numbers / local surface)', () => {
		const h = harness()
		h.relay.want(new Set(['in1', 'ch3', 'opgui', 'pgm5']))
		assert.equal(h.sockets.length, 0)
		assert.equal(h.relay.status('ch3'), null)
	})

	it('no lease → no upstream; a lapsed lease stops it after the linger, a crashed client does not keep the owner encoding', () => {
		let leased = false
		const h = harness({ leased: () => leased })
		h.relay.want(new Set(['prv3']))
		assert.equal(h.sockets.length, 0, 'subscribed but not leased: nothing opened')
		leased = true
		h.advance(500)
		assert.equal(h.sockets.length, 1)
		leased = false // the client stopped renewing (TTL passed)
		h.advance(500) // the first tick that sees no lease
		h.advance(LINGER_MS - 100)
		assert.equal(h.sockets[0].closed, false, 'lingers a moment (tab switch)')
		h.advance(200)
		assert.equal(h.sockets[0].closed, true, 'closed after the linger')
		assert.equal(h.relay._ups.size, 0)
	})

	it('nobody asks any more → stopped after the linger', () => {
		const h = harness()
		h.relay.want(new Set(['pgm3']))
		h.relay.want(new Set())
		h.advance(LINGER_MS + 10)
		assert.equal(h.sockets[0].closed, true)
	})

	it('stall: 2 s without a frame = stalled; 6 s = dropped and asked again with backoff', () => {
		const h = harness()
		h.relay.want(new Set(['pgm3']))
		h.sockets[0].emit('open')
		h.sockets[0].emit('message', frameMessage('pgm3', JPEG(1)), true)
		h.advance(2100)
		assert.equal(h.relay.status('pgm3').state, 'stalled')
		h.advance(4000)
		assert.equal(h.sockets[0].closed, true, 'silent owner dropped')
		h.advance(1100)
		assert.equal(h.sockets.length, 2, 'asked again')
	})

	it('the small size is asked upstream (default 480 px / 10 fps / q8; config clamps to a monitoring picture)', () => {
		const h = harness({ params: () => relayParams({}) })
		h.relay.want(new Set(['pgm3']))
		const u = new URL(h.sockets[0].url)
		assert.equal(u.pathname, '/api/video-feed')
		assert.deepEqual([u.searchParams.get('width'), u.searchParams.get('fps'), u.searchParams.get('quality')], ['480', '10', '8'])
		assert.ok(parseFeedToken(u.searchParams.get('relay')), 'a relay token rides the upgrade')
		assert.deepEqual(relayParams({ cluster: { feedRelay: { width: 3840, fps: 60, quality: 1 } } }), { width: 960, fps: 15, quality: 2 })
		assert.deepEqual(relayParams({ cluster: { feedRelay: { width: 320, fps: 5 } } }), { width: 320, fps: 5, quality: 8 })
	})

	it('a 409 with x-feed-last: the next token counts on above the owner floor (once)', () => {
		const h = harness()
		h.relay.want(new Set(['pgm3']))
		const last = Date.now() + 10 * 60000
		h.sockets[0].emit('unexpected-response', {}, { statusCode: 409, headers: { 'x-feed-last': String(last) } })
		h.advance(500)
		assert.equal(h.sockets.length, 2, 'retried at once')
		const tok = parseFeedToken(new URL(h.sockets[1].url).searchParams.get('relay'))
		assert.ok(tok.ts > last)
		h.sockets[1].emit('unexpected-response', {}, { statusCode: 403, headers: {} })
		assert.equal(h.relay.status('pgm3').state, 'refused')
	})
})

describe('WO-1029 C9 owner choice (older peer = placeholder)', () => {
	const peerA = keys()
	const cluster = (caps) => ({ saved: (id) => ({ id, host: '127.0.0.9', port: 4200, name: 'B', device_key: peerA.pem }), peerCaps: () => caps })
	it('an owner without feed-relay (older build / offline: no caps) is not relayed from', () => {
		assert.equal(pickOwner([{ id: 'b', name: 'B' }], cluster(['hello', 'call-signed'])), null)
		assert.equal(pickOwner([{ id: 'b', name: 'B' }], cluster([])), null)
		assert.equal(pickOwner([], cluster(['feed-relay'])), null)
		const o = pickOwner([{ id: 'b', name: 'B' }], cluster(['feed-relay']))
		assert.deepEqual([o.id, o.port, o.fp], ['b', 4200, peerA.fp])
	})
	it('a relay with nothing to resolve opens nothing', () => {
		const h = harness({ resolve: () => null })
		h.relay.want(new Set(['pgm3']))
		assert.equal(h.sockets.length, 0)
		assert.equal(h.relay.status('pgm3'), null)
	})
})

describe('WO-1029 C9 auth on the owner (signed, clock-free)', () => {
	const owner = keys()
	const relayK = keys()
	const stranger = keys()
	const gate = () => createFeedGate({ peers: () => [{ id: 'a', device_key: relayK.pem }], selfKey: () => owner.pem, verify, floorStore: memStore() })

	it('a linked server with a valid token is taken; the same token again is a replay', () => {
		const g = gate()
		const tok = makeFeedToken({ from: relayK.fp, to: owner.fp, ts: 5, sign: relayK.sign })
		const r = g.check(tok)
		assert.equal(r.ok, true)
		assert.equal(r.peer.id, 'a')
		const again = g.check(tok)
		assert.equal(again.status, 409)
		assert.ok(Number.isSafeInteger(again.last), 'the refusal tells the sender where to count on from')
	})

	it('ts years apart from this clock is fine (never compared with it); a ts far below the sender high is stale', () => {
		const g = gate()
		assert.equal(g.check(makeFeedToken({ from: relayK.fp, to: owner.fp, ts: 1, sign: relayK.sign })).ok, true)
		assert.equal(g.check(makeFeedToken({ from: relayK.fp, to: owner.fp, ts: 4e12, sign: relayK.sign })).ok, true)
		assert.equal(g.check(makeFeedToken({ from: relayK.fp, to: owner.fp, ts: 4e12 - 60000, sign: relayK.sign })).status, 409)
	})

	it('unlinked, unsigned, forged, for another server or malformed → refused', () => {
		const g = gate()
		assert.equal(g.check(makeFeedToken({ from: stranger.fp, to: owner.fp, ts: 9, sign: stranger.sign })).status, 403, 'unlinked')
		assert.equal(g.check(makeFeedToken({ from: relayK.fp, to: owner.fp, ts: 9, sign: () => '' })).status, 403, 'unsigned')
		assert.equal(g.check(makeFeedToken({ from: relayK.fp, to: owner.fp, ts: 9, sign: stranger.sign })).status, 403, 'signed by another key')
		assert.equal(g.check(makeFeedToken({ from: relayK.fp, to: stranger.fp, ts: 9, sign: relayK.sign })).status, 400, 'for another server')
		assert.equal(g.check('').status, 400)
		assert.equal(g.check('bm9wZQ').status, 400)
		const noPeers = createFeedGate({ peers: () => [], selfKey: () => owner.pem, verify, floorStore: memStore() })
		assert.equal(noPeers.check(makeFeedToken({ from: relayK.fp, to: owner.fp, ts: 9, sign: relayK.sign })).status, 403, 'an unlinked box trusts no one')
	})
})

describe('WO-1029 C9 video-feed: relayed roles here, relay clients on the owner', () => {
	const mkWs = () => {
		const ws = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, sent: [] })
		ws.send = (b) => ws.sent.push(b)
		return ws
	}
	const mkWorkers = () => {
		const workers = []
		const makeWorker = () => {
			const wk = Object.assign(new EventEmitter(), { posted: [], postMessage: (m) => wk.posted.push(m), terminate: () => {} })
			workers.push(wk)
			return wk
		}
		return { workers, makeWorker }
	}

	it('a remote role goes to the relay (not the encoder) and its frames reach every client that asked', () => {
		const wants = []
		const { workers, makeWorker } = mkWorkers()
		const feed = createVideoFeed({ makeWorker, isLocal: (r) => r !== 'pgm3', relay: { want: (s) => wants.push([...s]) } })
		const a = mkWs()
		const b = mkWs()
		feed.addClient(a)
		feed.addClient(b)
		a.emit('message', Buffer.from(JSON.stringify({ roles: ['opgui', 'pgm3'] })), false)
		b.emit('message', Buffer.from(JSON.stringify({ roles: ['pgm3'] })), false)
		assert.deepEqual(wants.at(-1), ['pgm3'])
		assert.deepEqual(workers[0].posted.at(-1).surfaces.map((s) => s.role), ['opgui'], 'the remote role is never encoded here')
		feed.deliver('pgm3', JPEG(7))
		assert.equal(a.sent.length, 1)
		assert.equal(b.sent.length, 1)
		assert.equal(parseFrame(a.sent[0]).role, 'pgm3')
		a.emit('close')
		b.emit('close')
		assert.deepEqual(wants.at(-1), [], 'last client gone: the relay is told')
	})

	it('owner: a relay client is encoded in its own tier at ITS size, leased while connected, never gets relayed roles', () => {
		const leases = []
		const { workers, makeWorker } = mkWorkers()
		const feed = createVideoFeed({ makeWorker, isLocal: (r) => r !== 'pgm1', lease: (id, roles) => leases.push([id, roles]) })
		const laptop = mkWs()
		const relay = mkWs()
		feed.addClient(laptop, { width: '1920' })
		feed.addClient(relay, { width: '480', fps: '10', quality: '8' }, { relayFrom: { fp: 'cd'.repeat(8) } })
		laptop.emit('message', Buffer.from(JSON.stringify({ roles: ['pgm3'] })), false)
		relay.emit('message', Buffer.from(JSON.stringify({ roles: ['pgm3', 'pgm1'], width: 480, fps: 10 })), false)
		const s = workers[0].posted.at(-1).surfaces.map((x) => [x.role, x.path, x.params.width, x.params.fps])
		assert.deepEqual(s, [
			['pgm3', '/dev/shm/highascg-pgm3', 1920, 15],
			['pgm3~relay', '/dev/shm/highascg-pgm3', 480, 10],
		])
		assert.match(leases.at(-1)[0], /^relay-cdcd/)
		assert.deepEqual(leases.at(-1)[1], ['pgm3'], 'only roles that are here (no chains), leased for the relay')
		const jp = JPEG(3)
		workers[0].emit('message', { role: 'pgm3~relay', seq: 1, jpeg: jp.buffer.slice(jp.byteOffset, jp.byteOffset + jp.length) })
		assert.equal(relay.sent.length, 1)
		assert.equal(parseFrame(relay.sent[0]).role, 'pgm3', 'the tier never shows on the wire')
		assert.equal(laptop.sent.length, 0, 'the small encode is the relay tier only')
		relay.bufferedAmount = 5 * 1024 * 1024
		workers[0].emit('message', { role: 'pgm3~relay', seq: 2, jpeg: jp.buffer.slice(jp.byteOffset, jp.byteOffset + jp.length) })
		assert.equal(relay.sent.length, 1, 'a slow relay skips frames, nothing queues')
		relay.emit('close')
		assert.deepEqual(leases.at(-1)[1], [], 'disconnect releases the lease')
	})
})
