'use strict'

/**
 * WO-1029 P1b — mastership after the 7579/5867 incident (src/cluster/cluster-master.js): B could not reach A while A
 * could reach B; B failed over and A stepped down. In-memory servers with real ed25519 keys, ONE-WAY reachability
 * (`cut` 'B>A' = B cannot reach A), restartable nodes on their own stores and an injected clock (no sleeps).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const { createMaster, claimText, FAILOVER_MS, BOOT_GRACE_MS, FLOOR_KEY, STORE_KEY } = require('../../src/cluster/cluster-master')
const { fingerprint } = require('../../src/cluster/cluster-media')

const POLL = 5000

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

/** names → servers linked to each other (unless `links` says otherwise). boot(n) (re)starts n on its own store. */
function cluster(names, links = {}) {
	const clock = { t: 1_000_000 }
	const up = new Set(names)
	const cut = new Set()
	const reach = (from, to) => up.has(from) && up.has(to) && !cut.has(`${from}>${to}`)
	const nodes = {}
	const keys = {}
	const stores = {}
	const seen = {}
	for (const n of names) {
		const k = crypto.generateKeyPairSync('ed25519')
		keys[n] = { pub: k.publicKey.export({ type: 'spki', format: 'pem' }), priv: k.privateKey }
		stores[n] = memStore()
		seen[n] = {}
	}
	const sign = (n, msg) => crypto.sign(null, Buffer.from(msg), keys[n].priv).toString('base64')
	function boot(n, linkList) {
		const peers = (linkList || links[n] || names.filter((x) => x !== n)).map((x) => ({ id: x, host: x, port: 4200, name: x, device_key: keys[x].pub.trim() }))
		const c = {
			list: () => peers,
			saved: (id) => peers.find((p) => p.id === id) || null,
			byDeviceKey: (pem) => peers.find((p) => p.device_key === String(pem).trim()) || null,
			snapshot: () => ({ peers: peers.map((p) => ({ id: p.id, online: reach(n, p.id), last_seen: seen[n][p.id] || 0 })) }),
		}
		const logs = []
		nodes[n] = createMaster({
			cluster: c,
			persistence: stores[n],
			selfKey: keys[n].pub,
			sign: (msg) => sign(n, msg),
			verify,
			now: () => clock.t,
			log: (lvl, msg) => logs.push(`${lvl} ${msg}`),
			fetchJson: async (host) => {
				if (!reach(n, host)) return { ok: false, status: 0, error: 'ECONNREFUSED' }
				return { ok: true, status: 200, json: { claim: nodes[host].claim(), ...nodes[host].view() } }
			},
			post: async (host, port, p, body) => {
				if (!reach(n, host)) return { ok: false, status: 0, error: 'ECONNREFUSED' }
				const r = nodes[host].accept(body)
				return { ok: r.status === 200, status: r.status, json: r.body }
			},
		})
		nodes[n].logs = logs
		return nodes[n]
	}
	for (const n of names) boot(n)
	/** a cluster poll: each up server records who IT reaches, then every up server ticks (in `order`). */
	async function round(order = names, step = POLL) {
		clock.t += step
		for (const n of names) for (const x of names) if (x !== n && reach(n, x)) seen[n][x] = clock.t
		for (const n of order) if (up.has(n)) await nodes[n].tick()
	}
	return { nodes, keys, stores, up, cut, clock, round, boot, sign, fp: (n) => fingerprint(keys[n].pub) }
}

