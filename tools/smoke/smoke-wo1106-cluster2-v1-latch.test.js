'use strict'

/**
 * WO-1106 C27 — the old signed call (v1: a ±60 s clock window, the receiver's clock compared) is refused from a linked
 * server once that server was seen on the clock-free one (v2: it advertised 'call-signed', or a v2 call / ssh-key
 * from it was taken). The latch is persisted with the peer record (`signed_v2`, cluster-peers.js) and cleared by
 * unlink + link. A server never seen on v2 (an older build) keeps v1, and every server still on v1 is logged once.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createClusterCall, callText } = require('../../src/cluster/cluster-call')
const { createFloorStore, createReplayGuard, createStamper } = require('../../src/cluster/call-replay-guard')
const { acceptSshKey, sendMedia, fingerprint, canonical } = require('../../src/cluster/cluster-media')
const { createCluster } = require('../../src/cluster/cluster-peers')

const CAP = 'call-signed'
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-c27-')), 'cluster-call-floor.json')
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

/** A → B. B's cluster keeps the latch in a Set (cluster-peers.js does it on the saved record: tested below). */
function pair({ capsOfB = false } = {}) {
	const keys = { A: keyPair(), B: keyPair() }
	const t = 1_800_000_000_000
	const latched = new Set()
	const nodes = {}
	for (const n of ['A', 'B']) {
		const other = n === 'A' ? 'B' : 'A'
		const peers = [{ id: other, host: other, port: 4200, name: `srv-${other}`, device_key: keys[other].pub.trim() }]
		const logs = []
		const ran = []
		const cluster = { saved: (id) => peers.find((p) => p.id === id) || null, list: () => peers }
		if (n === 'B') Object.assign(cluster, { spokeV2: (fp) => latched.has(fp), markV2: (fp) => latched.add(fp) })
		nodes[n] = {
			logs,
			ran,
			posts: [],
			call: createClusterCall({
				cluster,
				selfKey: keys[n].pub,
				sign: (m) => crypto.sign(null, Buffer.from(m), keys[n].priv).toString('base64'),
				verify,
				now: () => t,
				mono: () => 1000,
				floorStore: createFloorStore({ file: tmpFile() }),
				peerCaps: (id) => (id === 'B' && capsOfB ? [CAP] : []),
				post: async (host, port, p, body) => {
					const wire = JSON.parse(JSON.stringify(body))
					nodes[n].posts.push(wire)
					const r = await nodes[host].call.handle(wire)
					return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body }
				},
				log: (lvl, msg) => logs.push(`${lvl} ${msg}`),
				acceptsRemote: () => true,
				masterId: () => '',
				actions: { ping: async (args, from, meta) => (ran.push(meta.v), { status: 200, body: { ok: true } }) },
			}),
		}
	}
	const fp = (n) => fingerprint(keys[n].pub)
	/** A hand-signed v1 call A → B (what an older build sends). */
	const v1 = () => {
		const b = { action: 'ping', args: {}, from: fp('A'), to: fp('B'), ts: t, nonce: crypto.randomBytes(16).toString('hex') }
		return { ...b, sig: crypto.sign(null, Buffer.from(callText(b)), keys.A.priv).toString('base64') }
	}
	return { nodes, latched, fp, v1 }
}

describe('WO-1106 C27 call: v1 refused once the sender was seen on v2', () => {
	it('a server never seen on v2 (an older build) keeps v1; it is logged once as still on v1', async () => {
		const s = pair()
		assert.equal((await s.nodes.B.call.handle(s.v1())).status, 200)
		assert.equal((await s.nodes.B.call.handle(s.v1())).status, 200)
		assert.deepEqual(s.nodes.B.ran, [1, 1])
		const notes = s.nodes.B.logs.filter((l) => /still uses the old signed call \(v1, ±60 s clock window\)/.test(l))
		assert.equal(notes.length, 1, 'once per server and start')
		assert.match(notes[0], /srv-A still uses/)
	})

	it('after one v2 call from it, its v1 calls are refused "stale call …" CALL_V1_REFUSED (replayable v1 bodies included)', async () => {
		const s = pair({ capsOfB: true })
		const old = s.v1()
		assert.equal((await s.nodes.A.call.call('B', 'ping')).status, 200)
		assert.equal(s.nodes.A.posts[0].v, 2)
		assert.ok(s.latched.has(s.fp('A')), 'latched on the accepted v2 call')
		const r = await s.nodes.B.call.handle(old)
		assert.equal(r.status, 400)
		assert.equal(r.body.code, 'CALL_V1_REFUSED')
		assert.match(r.body.error, /^stale call/)
		assert.deepEqual(r.body.caps, [CAP])
		assert.deepEqual(s.nodes.B.ran, [2], 'the v1 call did not run')
		assert.ok(s.nodes.B.logs.some((l) => /^warn \[cluster\] srv-A: old signed call \(v1\) refused/.test(l)))
	})

	it('a current sender that still tries v1 first (caps not seen yet) learns from the refusal and resends as v2', async () => {
		const s = pair({ capsOfB: false })
		s.latched.add(s.fp('A'))
		const r = await s.nodes.A.call.call('B', 'ping')
		assert.equal(r.status, 200, JSON.stringify(r.json))
		assert.deepEqual(s.nodes.A.posts.map((b) => b.v || 1), [1, 2])
		assert.deepEqual(s.nodes.B.ran, [2])
	})
})

