'use strict'

/**
 * WO-1106 C29 — the cluster routes that change membership, mastership, the shared show or push media / restart Caspar
 * answer only (a) API auth enforced and passed, (b) the box itself, or (c) a request signed by a linked server
 * (cluster-route-gate.js, cluster-signed-request.js). With auth off (the factory default) a phone on the venue LAN
 * could make itself master or link a rogue server. Reading stays open. The Devices "Edit peer B" relay keeps working for
 * an operator at the box: box-local → this node signs the relayed change → peer B takes it.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { RouteRegistry } = require('../../src/api/route-registry')
const { createClusterGate, REFUSAL } = require('../../src/cluster/cluster-route-gate')
const { signHeaders, sendSigned, H } = require('../../src/cluster/cluster-signed-request')
const { createFloorStore, createStamper } = require('../../src/cluster/call-replay-guard')
const { createRelay } = require('../../src/cluster/cluster-relay')
const { fingerprint } = require('../../src/cluster/cluster-media')

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-c29-')), 'cluster-call-floor.json')
process.env.HIGHASCG_API_TOKEN_FILE = path.join(path.dirname(tmpFile()), 'api-token') // never the box's real token file
const keyPair = () => {
	const k = crypto.generateKeyPairSync('ed25519')
	return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: k.privateKey }
}
const verify = (pem, msg, sig) => {
	try {
		return crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64'))
	} catch {
		return false
	}
}
const signer = (k) => (m) => crypto.sign(null, Buffer.from(m), k.priv).toString('base64')

const PW = 'wo1106-c29-password'
const OFF = { config: {}, log: () => {} }
const ON = { config: { security: { enforceAuth: true, apiToken: PW } }, log: () => {} }
const BOX = { socket: { remoteAddress: '127.0.0.1', localPort: 4200 }, headers: { host: '127.0.0.1:4200' } }
const REMOTE = { socket: { remoteAddress: '192.168.1.50', localPort: 4200 }, headers: { host: '192.168.1.17:4200' } }
const at = (r, method, url, headers = {}) => ({ ...r, method, url, headers: { ...r.headers, ...headers } })

const A = keyPair() // the box that relays / unlinks itself
const B = keyPair() // the box being changed
const C = keyPair() // another linked box
const X = keyPair() // not linked anywhere
const linked = [
	{ id: 'boxA', name: 'A', device_key: A.pub.trim() },
	{ id: 'boxC', name: 'C', device_key: C.pub.trim() },
]
const gateOfB = () => createClusterGate({ peers: () => linked, selfKey: () => B.pub, verify, floorStore: createFloorStore({ file: tmpFile() }) })
/** A request from `from` to B, signed; `over` changes what is sent after signing (tampering). */
function signedReq(from, method, url, body, over = {}) {
	const headers = signHeaders({ method, path: url, body, toKey: B.pub, selfKey: from.pub, sign: signer(from), stamper: over.stamper || createStamper() })
	return at(REMOTE, over.method || method, over.url || url, { ...headers, ...(over.headers || {}) })
}

