'use strict'

/**
 * WO-1029 plan 06 S1 / S3 / S4 / S5 / S6 on the virtual box bed (tools/e2e/virtual-boxes.js: two real sandbox nodes,
 * fake Caspars): A = master, B linked, show sharing OFF.
 *   1. a destination added on B exists on A within a bounded time (the shared list, not the show)
 *   2. A cables it on B through the relay → A's combined view shows the cable at once, GET /api/cluster owners include B
 *   3. each box keeps its own operator GUI across a mastership flip (show sharing on for that part)
 *   4. deleting the destination on A removes its cable on B
 *   5. B frozen during a delete → pending on A; after the thaw B deletes the cable
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startVirtualBoxes, twoBoxes } = require('../e2e/virtual-boxes')
const { waitFor } = require('../e2e/cluster-nodes')

const raw = (url, headers = {}) =>
	new Promise((resolve) => {
		require('node:http').get(url, { headers }, (res) => {
			res.resume()
			res.on('end', () => resolve({ status: res.statusCode, etag: res.headers.etag }))
		}).on('error', () => resolve({ status: 0 }))
	})
const dview = async (n) => (await n.get('/api/device-view')).data
const destIds = async (n) => ((await dview(n)).screenDestinations?.destinations || []).map((d) => d.id)
const guiOf = async (n) => ((await dview(n)).screenDestinations?.destinations || []).find((d) => d.mode === 'operator_gui')
const cablesTo = async (n, destId) => ((await dview(n)).graph?.edges || []).filter((e) => e.sourceId === `dst_in_${destId}`)

describe('WO-1029 plan 06: one Devices view for two linked virtual boxes', { timeout: 58000 }, () => {
	const c = {}
	before(async () => {
		c.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1029-vb-devices-'))
		c.bed = await startVirtualBoxes(c.tmp, twoBoxes({ base: 230 }))
		c.a = c.bed.box('vb-a').node
		c.b = c.bed.box('vb-b').node
		await c.bed.linkAll()
		await c.bed.makeMaster('vb-a')
		for (const [n, port] of [[c.a, 1], [c.b, 3]]) {
			const r = await n.post('/api/device-view', { addDestination: { type: 'operator_gui', physicalPort: port } })
			assert.equal(r.status, 200, JSON.stringify(r.data))
		}
		await waitFor('the shared list is active on both', async () => {
			const [x, y] = await Promise.all([c.a.get('/api/cluster/destinations'), c.b.get('/api/cluster/destinations')])
			return x.data?.active && y.data?.active && y.data.writer === 'vb-a'
		}, 15000, 200)
	})
	after(async () => {
		try {
			c.b?.thaw?.()
		} catch {}
		await c.bed?.stop()
	})

	it('1. a destination added on B exists on A (show sharing off), with no operator GUI carried over', async () => {
		assert.equal((await c.a.get('/api/cluster')).data.show.on, false)
		const t0 = Date.now()
		const r = await c.b.post('/api/device-view', { addDestination: { type: 'pgm_only', label: 'Added on B', mainScreenIndex: 2 } })
		assert.equal(r.status, 200)
		c.added = r.data.addedId
		assert.equal(r.data.cluster.writer, 'vb-a')
		await waitFor('A has it', async () => (await destIds(c.a)).includes(c.added), 5000, 50)
		assert.ok(Date.now() - t0 < 5000)
		assert.equal((await guiOf(c.a)).physicalPort, 1)
		assert.equal((await guiOf(c.b)).physicalPort, 3)
	})

	it('2. A cables it on B through the relay: the combined view and the owners see it at once', async () => {
		const r = await c.a.post(`/api/cluster/peers/vb-b/relay/api/device-view`, { addEdge: { sourceId: `dst_in_${c.added}`, sinkId: 'vb_out_1' } })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		const v = (await c.a.get('/api/cluster/device-view')).data
		const b = v.servers.find((s) => s.id === 'vb-b')
		assert.ok(b.cables.some((x) => x.destId === c.added && x.sinkId === 'vb_out_1' && x.key === `vb-b/${x.id}`), 'the cable, tagged with B')
		assert.ok(b.operatorGui.length === 1 && b.operatorGui[0].physicalPort === 3, 'B\'s operator GUI card')
		const d = (await c.a.get('/api/cluster')).data.destinations.find((x) => x.id === c.added)
		assert.ok(d?.owners.includes('vb-b'), `owners: ${JSON.stringify(d)}`)
		const first = await raw(c.a.url + '/api/cluster/device-view')
		assert.ok(first.etag, 'an ETag')
		assert.equal((await raw(c.a.url + '/api/cluster/device-view', { 'If-None-Match': first.etag })).status, 304)
	})

	it('3. each box keeps its own operator GUI across a mastership flip (show shared)', async () => {
		await c.bed.shareShow()
		await c.bed.makeMaster('vb-b')
		await c.bed.settle({ polls: 3 })
		assert.equal((await guiOf(c.a)).physicalPort, 1)
		assert.equal((await guiOf(c.b)).physicalPort, 3)
		await c.bed.makeMaster('vb-a')
		await c.bed.settle({ polls: 2 })
		assert.equal((await guiOf(c.a)).physicalPort, 1)
		assert.equal((await guiOf(c.b)).physicalPort, 3)
		const shared = async (n) => ((await dview(n)).screenDestinations?.destinations || []).filter((d) => d.mode !== 'operator_gui').map((d) => d.id).sort()
		assert.deepEqual(await shared(c.a), await shared(c.b), 'one shared list; each box\'s operator GUI (its own id) stays apart')
	})

	it('4. deleting the destination on A removes its cable on B', async () => {
		assert.equal((await cablesTo(c.b, c.added)).length, 1)
		const r = await c.a.post('/api/device-view', { removeDestination: { id: c.added } })
		assert.equal(r.status, 200)
		await waitFor('B dropped it and its cable', async () => !(await destIds(c.b)).includes(c.added) && (await cablesTo(c.b, c.added)).length === 0, 8000, 100)
	})

	it('5. B frozen during a delete: pending on A, cleaned after the thaw', async () => {
		const add = await c.a.post('/api/device-view', { addDestination: { type: 'pgm_only', label: 'Second', mainScreenIndex: 3 } })
		const id = add.data.addedId
		await waitFor('B has it', async () => (await destIds(c.b)).includes(id), 5000, 50)
		assert.equal((await c.a.post('/api/cluster/peers/vb-b/relay/api/device-view', { addEdge: { sourceId: `dst_in_${id}`, sinkId: 'vb_out_1' } })).status, 200)
		c.b.freeze()
		try {
			const r = await c.a.post('/api/device-view', { removeDestination: { id } })
			assert.equal(r.status, 200)
			await waitFor('A lists B as pending', async () => {
				const v = (await c.a.get('/api/cluster/destinations')).data
				return v.removals?.some((x) => x.destId === id && x.pending.includes('vb-b'))
			}, 5000, 100)
		} finally {
			c.b.thaw()
		}
		await waitFor('B deleted the cable after the thaw', async () => (await cablesTo(c.b, id)).length === 0 && !(await destIds(c.b)).includes(id), 20000, 200)
		await waitFor('A no longer lists it pending', async () => {
			await c.a.get('/api/cluster') // a poll: the next push carries the tombstone
			const v = (await c.a.get('/api/cluster/destinations')).data
			return !v.removals?.some((x) => x.destId === id && x.pending.length)
		}, 15000, 300)
	})
})
