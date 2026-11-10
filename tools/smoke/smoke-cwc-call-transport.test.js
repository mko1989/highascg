'use strict'

/**
 * WO-1029 plan 07 C4 — the signed call transport without wall clocks (src/cluster/cluster-call.js v2,
 * src/cluster/call-replay-guard.js) and the same for the ssh-key exchange (src/cluster/cluster-media.js).
 * In-process servers with test ed25519 keys and their OWN clocks; the floor store lives in a temp dir.
 * An "old" server is the previous build's rules (2026-11-10T113912Z): |now − ts| ≤ 60 s, nonce window, v1 text.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createClusterCall, callText, callText2, CAP, OPS_PER_SENDER, OP_TTL_MS } = require('../../src/cluster/cluster-call')
const { createFloorStore, defaultFloorFile, createReplayGuard, createStamper, WINDOW_MS } = require('../../src/cluster/call-replay-guard')
const { acceptSshKey, sendMedia, fingerprint, canonical, canonical2 } = require('../../src/cluster/cluster-media')

const MIN = 60000
const YEAR = 365 * 24 * 3600 * 1000
const verify = (pem, msg, sig) => {
	try {
		return crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64'))
	} catch {
		return false
	}
}
const keyPair = () => {
	const k = crypto.generateKeyPairSync('ed25519')
	return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: k.privateKey }
}
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cwc-c4-')), 'cluster-call-floor.json')

/** The previous build's receiver (v1 only), verbatim rules. */
function oldHandle(me, peers, now) {
	const seen = new Map()
	return async (b) => {
		const peer = peers.find((p) => fingerprint(p.device_key) === b.from)
		if (!peer) return { status: 403, body: { error: 'not linked here' } }
		if (b.to !== me) return { status: 400, body: { error: 'call is for another server' } }
		if (!(Math.abs(now() - Number(b.ts)) <= 60000)) return { status: 400, body: { error: 'stale call (check both clocks)' } }
		if (seen.has(b.nonce)) return { status: 409, body: { error: 'replayed call' } }
		if (!verify(peer.device_key, callText(b), b.sig)) return { status: 403, body: { error: 'bad signature' } }
		seen.set(b.nonce, now())
		return { status: 200, body: { ok: true, old: true } }
	}
}

/**
 * names → servers with own clocks (`skew[n]` ms added to the shared base), `caps[n]` = what n advertises,
 * `old[n]` = n runs the previous build's receiver, `store[n]` = its floor file. Each node: { call, ran, posts, drop }.
 */
function servers(names, o = {}) {
	const base = { t: 1_800_000_000_000, mono: 1000 }
	const keys = Object.fromEntries(names.map((n) => [n, keyPair()]))
	const nodes = {}
	const peersOf = (n) => names.filter((x) => x !== n).map((x) => ({ id: x, host: x, port: 4200, name: `srv-${x}`, device_key: keys[x].pub.trim() }))
	function make(n) {
		const peers = peersOf(n)
		const node = nodes[n] || { ran: [], posts: [], drop: 0, store: o.store?.[n] || tmpFile() }
		const now = () => base.t + (o.skew?.[n] || 0)
		node.now = now
		node.call = createClusterCall({
			cluster: { saved: (id) => peers.find((p) => p.id === id) || null, list: () => peers },
			selfKey: keys[n].pub,
			sign: (msg) => crypto.sign(null, Buffer.from(msg), keys[n].priv).toString('base64'),
			verify,
			now,
			mono: () => base.mono,
			floorStore: createFloorStore({ file: node.store }),
			peerCaps: (id) => (o.caps?.[id] ? [CAP] : []),
			post: async (host, port, p, body) => {
				const wire = JSON.parse(JSON.stringify(body))
				node.posts.push(wire)
				const r = await nodes[host].handle(wire)
				if (node.drop > 0) return (node.drop--, { ok: false, status: 0, json: null, error: 'timeout' }) // ran there, answer lost
				return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body }
			},
			acceptsRemote: () => true,
			masterId: () => '',
			actions: {
				ping: async (args, from, meta) => (node.ran.push({ args, from: from.id, meta }), { status: 200, body: { ok: true, on: n, n: node.ran.length } }),
			},
		})
		node.handle = o.old?.[n] ? oldHandle(fingerprint(keys[n].pub), peers, now) : (b) => node.call.handle(b)
		nodes[n] = node
		return node
	}
	for (const n of names) make(n)
	return { nodes, keys, base, restart: make, fp: (n) => fingerprint(keys[n].pub) }
}