describe('WO-1106 C29 gate', () => {
	it('auth off: a remote request is refused with one plain sentence; the box itself and API auth pass', () => {
		const g = gateOfB()
		const no = g.check(at(REMOTE, 'POST', '/api/cluster/master/set'), OFF, '{}')
		assert.deepEqual(no, { ok: false, status: 403, body: { ok: false, code: 'NOT_ALLOWED', error: REFUSAL } })
		assert.match(REFUSAL, /^Changing linked servers is only allowed with a password or on the box itself\. Turn on API auth in Settings ▸ System, or do this on the box itself\.$/)
		assert.equal(g.check(null, OFF, '{}').ok, false, 'no request at all: refused')
		assert.deepEqual(g.check(at(BOX, 'POST', '/x'), OFF, '{}'), { ok: true, via: 'box' })
		assert.deepEqual(g.check(at(REMOTE, 'POST', '/x', { authorization: `Bearer ${PW}` }), ON, '{}'), { ok: true, via: 'auth' })
		assert.equal(g.check(at(REMOTE, 'POST', '/x', { authorization: 'Bearer nope' }), ON, '{}').ok, false)
		assert.equal(g.check(at(BOX, 'POST', '/x', { origin: 'http://192.168.1.99' }), OFF, '{}').ok, false, 'a foreign page on the box is not the box')
		assert.equal(g.operator(at(BOX, 'POST', '/x'), OFF), true)
		assert.equal(g.operator(at(REMOTE, 'POST', '/x'), OFF), false)
	})

	it('a request signed by a linked server passes; unknown key, tampered body / path / method, and a replay do not', () => {
		const g = gateOfB()
		const url = '/api/cluster/master/set'
		const body = JSON.stringify({ master: 'self' })
		assert.deepEqual(g.check(signedReq(A, 'POST', url, body), OFF, body), { ok: true, via: 'peer', fp: fingerprint(A.pub) })
		assert.equal(g.check(signedReq(X, 'POST', url, body), OFF, body).status, 403, 'not linked here')
		assert.equal(g.check(signedReq(A, 'POST', url, body), OFF, JSON.stringify({ master: 'boxX' })).status, 403, 'body changed')
		assert.equal(g.check(signedReq(A, 'POST', url, body, { url: '/api/cluster/show' }), OFF, body).status, 403, 'path changed')
		assert.equal(g.check(signedReq(A, 'POST', url, body, { method: 'DELETE' }), OFF, body).status, 403, 'method changed')
		const forC = signHeaders({ method: 'POST', path: url, body, toKey: C.pub, selfKey: A.pub, sign: signer(A), stamper: createStamper() })
		assert.equal(g.check(at(REMOTE, 'POST', url, forC), OFF, body).status, 400, 'signed for another server')
		const once = signedReq(A, 'POST', url, body)
		const g2 = gateOfB()
		assert.equal(g2.check(once, OFF, body).ok, true)
		const again = g2.check(once, OFF, body)
		assert.equal(again.ok, false, 'a replayed request')
		assert.equal(again.status, 409)
	})

	it('a sender behind the floor (receiver restarted, clock went back) resends once above it', async () => {
		const file = tmpFile()
		const g = createClusterGate({ peers: () => linked, selfKey: () => B.pub, verify, floorStore: createFloorStore({ file }) })
		let t = 2_000_000_000_000
		const ahead = createStamper(() => t)
		const url = '/api/cluster/show'
		const body = '{"on":true}'
		const send = (stamper) => async (headers) => {
			const r = g.check(at(REMOTE, 'POST', url, headers), OFF, body)
			return r.ok ? { status: 200, json: { ok: true } } : { status: r.status, json: r.body }
		}
		assert.equal((await sendSigned(send(ahead), { method: 'POST', path: url, body, toKey: B.pub, selfKey: A.pub, sign: signer(A), stamper: ahead })).status, 200)
		t = 1_000_000_000_000 // A restarted with its clock far behind: a fresh stamper below B's floor
		const behind = createStamper(() => t)
		const r = await sendSigned(send(behind), { method: 'POST', path: url, body, toKey: B.pub, selfKey: A.pub, sign: signer(A), stamper: behind })
		assert.equal(r.status, 200, JSON.stringify(r.json))
	})

	it('onlyPeer: only that server\'s own signature unlinks it', () => {
		const g = gateOfB()
		const url = '/api/cluster/peers/boxA?link_back=0'
		assert.equal(g.check(signedReq(A, 'DELETE', url, ''), OFF, '', { onlyPeer: 'boxA' }).ok, true)
		assert.equal(g.check(signedReq(C, 'DELETE', url, ''), OFF, '', { onlyPeer: 'boxA' }).status, 403, 'C cannot unlink A here')
	})

	it('sandbox aliases (127.0.1.x, tools/e2e) count as the box only inside a sandbox', () => {
		const g = gateOfB()
		const alias = { socket: { remoteAddress: '127.0.0.1', localPort: 35000 }, headers: { host: '127.0.1.12:35000' } }
		const prev = process.env.HIGHASCG_SANDBOX
		try {
			delete process.env.HIGHASCG_SANDBOX
			assert.equal(g.check(alias, OFF, '').ok, false)
			process.env.HIGHASCG_SANDBOX = '1'
			assert.deepEqual(g.check(alias, OFF, ''), { ok: true, via: 'box' })
			assert.equal(g.check({ ...alias, headers: { ...alias.headers, 'x-forwarded-for': '1.2.3.4' } }, OFF, '').ok, false)
			assert.equal(g.check({ ...alias, headers: { host: 'evil.example:35000' } }, OFF, '').ok, false)
			assert.equal(g.check({ ...alias, socket: { remoteAddress: '192.168.1.50' } }, OFF, '').ok, false)
		} finally {
			if (prev === undefined) delete process.env.HIGHASCG_SANDBOX
			else process.env.HIGHASCG_SANDBOX = prev
		}
	})
})