describe('WO-1029 P1b mastership', () => {
	it('asymmetric partition: the master can push but cannot be polled → no failover, it stays master', async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		await k.round()
		k.cut.add('B>A') // the incident: B's view of A goes stale, A still reaches B
		for (let i = 0; i < 10; i++) {
			await k.round(i % 2 ? ['A', 'B'] : ['B', 'A'])
			assert.equal(k.nodes.B.claim().master, k.fp('A'), `round ${i}: B keeps A`)
			assert.equal(k.nodes.A.view().is_master, true, `round ${i}: A stays master`)
		}
		assert.equal(k.nodes.B.claim().epoch, 1, 'no failover claim was made')
		assert.doesNotMatch(k.nodes.B.logs.join('\n'), /failover/)
	})

	it('master truly gone: failover after FAILOVER_MS, not before', async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		await k.round()
		k.up.delete('A')
		const gone = k.clock.t
		while (k.clock.t + 1000 - gone < FAILOVER_MS) {
			await k.round(['B'], 1000)
			assert.equal(k.nodes.B.claim().master, k.fp('A'), `not yet at +${k.clock.t - gone} ms`)
		}
		await k.round(['B'], 2000)
		assert.equal(k.nodes.B.claim().master, k.fp('B'))
		assert.equal(k.nodes.B.claim().epoch, 2)
	})

	it("operator Make master on A sticks while B's last_seen of A is old", async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.B.set({ master: 'self' })
		await k.round()
		k.cut.add('B>A')
		k.clock.t += FAILOVER_MS * 5 // B has not seen A for a minute (A is a follower: no failover question)
		await k.round()
		assert.equal(k.nodes.B.claim().master, k.fp('B'))
		const r = await k.nodes.A.set({ master: 'self' })
		assert.equal(r.status, 200)
		assert.equal(k.nodes.B.claim().master, k.fp('A'), 'pushed and taken')
		for (let i = 0; i < 6; i++) {
			await k.round(['B', 'A'])
			assert.equal(k.nodes.B.claim().master, k.fp('A'), `round ${i}: not overruled by B`)
			assert.equal(k.nodes.A.view().is_master, true)
		}
	})

	it('restart keeps the epoch floor (a dropped claim cannot be re-issued at a beaten epoch)', async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		await k.nodes.A.set({ master: 'B' })
		await k.nodes.B.set({ master: 'A' })
		assert.equal(k.nodes.A.claim().epoch, 3)
		k.nodes.A.forget('test')
		assert.equal(k.stores.A.get(STORE_KEY), null)
		assert.equal(k.stores.A.get(FLOOR_KEY), 3)
		k.boot('A')
		k.up.delete('B')
		await k.nodes.A.set({ master: 'self' })
		assert.equal(k.nodes.A.claim().epoch, 4, 'made above the stored floor')
	})

	it('boot with a stale stored self-claim while a peer holds a newer claim → never is_master', async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		await k.round()
		k.up.delete('A')
		k.clock.t += FAILOVER_MS + 1000
		await k.round(['B'])
		assert.equal(k.nodes.B.claim().epoch, 2)
		const a = k.boot('A') // restart: the store still says "A, epoch 1"
		k.up.add('A')
		assert.equal(a.view().is_master, false)
		assert.equal(a.view().settled, false)
		assert.equal(a.claim(), null, 'no stale claim shown to the shared show / GET')
		for (let i = 0; i < 4; i++) {
			await k.round(['A', 'B'])
			assert.equal(a.view().is_master, false, `round ${i}`)
		}
		assert.equal(a.view().settled, true)
		assert.equal(a.claim().master, k.fp('B'))
	})

	it('boot unsettled while nobody answers; the master that reaches it settles it first', async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		k.up.delete('A')
		k.clock.t += FAILOVER_MS + 1000
		await k.round(['B'])
		const a = k.boot('A')
		k.up.add('A')
		k.cut.add('A>B') // A cannot reach B; B can push to A
		await k.round(['A'])
		assert.equal(a.view().is_master, false, 'first round: nobody answered, within the grace')
		await k.round(['B', 'A'])
		assert.equal(a.view().is_master, false)
		assert.equal(a.claim().master, k.fp('B'), "B's re-push reached A")
	})

	it('boot with a stale self-claim and nobody reachable → master after the grace (nothing contests it)', async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		const a = k.boot('A')
		k.up.delete('B')
		await k.round(['A'], 1000)
		assert.equal(a.view().is_master, false)
		await k.round(['A'], BOOT_GRACE_MS)
		assert.equal(a.view().is_master, true)
	})

	it('boot with no linked servers → is_master at once', async () => {
		const k = cluster(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		const a = k.boot('A', [])
		assert.equal(a.view().settled, true)
		assert.equal(a.view().is_master, true)
		assert.ok(a.claim())
	})

	it('set() lists who accepted, refused and was not reached; an online refusal is a warn', async () => {
		const k = cluster(['A', 'B', 'C', 'D'], { C: ['B'] }) // C never linked A
		k.up.delete('D')
		const r = await k.nodes.A.set({ master: 'self' })
		assert.equal(r.status, 200)
		assert.equal(r.body.is_master, true)
		const by = Object.fromEntries(r.body.push.map((p) => [p.id, p]))
		assert.equal(by.B.result, 'accepted')
		assert.equal(by.C.result, 'refused')
		assert.match(by.C.error, /not linked here/)
		assert.equal(by.D.result, 'unreachable')
		assert.match(k.nodes.A.logs.join('\n'), /warn \[cluster\] C: claim not taken/)
		assert.doesNotMatch(k.nodes.A.logs.join('\n'), /warn \[cluster\] D:/, 'an offline server not reached is no warning')
	})

	it('an absurd epoch is refused; clocks years apart are not (no NTP on a show LAN)', async () => {
		const k = cluster(['A', 'B'])
		const mk = (over) => {
			const c = { epoch: 1, master: k.fp('A'), succession: [k.fp('A')], auto: true, by: k.keys.A.pub, ts: k.clock.t, ...over }
			c.sig = k.sign('A', claimText(c))
			return c
		}
		assert.equal(k.nodes.B.accept(mk({ epoch: 2_000_000 })).status, 400, 'jump of 2e6 over floor 0')
		assert.equal(k.nodes.B.claim(), null)
		const year = 365 * 86400000
		assert.equal(k.nodes.B.accept(mk({ ts: k.clock.t + 2 * year })).status, 200, 'the sender clock two years ahead')
		assert.equal(k.nodes.B.claim().master, k.fp('A'))
		assert.equal(k.nodes.B.accept(mk({ epoch: 2, ts: k.clock.t - 2 * year })).status, 200, 'and two years behind')
		assert.equal(k.nodes.B.claim().epoch, 2)
	})
})