/** A hand-signed v2 body from n to `to`. */
function v2(s, n, to, over = {}) {
	const b = { action: 'ping', args: { x: 1 }, from: s.fp(n), to: s.fp(to), ts: s.nodes[n].now(), nonce: crypto.randomBytes(16).toString('hex'), v: 2, opId: crypto.randomBytes(8).toString('hex'), ...over }
	return { ...b, sig: crypto.sign(null, Buffer.from(callText2(b)), s.keys[n].priv).toString('base64') }
}

describe('WO-1029 C4 call v2: clocks never compared', () => {
	for (const [label, skew] of [['10 min', 10 * MIN], ['2 years', 2 * YEAR]])
		for (const dir of [1, -1])
			it(`clocks ${label} apart (${dir > 0 ? 'sender ahead' : 'sender behind'}) → accepted, both ways`, async () => {
				const s = servers(['A', 'B'], { skew: { A: dir * skew }, caps: { A: true, B: true } })
				assert.equal((await s.nodes.A.call.call('B', 'ping')).status, 200)
				assert.equal((await s.nodes.B.call.call('A', 'ping')).status, 200)
				assert.equal(s.nodes.A.posts.length, 1, 'no retry needed')
				assert.equal(s.nodes.A.posts[0].v, 2)
			})

	it('caps not wired yet: the v1 "stale" answer carries the cap → the sender resends once as v2 and remembers it', async () => {
		const s = servers(['A', 'B'], { skew: { A: 2 * YEAR } })
		const r = await s.nodes.A.call.call('B', 'ping')
		assert.equal(r.status, 200)
		assert.deepEqual(s.nodes.A.posts.map((p) => p.v || 1), [1, 2])
		await s.nodes.A.call.call('B', 'ping')
		assert.deepEqual(s.nodes.A.posts.map((p) => p.v || 1), [1, 2, 2], 'learned: straight to v2')
		assert.equal(s.nodes.B.ran.length, 2)
	})

	it('replay → 409 CALL_REPLAY; a replay older than the window → 409 CALL_STALE with last; never runs twice', async () => {
		const s = servers(['A', 'B'], { skew: { A: -3 * YEAR } })
		const body = v2(s, 'A', 'B')
		assert.equal((await s.nodes.B.handle(body)).status, 200)
		const again = await s.nodes.B.handle(body)
		assert.deepEqual([again.status, again.body.code], [409, 'CALL_REPLAY'])
		s.base.t += 30000
		assert.equal((await s.nodes.B.handle(v2(s, 'A', 'B'))).status, 200)
		const late = await s.nodes.B.handle(body)
		assert.deepEqual([late.status, late.body.code, late.body.last], [409, 'CALL_STALE', s.nodes.A.now()])
		assert.equal(s.nodes.B.ran.length, 2)
	})

	it('out of order inside the window: both accepted once; beyond the window refused', async () => {
		const s = servers(['A', 'B'], { skew: { A: 10 * MIN } })
		const early = v2(s, 'A', 'B')
		const late = v2(s, 'A', 'B', { ts: s.nodes.A.now() + WINDOW_MS - 1 })
		assert.equal((await s.nodes.B.handle(late)).status, 200)
		assert.equal((await s.nodes.B.handle(early)).status, 200, 'arrived after a newer one')
		assert.equal((await s.nodes.B.handle(early)).status, 409)
		assert.equal((await s.nodes.B.handle(late)).status, 409)
		const tooOld = v2(s, 'A', 'B', { ts: late.ts - WINDOW_MS })
		assert.equal((await s.nodes.B.handle(tooOld)).body.code, 'CALL_STALE')
		assert.equal(s.nodes.B.ran.length, 2)
	})

	it('concurrent calls from one sender (and calls from another sender) all land', async () => {
		const s = servers(['A', 'B', 'C'], { caps: { A: true, B: true, C: true }, skew: { C: -YEAR } })
		const rs = await Promise.all([...Array(8)].map(() => s.nodes.A.call.call('B', 'ping')).concat(s.nodes.C.call.call('B', 'ping')))
		assert.ok(rs.every((r) => r.status === 200))
		assert.equal(s.nodes.B.ran.length, 9)
	})

	it('receiver restart keeps the floor: a captured call stays refused; the sender recovers with one retry', async () => {
		const s = servers(['A', 'B'], { caps: { A: true, B: true }, skew: { A: 5 * YEAR } })
		const captured = v2(s, 'A', 'B')
		assert.equal((await s.nodes.B.handle(captured)).status, 200)
		s.restart('B') // same floor file, new process state
		const r = await s.nodes.B.handle(captured)
		assert.deepEqual([r.status, r.body.code], [409, 'CALL_STALE'])
		const n = s.nodes.A.posts.length
		assert.equal((await s.nodes.A.call.call('B', 'ping')).status, 200)
		assert.equal(s.nodes.A.posts.length - n, 2, 'one 409 with last, then accepted')
		assert.equal((await s.nodes.A.call.call('B', 'ping')).status, 200)
		assert.equal(s.nodes.A.posts.length - n, 3, 'no more retries')
		const saved = JSON.parse(fs.readFileSync(s.nodes.B.store, 'utf8'))
		assert.equal(Object.keys(saved.floors).length, 1)
	})

	it('sender restart with its clock 2 years back → one 409 with last, resent above it; the action ran once', async () => {
		const s = servers(['A', 'B'], { caps: { A: true, B: true } })
		assert.equal((await s.nodes.A.call.call('B', 'ping')).status, 200)
		s.base.t -= 2 * YEAR
		s.restart('A')
		const n = s.nodes.A.posts.length
		const r = await s.nodes.A.call.call('B', 'ping', { y: 1 })
		assert.equal(r.status, 200)
		assert.equal(s.nodes.A.posts.length - n, 2)
		assert.equal(s.nodes.A.posts.at(-1).opId, s.nodes.A.posts.at(-2).opId, 'the resend keeps the opId')
		assert.equal(s.nodes.B.ran.length, 2)
	})
})

