'use strict'

/**
 * WO-670 P3a — the cluster's master, fenced by an epoch (src/cluster/cluster-master.js). Three in-memory servers with
 * real ed25519 device keys and a switchable network: a claim is signed, pushed and pulled; only linked signers and
 * newer claims are taken; auto failover promotes the first online server of the succession after FAILOVER_MS; a
 * returning old master steps down; a split network converges on one master; the routes are registered; P3b: started
 * at boot only when servers are linked.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const { createMaster, beats, claimText, FAILOVER_MS } = require('../../src/cluster/cluster-master')
const { fingerprint } = require('../../src/cluster/cluster-media')
const { RouteRegistry } = require('../../src/api/route-registry')

const verify = (pem, msg, sig) => {
	try {
		return crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64'))
	} catch {
		return false
	}
}

function memStore() {
	const m = new Map()
	return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }
}

/** names → servers that all linked each other (unless `links` says otherwise); net.up = which are reachable. */
function cluster(names, links = {}) {
	const clock = { t: 1_000_000 }
	const up = new Set(names)
	const nodes = {}
	const keys = {}
	for (const n of names) {
		const k = crypto.generateKeyPairSync('ed25519')
		keys[n] = { pub: k.publicKey.export({ type: 'spki', format: 'pem' }), priv: k.privateKey }
	}
	const seen = {}
	for (const n of names) {
		const peers = (links[n] || names.filter((x) => x !== n)).map((x) => ({ id: x, host: x, port: 4200, name: x, device_key: keys[x].pub.trim() }))
		seen[n] = {}
		const c = {
			list: () => peers,
			saved: (id) => peers.find((p) => p.id === id) || null,
			byDeviceKey: (pem) => peers.find((p) => p.device_key === String(pem).trim()) || null,
			snapshot: () => ({ peers: peers.map((p) => ({ id: p.id, online: up.has(p.id), last_seen: seen[n][p.id] || 0 })) }),
		}
		const logs = []
		nodes[n] = createMaster({
			cluster: c,
			persistence: memStore(),
			selfKey: keys[n].pub,
			sign: (msg) => crypto.sign(null, Buffer.from(msg), keys[n].priv).toString('base64'),
			verify,
			now: () => clock.t,
			log: (lvl, msg) => logs.push(`${lvl} ${msg}`),
			fetchJson: async (host) => (up.has(host) && up.has(n) ? { ok: true, status: 200, json: { claim: nodes[host].claim() } } : { ok: false, status: 0, error: 'ECONNREFUSED' }),
			post: async (host, port, p, body) => {
				if (!up.has(host) || !up.has(n)) return { ok: false, status: 0, error: 'ECONNREFUSED' }
				const r = nodes[host].accept(body)
				return { ok: r.status === 200, status: r.status, json: r.body }
			},
		})
		nodes[n].logs = logs
	}
	/** a poll: every server that is up sees the up ones now. */
	const poll = () => {
		for (const n of names) if (up.has(n)) for (const x of names) if (x !== n && up.has(x)) seen[n][x] = clock.t
	}
	return { nodes, keys, up, clock, poll, fp: (n) => fingerprint(keys[n].pub) }
}

