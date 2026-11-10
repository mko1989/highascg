'use strict'

/**
 * WO-1029 P1e — replay of the linking incident on real sandbox servers told apart by loopback address (not by port):
 * a master box changed its address, its peer kept the old one and, unable to reach it, took the master role over.
 *
 *   1. re-address:  A (master) is moved to a new address; B still has the old one (dead). B must show A online at the
 *                   NEW address, A stays master on both, the epoch does not climb, a Make master on A is not overruled.
 *   2. one-way cut: D cannot reach C (forwarder paused) for longer than the failover time while C reaches D → no failover.
 *   3. true loss:   C stopped → D takes over.
 *
 * 1 and 2+3 run side by side (separate node pairs). Until the product fixes land (signed hello re-addressing,
 * failover only when truly unreachable) the assertions they cover are expected to fail. Harness: tools/e2e/cluster-nodes.js.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startSandboxNodes, waitFor, clusterView } = require('../e2e/cluster-nodes')

const FAILOVER_MS = 12000

/** Two explicit links (the loopback source address is 127.0.0.1, so the automatic link-back names nobody: see cluster-nodes.js). */
async function linkBoth(a, aToB, b, bToA) {
	const r1 = await a.post('/api/cluster/peers', { address: aToB })
	assert.ok(r1.status === 200 || r1.status === 201, `${a.id} → ${aToB}: ${r1.status} ${JSON.stringify(r1.data)}`)
	const r2 = await b.post('/api/cluster/peers', { address: bToA })
	assert.ok(r2.status === 200 || r2.status === 201, `${b.id} → ${bToA}: ${r2.status} ${JSON.stringify(r2.data)}`)
}

const peerOf = (v, id) => v?.peers?.find((p) => p.id === id)
const online = (a, b) => async () => {
	const [va, vb] = [await clusterView(a), await clusterView(b)]
	return peerOf(va, b.id)?.online && peerOf(vb, a.id)?.online && true
}

/** Make `master` the master and wait until both agree → epoch. */
async function makeMaster(master, other) {
	const r = await master.post('/api/cluster/master/set', { master: 'self', auto: true })
	assert.equal(r.status, 200, JSON.stringify(r.data))
	const epoch = r.data.epoch
	await waitFor(`${other.id} follows ${master.id}`, async () => {
		const v = await clusterView(other)
		return v?.master?.master_id === master.id && v.master.epoch === epoch
	}, 8000, 100)
	return epoch
}

function pair(label, hosts) {
	const ctx = {}
	before(async () => {
		ctx.tmp = fs.mkdtempSync(path.join(os.tmpdir(), `wo1029-${label}-`))
		ctx.ids = Object.keys(hosts)
		ctx.nodes = await startSandboxNodes(ctx.tmp, ctx.ids, { hosts })
		ctx.a = ctx.nodes[0]
		ctx.b = ctx.nodes[1]
	})
	after(async () => {
		if (ctx.nodes) await Promise.all(ctx.nodes.map((n) => n.stop()))
		if (ctx.tmp) fs.rmSync(ctx.tmp, { recursive: true, force: true })
	})
	return ctx
}

describe('WO-1029 incident replay', { timeout: 90000, concurrency: true }, () => {
	describe('re-address: the master moves, its peer holds the old address', { concurrency: false }, () => {
		const c = pair('move', { 'sb-a': '127.0.1.11', 'sb-b': '127.0.1.12' })
		let epoch0, oldAddr
		before(async () => {
			await linkBoth(c.a, c.b.address, c.b, c.a.address)
			await waitFor('A and B online to each other', online(c.a, c.b), 10000)
			epoch0 = await makeMaster(c.a, c.b)
			oldAddr = c.a.address
		})

		it('after A moves: B shows A online at the new address, A still master, epoch unchanged', async () => {
			await c.a.move('127.0.1.21')
			assert.notEqual(c.a.address, oldAddr)
			assert.equal((await c.a.get('/api/replication/ping')).status, 200, 'A answers at its new address')
			await waitFor('B lists A online at the new address', async () => {
				const p = peerOf(await clusterView(c.b), c.a.id)
				return p && p.online && p.host === c.a.host && p.port === c.a.port && p
			}, 20000, 200)
			const [va, vb] = [await clusterView(c.a), await clusterView(c.b)]
			assert.equal(va.master.is_master, true, 'A is master on A')
			assert.equal(vb.master.master_id, c.a.id, 'A is master on B')
			assert.equal(va.master.epoch, epoch0, 'epoch on A did not climb')
			assert.equal(vb.master.epoch, epoch0, 'epoch on B did not climb')
		})

		it('Make master on A is not overruled', async () => {
			const epoch = await makeMaster(c.a, c.b)
			assert.ok(epoch > epoch0)
			// a failover on B would show inside a few polls; hold the check past one poll interval
			await new Promise((r) => setTimeout(r, 4000))
			const [va, vb] = [await clusterView(c.a), await clusterView(c.b)]
			assert.equal(va.master.is_master, true)
			assert.equal(vb.master.master_id, c.a.id)
			assert.equal(vb.master.epoch, epoch)
			assert.equal(va.master.epoch, epoch)
		})
	})

	describe('one-way cut, then true loss', { concurrency: false }, () => {
		const c = pair('cut', { 'sb-c': '127.0.1.31', 'sb-d': '127.0.1.32' })
		let epoch0, fwd
		before(async () => {
			fwd = await c.a.linkVia() // D reaches C only through the forwarder; C reaches D directly
			await linkBoth(c.a, c.b.address, c.b, fwd.address)
			await waitFor('C and D online to each other', online(c.a, c.b), 10000)
			epoch0 = await makeMaster(c.a, c.b)
		})

		it('D cannot reach C past the failover time while C reaches D: no failover', async () => {
			fwd.pause()
			const t0 = Date.now()
			// D may or may not mark C offline (a fix may keep it online off C's own calls): the master must not move either way
			// C → D works the whole time
			while (Date.now() - t0 < FAILOVER_MS + 3000) {
				assert.equal(peerOf(await clusterView(c.a), c.b.id)?.online, true, 'C still reaches D')
				const [va, vb] = [await clusterView(c.a), await clusterView(c.b)]
				assert.equal(vb.master.is_master, false, `D took the master role after ${Date.now() - t0} ms though C is alive`)
				assert.equal(va.master.is_master, true, 'C is still master')
				assert.equal(vb.master.epoch, epoch0)
				await new Promise((r) => setTimeout(r, 1000))
			}
			fwd.resume()
			await waitFor('D sees C online again', async () => peerOf(await clusterView(c.b), c.a.id)?.online === true, 10000, 200)
		})

		it('C really gone: D takes over', async () => {
			// precondition: the takeover below must be earned by the loss, not left over from the cut case
			const pre = await clusterView(c.b)
			assert.equal(pre.master.is_master, false, 'D is not master before C is stopped')
			await c.a.stop()
			const t = await waitFor('D claims the master role', async () => {
				const v = await clusterView(c.b)
				return v?.master?.is_master === true && v.master.epoch > epoch0 && v.master
			}, FAILOVER_MS + 15000, 300)
			assert.ok(t.value.epoch > epoch0)
		})
	})
})