describe('WO-1029 C4 opId: a resend returns the first answer', () => {
	it('answer lost (timeout) → resend with the same opId gets the cached answer; the action ran once', async () => {
		const s = servers(['A', 'B'], { caps: { A: true, B: true } })
		s.nodes.A.drop = 1
		const lost = await s.nodes.A.call.call('B', 'ping', { a: 1 }, { quiet: true })
		assert.equal(lost.status, 0)
		assert.match(lost.opId, /^[0-9a-f]{32}$/)
		const r = await s.nodes.A.call.call('B', 'ping', { a: 1 }, { opId: lost.opId })
		assert.deepEqual(r.json, { ok: true, on: 'B', n: 1 })
		assert.equal(s.nodes.B.ran.length, 1)
		assert.notEqual(s.nodes.A.posts[0].nonce, s.nodes.A.posts[1].nonce, 'fresh nonce')
		const other = await s.nodes.A.call.call('B', 'ping', { a: 2 }, { opId: lost.opId, quiet: true })
		assert.deepEqual([other.status, other.json.error], [409, 'opId already used for another call'])
	})

	it('a resend while the first still runs waits for the same answer', async () => {
		const s = servers(['A', 'B'])
		let release
		const gate = new Promise((r) => (release = r))
		let runs = 0
		const b = createClusterCall({
			cluster: { saved: () => null, list: () => [{ id: 'A', name: 'srv-A', device_key: s.keys.A.pub.trim() }] },
			selfKey: s.keys.B.pub, sign: () => '', verify, now: () => 0, mono: () => 0, floorStore: createFloorStore({ file: tmpFile() }),
			post: async () => ({}), acceptsRemote: () => true, masterId: () => '',
			actions: { ping: async () => (runs++, await gate, { status: 200, body: { runs } }) },
		})
		const first = v2(s, 'A', 'B')
		const p1 = b.handle(first)
		const p2 = b.handle(v2(s, 'A', 'B', { opId: first.opId, ts: first.ts + 1 }))
		release()
		assert.deepEqual((await p1).body, { runs: 1 })
		assert.deepEqual((await p2).body, { runs: 1 })
	})

	it(`cache bounded to ${OPS_PER_SENDER} per sender and ${OP_TTL_MS / 60000} min of the receiver's monotonic time`, async () => {
		const s = servers(['A', 'B'], { caps: { A: true, B: true } })
		const first = await s.nodes.A.call.call('B', 'ping')
		for (let i = 0; i < OPS_PER_SENDER; i++) await s.nodes.A.call.call('B', 'ping')
		await s.nodes.A.call.call('B', 'ping', {}, { opId: first.opId })
		assert.equal(s.nodes.B.ran.length, OPS_PER_SENDER + 2, 'evicted: ran again')
		const kept = await s.nodes.A.call.call('B', 'ping')
		await s.nodes.A.call.call('B', 'ping', {}, { opId: kept.opId })
		assert.equal(s.nodes.B.ran.length, OPS_PER_SENDER + 3, 'cached')
		s.base.mono += OP_TTL_MS + 1
		await s.nodes.A.call.call('B', 'ping', {}, { opId: kept.opId })
		assert.equal(s.nodes.B.ran.length, OPS_PER_SENDER + 4, 'expired: ran again')
	})
})