describe('WO-670 P3a cluster master', () => {
	it('beats: higher epoch wins; same epoch → lower master fingerprint; nothing beats itself', () => {
		const a = { epoch: 2, master: 'b'.repeat(16) }
		assert.ok(beats(a, null) && beats(a, { epoch: 0 }))
		assert.ok(beats(a, { epoch: 1, master: 'a'.repeat(16) }))
		assert.ok(!beats({ epoch: 1, master: 'a'.repeat(16) }, a))
		assert.ok(beats({ epoch: 2, master: 'a'.repeat(16) }, a), 'split brain tie → lower fingerprint')
		assert.ok(!beats(a, { epoch: 2, master: 'a'.repeat(16) }))
		assert.ok(!beats(a, { ...a }), 'the same claim is not newer')
	})

	it('Make master signs epoch + 1 and pushes it to every linked server', async () => {
		const k = cluster(['A', 'B', 'C'])
		const r = await k.nodes.B.set({ master: 'A' })
		assert.equal(r.status, 200)
		assert.equal(r.body.master_id, 'A')
		for (const n of ['A', 'B', 'C']) assert.equal(k.nodes[n].claim().master, k.fp('A'), `${n} holds A as master`)
		assert.equal(k.nodes.A.view().is_master, true)
		assert.equal(k.nodes.C.view().master_id, 'A')
		assert.deepEqual(k.nodes.B.view().succession.map((s) => s.name), ['A', 'this server', 'C'], 'master, then who made it, then its links')
		assert.equal(k.nodes.C.claim().epoch, 1)
		await k.nodes.A.set({ master: 'self' })
		assert.equal(k.nodes.C.claim().epoch, 2, 'every change is a new epoch')
		assert.equal((await k.nodes.A.set({ master: 'Z' })).status, 404)
	})

	it('a claim is taken only from a linked signer, untampered, well-formed and newer', async () => {
		const k = cluster(['A', 'B', 'D'], { A: ['B'], B: ['A'], D: ['A', 'B'] })
		await k.nodes.A.set({ master: 'self' })
		const c = k.nodes.A.claim()
		assert.equal(k.nodes.B.accept(c).status, 200, 'the same claim again is fine')
		k.up.delete('A')
		k.up.delete('B')
		await k.nodes.D.set({ master: 'self' })
		k.up.add('A')
		k.up.add('B')
		const fromD = k.nodes.D.claim()
		assert.equal(fromD.epoch, 1)
		assert.equal(k.nodes.B.accept({ ...fromD, epoch: 5 }).status, 403, 'B never linked D')
		assert.equal(k.nodes.B.accept({ ...c, epoch: 3 }).status, 403, 'tampered after signing')
		assert.equal(k.nodes.B.accept({ ...c, master: 'nope' }).status, 400, 'malformed')
		await k.nodes.A.set({ master: 'self' })
		assert.equal(k.nodes.B.accept(c).status, 409, 'older than the one held')
		assert.equal(k.nodes.B.claim().epoch, 2)
		assert.equal(verify(k.keys.A.pub, claimText(k.nodes.B.claim()), k.nodes.B.claim().sig), true)
	})

	it('auto failover: the first online server of the succession takes over after FAILOVER_MS; others wait', async () => {
		const k = cluster(['A', 'B', 'C'])
		await k.nodes.A.set({ master: 'self' })
		k.poll()
		k.up.delete('A')
		k.clock.t += FAILOVER_MS - 2000
		k.poll()
		await k.nodes.B.tick()
		await k.nodes.C.tick()
		assert.equal(k.nodes.B.claim().master, k.fp('A'), 'not yet')
		k.clock.t += 3000
		k.poll()
		await k.nodes.C.tick()
		assert.equal(k.nodes.C.claim().master, k.fp('A'), 'C waits for B (ahead of it in the succession)')
		await k.nodes.B.tick()
		assert.equal(k.nodes.B.claim().master, k.fp('B'))
		assert.equal(k.nodes.B.claim().epoch, 2)
		assert.equal(k.nodes.C.claim().master, k.fp('B'), 'pushed to C')
		assert.match(k.nodes.B.logs.join('\n'), /master this server epoch 2 \(failover: A unseen \d+ s\)/)

		k.up.add('A')
		k.poll()
		await k.nodes.A.tick()
		assert.equal(k.nodes.A.claim().master, k.fp('B'), 'the old master pulled epoch 2 and stepped down')
		assert.match(k.nodes.A.logs.join('\n'), /stepped down: B is master \(epoch 2, from B\)/)
		assert.equal(k.nodes.A.view().is_master, false)
	})

	it('auto off: nobody takes over', async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self', auto: false })
		k.poll()
		k.up.delete('A')
		k.clock.t += FAILOVER_MS * 3
		await k.nodes.B.tick()
		assert.equal(k.nodes.B.claim().master, k.fp('A'))
		assert.equal(k.nodes.B.view().auto, false)
	})

	it('a split network that promoted on both sides converges on one master', async () => {
		const k = cluster(['A', 'B', 'C'])
		await k.nodes.A.set({ master: 'self' })
		k.up.delete('C')
		await k.nodes.B.set({ master: 'self' })
		k.up.add('C')
		k.up.delete('B')
		await k.nodes.C.set({ master: 'self' })
		assert.equal(k.nodes.B.claim().epoch, 2)
		assert.equal(k.nodes.C.claim().epoch, 2)
		k.up.add('B')
		await k.nodes.B.tick()
		await k.nodes.C.tick()
		await k.nodes.A.tick()
		const win = [k.fp('B'), k.fp('C')].sort()[0]
		for (const n of ['A', 'B', 'C']) assert.equal(k.nodes[n].claim().master, win, `${n} on the lower fingerprint`)
	})

	it('routes are registered', async () => {
		const routes = new RouteRegistry()
		require('../../src/api/routes-cluster').register(routes)
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		const ctx = { _cluster: { snapshot: () => ({ self: {}, peers: [] }) }, _clusterMaster: k.nodes.A }
		const get = await routes.dispatch('GET', '/api/cluster/master', '', ctx)
		assert.equal(JSON.parse(get.body).claim.epoch, 1)
		assert.equal((await routes.dispatch('POST', '/api/cluster/master', '{}', ctx)).status, 400)
		const set = await routes.dispatch('POST', '/api/cluster/master/set', JSON.stringify({ master: 'B' }), ctx)
		assert.equal(JSON.parse(set.body).master_id, 'B')
		const { startIfLinked } = require('../../src/api/routes-cluster')
		const idle = { persistence: { get: () => [] } }
		startIfLinked(idle)
		assert.equal(idle._cluster, undefined, 'P3b: no linked servers → nothing starts at boot')
		const index = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'index.js'), 'utf8')
		assert.match(index, /require\('\.\/src\/api\/routes-cluster'\)\.startIfLinked\(appCtx\)/, 'P3b: started at boot')
		k.nodes.A.forget()
		assert.equal(k.nodes.A.claim(), null, 'unlinking the last server drops the claim')
		assert.equal(k.nodes.A.view().epoch, 0)
	})
})