describe('WO-1106 C29 routes', () => {
	function rig() {
		const routes = new RouteRegistry()
		require('../../src/api/routes-cluster').register(routes)
		const did = []
		const ctx = {
			...OFF,
			_clusterGate: gateOfB(),
			_cluster: {
				snapshot: () => ({ self: { id: 'boxB' }, peers: [] }),
				list: () => linked,
				saved: (id) => linked.find((p) => p.id === id) || null,
				add: async (b, o) => (did.push(['add', b, o || {}]), { status: 201, body: { ok: true } }),
				accept: async (id) => (did.push(['accept', id]), { status: 201, body: {} }),
				decline: async (id) => (did.push(['decline', id]), { status: 200, body: {} }),
				setAutoAccept: (on) => (did.push(['auto', on]), { auto_accept: on }),
				unlink: async (id, o) => (did.push(['unlink', id, o]), { ok: true }),
				size: () => linked.length,
				mediaSend: () => null,
				peerCaps: () => [],
			},
			_clusterMaster: { view: () => ({ epoch: 1, is_master: true }), claim: () => null, forget: () => {}, set: async (b) => (did.push(['master', b]), { status: 200, body: { ok: true } }) },
			_clusterShow: { setOn: (on) => (did.push(['show', on]), { on }), view: () => ({}) },
			_clusterApply: { apply: async (b) => (did.push(['apply', b]), { status: 202, body: {} }), status: () => ({}) },
		}
		const go = (method, url, body, req, query) => routes.dispatch(method, url.split('?')[0], body, ctx, req && at(req, method, url), query || {})
		return { routes, ctx, did, go }
	}

	const GATED = [
		['POST', '/api/cluster/peers', { address: '10.0.0.9' }],
		['POST', '/api/cluster/invites/boxZ/accept', {}],
		['POST', '/api/cluster/invites/boxZ/decline', {}],
		['POST', '/api/cluster/auto-accept', { on: true }],
		['DELETE', '/api/cluster/peers/boxC', ''],
		['POST', '/api/cluster/peers/boxC/send-media', {}],
		['POST', '/api/cluster/master/set', { master: 'self' }],
		['POST', '/api/cluster/show', { on: true }],
		['POST', '/api/cluster/apply', {}],
	]

	it('every route that changes the linked servers: 403 for a remote client with auth off, nothing done', async () => {
		const r = rig()
		for (const [m, url, b] of GATED) {
			const res = await r.go(m, url, b === '' ? '' : JSON.stringify(b), REMOTE)
			assert.equal(res.status, 403, `${m} ${url}`)
			assert.deepEqual(JSON.parse(res.body), { ok: false, code: 'NOT_ALLOWED', error: REFUSAL })
		}
		assert.deepEqual(r.did, [])
	})

	it('the same from the box itself, with the password, or signed by a linked server: done', async () => {
		for (const how of ['box', 'auth', 'signed']) {
			const r = rig()
			if (how === 'auth') r.ctx.config = ON.config
			for (const [m, url, b] of GATED) {
				const text = b === '' ? '' : JSON.stringify(b)
				const req = how === 'box' ? at(BOX, m, url) : how === 'auth' ? at(REMOTE, m, url, { authorization: `Bearer ${PW}` }) : signedReq(A, m, url, text)
				const res = await r.routes.dispatch(m, url, text, r.ctx, req, {})
				assert.notEqual(res.status, 403, `${how}: ${m} ${url} ${res.body}`)
			}
			assert.deepEqual(r.did.map((d) => d[0]), ['add', 'accept', 'decline', 'auto', 'unlink', 'master', 'show', 'apply'], how)
		}
	})

	it('reading stays open', async () => {
		const r = rig()
		for (const url of ['/api/cluster/apply/status', '/api/cluster/master']) {
			const res = await r.go('GET', url, '', REMOTE)
			assert.notEqual(res.status, 403, url)
		}
	})

	it('a server linking back (unsigned, auth off): only as `untrusted` — new → invite / auto-accept, known → unchanged', async () => {
		const r = rig()
		const res = await r.go('POST', '/api/cluster/peers', JSON.stringify({ address: '10.0.0.9:4200', link_back: false }), REMOTE)
		assert.equal(res.status, 201)
		assert.deepEqual(r.did, [['add', { address: '10.0.0.9:4200', link_back: false }, { untrusted: true }]])
		const own = rig()
		await own.go('POST', '/api/cluster/peers', JSON.stringify({ address: '10.0.0.9:4200' }), BOX)
		assert.deepEqual(own.did[0][2], { untrusted: false }, 'the operator on the box: a full add')
		const bad = rig()
		const forged = signedReq(X, 'POST', '/api/cluster/peers', JSON.stringify({ address: '10.0.0.9', link_back: false }))
		assert.equal((await bad.routes.dispatch('POST', '/api/cluster/peers', JSON.stringify({ address: '10.0.0.9', link_back: false }), bad.ctx, forged, {})).status, 403, 'a bad signature is not a link-back')
	})

	it('unlink there (`?link_back=0`): signed by that server only; an unsigned one from the LAN is refused', async () => {
		const r = rig()
		const url = '/api/cluster/peers/boxA?link_back=0'
		const q = { link_back: '0' }
		assert.equal((await r.routes.dispatch('DELETE', '/api/cluster/peers/boxA', '', r.ctx, at(REMOTE, 'DELETE', url), q)).status, 403)
		assert.equal((await r.routes.dispatch('DELETE', '/api/cluster/peers/boxA', '', r.ctx, signedReq(C, 'DELETE', url, ''), q)).status, 403, 'another linked server cannot')
		assert.equal((await r.routes.dispatch('DELETE', '/api/cluster/peers/boxA', '', r.ctx, signedReq(A, 'DELETE', url, ''), q)).status, 200)
		assert.deepEqual(r.did, [['unlink', 'boxA', { linkBack: false }]])
		assert.equal((await r.routes.dispatch('DELETE', '/api/cluster/peers/boxQ', '', r.ctx, at(REMOTE, 'DELETE', '/api/cluster/peers/boxQ?link_back=0'), q)).status, 404)
	})
})