describe('WO-1029 C4 seq + refusals', () => {
	it('seq: validated, signed, handed to the action as meta; nextSeq rises per destination', async () => {
		const s = servers(['A', 'B'], { caps: { A: true, B: true } })
		const A = s.nodes.A.call
		const q1 = A.nextSeq('dest_1')
		assert.ok(A.nextSeq('dest_1') > q1)
		assert.equal((await A.call('B', 'ping', {}, { seq: q1 })).status, 200)
		assert.deepEqual(s.nodes.B.ran[0].meta, { v: 2, opId: s.nodes.A.posts[0].opId, seq: q1, ts: s.nodes.A.posts[0].ts })
		for (const seq of [-1, 1.5, '3']) assert.equal((await s.nodes.B.handle(v2(s, 'A', 'B', { seq }))).status, 400, String(seq))
		const signed = v2(s, 'A', 'B', { seq: 4 })
		assert.equal((await s.nodes.B.handle({ ...signed, seq: 5 })).body.error, 'bad signature')
	})

	it('forged signature / unknown sender / wrong receiver / malformed refused as before', async () => {
		const s = servers(['A', 'B', 'C'])
		const B = s.nodes.B
		const forged = v2(s, 'A', 'B')
		assert.equal((await B.handle({ ...forged, sig: v2(s, 'C', 'B').sig })).status, 403)
		assert.equal((await B.handle({ ...forged, args: { x: 2 } })).status, 403)
		assert.equal((await B.handle(forged)).status, 200, 'a refused forgery burns nothing')
		assert.equal((await B.handle(v2(s, 'A', 'B', { from: 'f'.repeat(16) }))).status, 403)
		assert.equal((await B.handle(v2(s, 'A', 'C'))).status, 400)
		assert.equal((await B.handle(v2(s, 'A', 'B', { opId: 'x' }))).status, 400)
		assert.equal((await B.handle(v2(s, 'A', 'B', { ts: 1.5 }))).status, 400)
		assert.equal(B.ran.length, 1)
	})
})

describe('WO-1029 C4 an older build on the other end', () => {
	it('new sender → old receiver: v1 as today (works with close clocks, refused 10 min apart as before)', async () => {
		const s = servers(['A', 'B'], { old: { B: true } })
		assert.equal((await s.nodes.A.call.call('B', 'ping')).json.old, true)
		const far = servers(['A', 'B'], { old: { B: true }, skew: { A: 10 * MIN } })
		const r = await far.nodes.A.call.call('B', 'ping', {}, { quiet: true })
		assert.equal(r.status, 400)
		assert.deepEqual(far.nodes.A.posts.map((p) => p.v || 1), [1], 'no v2 sent to an old build')
	})

	it('peer advertised the cap but runs the old build again (rollback) → one v1 resend', async () => {
		const s = servers(['A', 'B'], { old: { B: true }, caps: { B: true } })
		const r = await s.nodes.A.call.call('B', 'ping')
		assert.equal(r.json.old, true)
		assert.deepEqual(s.nodes.A.posts.map((p) => p.v || 1), [2, 1])
	})

	it('old sender → new receiver: v1 rules unchanged (60 s), the stale answer names the cap', async () => {
		const s = servers(['A', 'B'])
		const old = (ts) => {
			const b = { action: 'ping', args: {}, from: s.fp('A'), to: s.fp('B'), ts, nonce: crypto.randomBytes(16).toString('hex') }
			return { ...b, sig: crypto.sign(null, Buffer.from(callText(b)), s.keys.A.priv).toString('base64') }
		}
		const ok = old(s.base.t - 60000)
		assert.equal((await s.nodes.B.handle(ok)).status, 200)
		assert.equal((await s.nodes.B.handle(ok)).status, 409)
		const stale = await s.nodes.B.handle(old(s.base.t + 60001))
		assert.deepEqual(stale, { status: 400, body: { error: 'stale call (check both clocks)', caps: [CAP] } })
		assert.deepEqual(s.nodes.B.ran[0].meta, { v: 1 })
	})
})

