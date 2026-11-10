'use strict'

/**
 * WO-1029 — a remote operator client hands over between boxes (owner 10.11: "in case of the master failure i want to be
 * moved to the backup/follower, so i have control"). HANDOVER-CONTRACT.md (scratchpad linking-review): the decision is
 * the Godot client's (handover_model.gd); here the SERVER side of it is tested on the virtual box bed with the same
 * decision mirrored in tools/e2e/remote-client.js (`learnTargets`, `decide` → handoverDecision: stay / move / offer /
 * offer_return).
 *
 *   1  on master A the client learns B as a target at B's CURRENT address, also after B moved to another alias
 *   2  one-way: only the client → A path is cut (forwarder), A and B still see each other → offer, never move (rule 3)
 *   3  A frozen → within a bounded time B confirms (master, or A offline) → move(B); the client reconnects to B with the
 *      same password, drives B's own Stream PGM; a press on A's LED wall is answered without hanging, nothing reaches A
 *   4  A thawed → B stays master (no failback), the client stays on B, B shows A online → offer_return; returning works
 *      and A drives its own LED wall locally
 *   5  the write logs across the whole handover: no stray write on either box
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startVirtualBoxes, twoBoxes, DEST } = require('../e2e/virtual-boxes')
const { createRemoteClient, handoverDecision } = require('../e2e/remote-client')
const { waitFor, clusterView } = require('../e2e/cluster-nodes')
const { assertOnlyWriters, wrote, topClip } = require('../e2e/virtual-boxes-checks')

const PW = 'handover-pw'
const LED = DEST.led.id
const STREAM = DEST.stream.id

/** decide() rounds until `pred(decision)` → { decision, ms } (throws with the last decision). */
async function decideUntil(client, pred, ms, what) {
	const t0 = Date.now()
	const r = await waitFor(what, async () => {
		const d = await client.decide()
		return pred(d) && d
	}, ms, 300)
	return { decision: r.value, ms: Date.now() - t0 }
}

describe('handoverDecision (the contract rules, pure)', () => {
	const ans = (id, master, peers = []) => ({ id, view: { master: { is_master: master, settled: true }, peers } })
	it('stays while the box answers or before HANDOVER_AFTER; on-box never moves', () => {
		assert.equal(handoverDecision({ current: 'a', currentAlive: true, deadForMs: 0, answers: [ans('b', true)] }).kind, 'stay')
		assert.equal(handoverDecision({ current: 'a', currentAlive: false, deadForMs: 2000, answers: [ans('b', true)] }).kind, 'stay')
		assert.equal(handoverDecision({ loopback: true, current: 'a', currentAlive: false, deadForMs: 60000, answers: [ans('b', true)] }).kind, 'stay')
	})
	it('moves only on confirmation, prefers the master; offers otherwise; no answer → stay', () => {
		const dead = { current: 'a', currentAlive: false, deadForMs: 6000 }
		assert.deepEqual(handoverDecision({ ...dead, answers: [ans('c', false, [{ id: 'a', online: false }]), ans('b', true)] }).target, 'b')
		assert.equal(handoverDecision({ ...dead, answers: [ans('c', false, [{ id: 'a', online: false }])] }).kind, 'move')
		assert.equal(handoverDecision({ ...dead, answers: [ans('b', false, [{ id: 'a', online: true }])] }).kind, 'offer')
		assert.equal(handoverDecision({ ...dead, answers: [{ id: 'b', view: null }] }).kind, 'stay')
	})
	it('after a move, the first box back → offer_return (never a move)', () => {
		const d = handoverDecision({ current: 'b', first: 'a', currentAlive: true, deadForMs: 0, answers: [ans('a', false)] })
		assert.deepEqual([d.kind, d.target], ['offer_return', 'a'])
	})
})