describe('WO-1106 C27 ssh-key', () => {
	function media({ latched }) {
		const A = keyPair()
		const B = keyPair()
		const marks = new Set(latched ? [fingerprint(A.pub)] : [])
		const installed = []
		const recv = {
			cluster: { byDeviceKey: (k) => (k.trim() === A.pub.trim() ? { id: 'boxA', name: 'A', device_key: A.pub } : null), spokeV2: (fp) => marks.has(fp), markV2: (fp) => marks.add(fp) },
			selfKey: B.pub,
			verify,
			install: (key) => (installed.push(key), { ok: true }),
			now: () => 1_800_000_000_000,
			guard: createReplayGuard({ store: createFloorStore({ file: tmpFile() }), ns: 'ssh' }),
		}
		const v1 = () => {
			const b = { from_key: A.pub, to: fingerprint(B.pub), ssh_public_key: `ssh-ed25519 ${'A'.repeat(68)} a@b`, ts: 1_800_000_000_000 }
			return { ...b, sig: crypto.sign(null, Buffer.from(canonical(b)), A.priv).toString('base64') }
		}
		const sent = []
		const send = {
			cluster: { saved: () => ({ id: 'boxB', name: 'B', host: 'h', port: 1, device_key: B.pub }), mediaSend: () => null, setMediaSend: () => {}, poll: async () => {} },
			selfKey: A.pub,
			sign: (m) => crypto.sign(null, Buffer.from(m), A.priv).toString('base64'),
			sshKey: () => `ssh-ed25519 ${'A'.repeat(68)} a@b`,
			now: () => 1_800_000_000_000,
			stamp: createStamper(() => 1_800_000_000_000),
			peerCaps: () => [],
			post: async (h, p, url, body) => {
				const wire = JSON.parse(JSON.stringify(body))
				sent.push(wire)
				const r = acceptSshKey(wire, '10.0.0.5', recv)
				return { ok: r.status === 200, status: r.status, json: r.body }
			},
			project: async () => ({}),
			plan: () => ({ relPaths: [] }),
			rsync: async () => ({ ok: true }),
		}
		return { A, marks, recv, v1, send, sent, installed }
	}

	it('v1 from a latched server refused; a current sender resends as v2 and that latches', async () => {
		const m = media({ latched: true })
		const r = acceptSshKey(m.v1(), '10.0.0.5', m.recv)
		assert.equal(r.status, 400)
		assert.equal(r.body.code, 'CALL_V1_REFUSED')
		assert.deepEqual(m.installed, [])
		await sendMedia('boxB', m.send)
		assert.deepEqual(m.sent.map((b) => b.v || 1), [1, 2])
		assert.equal(m.installed.length, 1)
		const fresh = media({ latched: false })
		assert.equal(acceptSshKey(fresh.v1(), '10.0.0.5', fresh.recv).status, 200, 'never seen on v2: v1 kept')
		await sendMedia('boxB', { ...fresh.send, peerCaps: () => [CAP] })
		assert.ok(fresh.marks.has(fingerprint(fresh.A.pub)), 'a taken v2 request latches')
		assert.equal(acceptSshKey(fresh.v1(), '10.0.0.5', fresh.recv).status, 400)
	})
})

describe('WO-1106 C27 latch on the peer record', () => {
	const SELF = { appId: 'highascg', selfId: 'boxA', hostname: 'boxA', instanceId: 'iA', appVersion: 'x', role: 'standalone' }
	const memStore = (init) => {
		const m = new Map(init ? [['clusterPeers', init]] : [])
		return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }
	}
	const B = keyPair()
	const ping = (caps) => ({ appId: 'highascg', selfId: 'boxB', hostname: 'boxB', instanceId: 'iB', appVersion: 'x', role: 'standalone', caps })
	const make = (store, caps) =>
		createCluster({
			persistence: store,
			selfPing: async () => SELF,
			fetchJson: async (h, p, u) => (u === '/api/replication/ping' ? { ok: true, status: 200, json: ping(caps) } : { ok: false, status: 0, json: null }),
			localAddress: async () => '',
			request: async () => ({ ok: false, status: 0, error: 'offline test' }),
			log: () => {},
		})
	const record = { id: 'boxB', host: '10.0.0.6', port: 4200, name: 'boxB', added_at: 1, device_key: B.pub.trim(), linked_at: 1 }

	it('an older peer (no cap) is not latched; one advertising call-signed is, persisted across a restart', async () => {
		const store = memStore([{ ...record }])
		const c = make(store, [])
		await c.poll()
		assert.equal(c.spokeV2(fingerprint(B.pub)), false)
		c.stop()
		const d = make(store, [CAP])
		await d.poll()
		assert.equal(d.spokeV2(fingerprint(B.pub)), true)
		assert.equal(store.get('clusterPeers')[0].signed_v2, true, 'persisted with the peer record')
		d.stop()
		const e = make(store, [])
		assert.equal(e.spokeV2(fingerprint(B.pub)), true, 'a restart keeps it (even if the ping now says nothing)')
		e.stop()
	})

	it('markV2 latches a known server only; unlink + link clears it (a fresh record)', async () => {
		const store = memStore([{ ...record }])
		const c = make(store, [])
		c.markV2('0123456789abcdef')
		assert.equal(store.get('clusterPeers')[0].signed_v2, undefined)
		c.markV2(fingerprint(B.pub))
		assert.equal(store.get('clusterPeers')[0].signed_v2, true)
		c.remove?.('boxB')
		c.stop()
		const fresh = memStore([{ ...record }])
		assert.equal(make(fresh, []).spokeV2(fingerprint(B.pub)), false)
	})
})