describe('WO-1029 C4 ssh-key exchange', () => {
	function media(o = {}) {
		const A = keyPair()
		const B = keyPair()
		const clock = { A: 1_800_000_000_000 + (o.skewA || 0), B: 1_800_000_000_000 }
		const installed = []
		const guard = () => createReplayGuard({ store: createFloorStore({ file: o.file || tmpFile() }), ns: 'ssh' })
		const recv = { cluster: { byDeviceKey: (k) => (k.trim() === A.pub.trim() ? { id: 'boxA', device_key: A.pub } : null) }, selfKey: B.pub, verify,
			install: (key) => (installed.push(key), { ok: true }), now: () => clock.B, guard: guard() }
		const sent = []
		const send = {
			cluster: { saved: () => ({ id: 'boxB', name: 'B', host: 'h', port: 1, device_key: B.pub }), mediaSend: () => null, setMediaSend: () => {}, poll: async () => {} },
			selfKey: A.pub, sign: (m) => crypto.sign(null, Buffer.from(m), A.priv).toString('base64'), sshKey: () => `ssh-ed25519 ${'A'.repeat(68)} a@b`,
			now: () => clock.A, stamp: createStamper(() => clock.A), peerCaps: () => (o.caps ? [CAP] : []),
			post: async (h, p, url, body) => {
				const wire = JSON.parse(JSON.stringify(body))
				sent.push(wire)
				const r = o.oldB ? oldSsh(wire) : acceptSshKey(wire, '10.0.0.5', recv)
				return { ok: r.status === 200, status: r.status, json: r.body }
			},
			project: async () => ({}), plan: () => ({ relPaths: [] }), rsync: async () => ({ ok: true }),
		}
		const oldSsh = (b) => (Math.abs(clock.B - b.ts) > 60000 ? { status: 400, body: { error: 'stale request (check both clocks)' } }
			: verify(A.pub, canonical(b), b.sig) ? { status: 200, body: { ok: true } } : { status: 403, body: { error: 'bad signature' } })
		return { A, B, clock, recv, send, sent, installed, guard }
	}

	it('2 years apart: a v1 "stale" answer names the cap → resent as v2 and installed; with caps straight to v2', async () => {
		for (const caps of [false, true]) {
			const m = media({ skewA: -2 * YEAR, caps })
			const r = await sendMedia('boxB', m.send)
			assert.equal(r.status, 400, 'got past the key exchange (no media in this project)')
			assert.deepEqual(m.sent.map((b) => b.v || 1), caps ? [2] : [1, 2])
			assert.equal(m.installed.length, 1)
		}
	})

	it('v2 replay refused; receiver restart keeps the floor; sender recovers with one retry', async () => {
		const file = tmpFile()
		const m = media({ caps: true, file, skewA: YEAR })
		await sendMedia('boxB', m.send)
		const captured = m.sent[0]
		assert.equal(acceptSshKey(captured, '10.0.0.5', m.recv).body.code, 'CALL_REPLAY')
		m.recv.guard = m.guard() // restart
		assert.equal(acceptSshKey(captured, '10.0.0.5', m.recv).body.code, 'CALL_STALE')
		m.send.stamp = createStamper(() => m.clock.A) // the sender restarted too
		await sendMedia('boxB', m.send)
		assert.deepEqual(m.sent.slice(1).map((b) => b.v), [2, 2])
		assert.equal(m.installed.length, 2)
		assert.equal(acceptSshKey({ ...m.sent.at(-1), nonce: 'ab'.repeat(8) }, '10.0.0.5', m.recv).status, 403, 'nonce is signed')
	})

	it('older build either side: v1 exactly as before', async () => {
		const m = media({ oldB: true, caps: true })
		await sendMedia('boxB', m.send)
		assert.deepEqual(m.sent.map((b) => b.v || 1), [2, 1], 'rolled-back receiver: one v1 resend')
		const n = media()
		const b = { from_key: n.A.pub, to: fingerprint(n.B.pub), ssh_public_key: `ssh-ed25519 ${'A'.repeat(68)}`, ts: n.clock.B - 61000 }
		const r = acceptSshKey({ ...b, sig: n.send.sign(canonical(b)) }, '10.0.0.5', n.recv)
		assert.deepEqual(r.body, { error: 'stale request (check both clocks)', caps: [CAP] })
		assert.equal(typeof canonical2, 'function')
	})
})

describe('WO-1029 C4 floor store', () => {
	it('bounded to 64 senders, the oldest written dropped; corrupt file reads empty; test runs never use config/', () => {
		const file = tmpFile()
		fs.writeFileSync(file, '{not json')
		const st = createFloorStore({ file })
		assert.equal(st.get('call:x'), 0)
		for (let i = 0; i < 70; i++) st.set(`call:${i}`, i + 1)
		const saved = JSON.parse(fs.readFileSync(file, 'utf8')).floors
		assert.equal(Object.keys(saved).length, 64)
		assert.equal(saved['call:0'], undefined)
		assert.equal(createFloorStore({ file }).get('call:69'), 70)
		assert.ok(defaultFloorFile().startsWith(os.tmpdir()), defaultFloorFile())
	})
})