describe('WO-1106 C29 Devices "Edit peer B" relay', () => {
	/** A's relay → B's gate over a fake wire (path, headers and body as sent). */
	function wire() {
		const g = gateOfB()
		const seen = []
		const request = async (method, host, port, p, body, timeout, headers) => {
			const req = at(REMOTE, method, p, headers || {})
			const v = method === 'GET' ? { ok: true } : g.check(req, OFF, body || '')
			seen.push({ method, p, signed: !!headers?.[H.sig], ok: v.ok })
			return v.ok ? { status: 200, contentType: 'application/json', body: Buffer.from('{"ok":true}') } : { status: v.status, contentType: 'application/json', body: Buffer.from(JSON.stringify(v.body)) }
		}
		const relay = createRelay({ cluster: { saved: (id) => (id === 'boxB' ? { host: '10.0.0.2', port: 4200, name: 'B', device_key: B.pub } : null) }, request, selfKey: () => A.pub, sign: signer(A) })
		return { relay, seen }
	}

	it('an operator at box A (box-local) makes B master through the relay: signed, B takes it', async () => {
		const w = wire()
		const r = await w.relay({ method: 'POST', id: 'boxB', tail: 'api/cluster/master/set', query: {}, body: '{"master":"self"}', signed: true })
		assert.equal(r.status, 200, String(r.body))
		assert.deepEqual(w.seen, [{ method: 'POST', p: '/api/cluster/master/set', signed: true, ok: true }])
		const del = await w.relay({ method: 'DELETE', id: 'boxB', tail: 'api/cluster/peers/boxC', query: { link_back: '1' }, signed: true })
		assert.equal(del.status, 200, 'path with its query is what is signed')
	})

	it('an operator not allowed at A: the relay does not sign, B refuses; reads and other paths are never signed', async () => {
		const w = wire()
		const r = await w.relay({ method: 'POST', id: 'boxB', tail: 'api/cluster/master/set', query: {}, body: '{"master":"self"}', signed: false })
		assert.equal(r.status, 403)
		assert.equal(JSON.parse(String(r.body)).error, REFUSAL)
		await w.relay({ method: 'GET', id: 'boxB', tail: 'api/cluster', query: {}, signed: true })
		await w.relay({ method: 'POST', id: 'boxB', tail: 'api/device-view', query: {}, body: '{}', signed: true })
		assert.deepEqual(w.seen.slice(1).map((s) => s.signed), [false, false])
	})

	it('wired: the relay route passes `signed` from this node\'s own gate; the relay gets the device key', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-cluster.js'), 'utf8')
		assert.match(src, /signed: gateOf\(ctx\)\.operator\(req, ctx\)/)
		assert.match(src, /createRelay\(\{ cluster: clusterOf\(ctx\), log: ctx\.log, selfKey: identity\.getDevicePublicKeyPem, sign: identity\.signMessage/)
	})
})

describe('WO-1106 C29 servers on the fake LAN (cluster-lan.js routes as routes-cluster.js does with auth off)', () => {
	const { lan } = require('./lib/cluster-lan')

	it('link, then unlink from either side: the unlink there is signed and taken; nothing unsigned was needed', async () => {
		for (const side of ['a', 'b']) {
			const net = lan()
			const a = net.server('boxA', '10.0.0.1')
			const b = net.server('boxB', '10.0.0.2')
			assert.equal((await a.c.add({ address: '10.0.0.2' })).status, 201)
			assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], ['boxA']], 'the link-back (unsigned) added a NEW server')
			const r = await (side === 'a' ? a.c.unlink('boxB') : b.c.unlink('boxA'))
			assert.deepEqual(r.link_back, { ok: true, error: '' }, side)
			assert.deepEqual([net.ids(a), net.ids(b)], [[], []])
			assert.equal(a.refusedUnsigned + b.refusedUnsigned, 0)
			net.stopAll()
		}
	})

	it('a link-back for a server already linked changes nothing there (a moved server is re-addressed by its signed hello)', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2' })
		const before = JSON.stringify(b.store.m.get('clusterPeers'))
		net.move('boxA', '10.0.0.9')
		await a.c.add({ address: '10.0.0.2' }) // A links B again from its new address → an unsigned link-back to B
		assert.equal(JSON.stringify(b.store.m.get('clusterPeers')), before, 'B kept its record of A')
		await a.c.poll() // A's signed hello tells B where it is now
		assert.equal(b.store.m.get('clusterPeers')[0].host, '10.0.0.9')
		net.stopAll()
	})
})