describe('WO-1029 virtual boxes: remote client handover', { timeout: 58000, concurrency: false }, () => {
	const c = {}
	before(async () => {
		c.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1029-vb-handover-'))
		c.bed = await startVirtualBoxes(c.tmp, { ...twoBoxes({ base: 130 }), password: PW })
		c.toA = await c.bed.forwarder('vb-a') // ONLY the client goes through it: the boxes link each other directly
		await c.bed.linkAll()
		await c.bed.makeMaster('vb-a')
		await c.bed.shareShow()
		await c.bed.waitForwarding('vb-a')
		c.m0 = c.bed.mark()
		c.client = createRemoteClient({ url: `http://${c.toA.address}`, password: PW, localAddress: '127.0.3.31', timeoutMs: 15000 })
		assert.equal((await c.client.connect()).status, 200)
	})
	after(async () => {
		c.client?.close()
		for (const b of c.bed?.boxes.values() || []) b.node.thaw?.()
		if (c.bed) await c.bed.stop()
		if (c.tmp) fs.rmSync(c.tmp, { recursive: true, force: true })
	})

	it('1 on master A: learns B as a target at its current address, also after B moved', async () => {
		const { bed, client } = c
		const l = await client.learnTargets()
		assert.equal(l.self.id, 'vb-a')
		assert.equal(l.master.is_master, true)
		const b = bed.box('vb-b').node
		assert.deepEqual(client.targets.map((t) => [t.id, t.host, t.port, t.online]), [['vb-b', b.host, b.port, true]])
		await b.move('127.0.1.139')
		await waitFor('B back at its new alias, on its Caspar', async () => (await b.get('/api/device-view')).data?.live?.caspar?.connected === true, 15000, 200)
		const seen = await waitFor('A reports B at the new address', async () => {
			await client.learnTargets()
			const t = client.targets.find((x) => x.id === 'vb-b')
			return t && t.host === '127.0.1.139' && t.port === b.port && t.online && t
		}, 20000, 300)
		assert.equal(seen.value.host, b.host)
		await bed.waitForwarding('vb-a')
	})

	it('2 one-way: the client cannot reach A, A and B still see each other → offer B, never move', async () => {
		const { bed, client } = c
		c.toA.pause()
		try {
			const r = await decideUntil(client, (d) => d.kind !== 'stay', 15000, 'a decision past HANDOVER_AFTER')
			assert.deepEqual([r.decision.kind, r.decision.target], ['offer', 'vb-b'], r.decision.why)
			for (let i = 0; i < 3; i++) assert.equal((await client.decide()).kind, 'offer', 'still only an offer')
			assert.equal((await clusterView(bed.box('vb-b').node)).peers.find((p) => p.id === 'vb-a')?.online, true, 'B still sees A')
		} finally {
			c.toA.resume()
		}
		assert.equal(await client.alive(), true)
		assert.equal((await client.decide()).kind, 'stay')
	})

	it('3 A frozen → move(B) within a bounded time; the client drives B; A\'s screen answered without hanging', async (t) => {
		const { bed, client } = c
		c.mFreeze = bed.mark()
		bed.box('vb-a').node.freeze()
		const r = await decideUntil(client, (d) => d.kind === 'move', 30000, 'B confirms the loss of A')
		t.diagnostic(`move after ${r.ms} ms: ${r.decision.why}`)
		assert.equal(r.decision.target, 'vb-b')
		const k = await client.moveTo('vb-b')
		assert.equal(k.status, 200, 'the same password works on B')
		assert.equal(k.wsStatus, 101)
		assert.equal(client.current.id, 'vb-b')
		const s = await client.takeLook(bed.look('stream', 'b'))
		assert.equal(s.status, 200, JSON.stringify(s.data))
		await bed.waitScreen('vb-b', STREAM, () => topClip(bed, 'vb-b', STREAM) === 'LOOK_B', 'B\'s own screen driven by the moved client')
		assert.ok(wrote(bed, 'vb-b', STREAM, c.mFreeze, 'vb-b').length > 0)
		const t0 = Date.now()
		const p = await client.takeLook(bed.look('led'))
		const ms = Date.now() - t0
		t.diagnostic(`press on A's LED wall while A is gone: ${p.status} in ${ms} ms ${JSON.stringify(p.data)?.slice(0, 160)}`)
		assert.ok(p.status === 200 || p.status === 409, `answered (${p.status} ${JSON.stringify(p.data)?.slice(0, 200)})`)
		assert.ok(ms < 10000, `without hanging (${ms} ms)`)
		c.bMasterPressed = p.status === 200 && (await clusterView(bed.box('vb-b').node))?.master?.is_master === true
		assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: c.mFreeze, allowed: [] }, 'nothing reached A while it was gone')
	})

	it('4 A thawed → B stays master, the client stays on B (offer_return), returning to A works, A drives its own screen', async () => {
		const { bed, client } = c
		const wasMaster = (await clusterView(bed.box('vb-b').node))?.master?.is_master === true
		bed.box('vb-a').node.thaw()
		await waitFor('B shows A online again', async () => (await clusterView(bed.box('vb-b').node))?.peers.find((p) => p.id === 'vb-a')?.online === true, 20000, 300)
		if (wasMaster) {
			const v = await clusterView(bed.box('vb-b').node)
			await bed.waitMaster('vb-b', v.master.epoch)
		}
		const d = await decideUntil(client, (x) => x.kind !== 'stay', 10000, 'the return offer')
		assert.deepEqual([d.decision.kind, d.decision.target], ['offer_return', 'vb-a'], d.decision.why)
		assert.equal(client.current.id, 'vb-b', 'nothing moved by itself')
		const k = await client.moveTo('vb-a')
		assert.equal(k.status, 200)
		assert.equal(client.current.id, 'vb-a')
		c.mReturn = bed.mark()
		const r = await client.takeLook(bed.look('led', 'b'))
		assert.equal(r.status, 200, JSON.stringify(r.data))
		assert.notEqual(r.data?.viaMaster, true, 'A\'s own screen is taken on A (rule 1)')
		await bed.waitScreen('vb-a', LED, () => topClip(bed, 'vb-a', LED) === 'LOOK_B', 'A\'s local take')
		await bed.settle()
		assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: c.mReturn, allowed: ['vb-a'] }, 'after the return')
	})

	it('5 the whole handover: no stray write on either box', async () => {
		const { bed } = c
		await bed.settle()
		// B's press on A's LED wall while it was master (if it was) may land on A when A is back (last press wins, rule 2)
		assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: c.m0, allowed: c.bMasterPressed ? ['vb-a', 'vb-b'] : ['vb-a'] }, 'A\'s LED wall')
		assertOnlyWriters(bed, { box: 'vb-b', dest: STREAM, since: c.m0, allowed: ['vb-b'] }, 'B\'s Stream PGM')
	})
})
