'use strict'

/**
 * WO-1029 plan 07 C10 — the shared media library on the virtual box bed (two real nodes, each with its own temp media
 * folder; the Spread copies with the bed's loopback transport, never ssh):
 *   1  a clip only in A's folder, used by a look on B's screen → media-needs on EITHER node lists it missing on B
 *   2  Spread from A's node → the file is in B's folder at the same relative path, same size; needs empty; nothing deleted
 *   3  from B's node: A pushes (the source is the other server) a needed clip AND an explicit, not-needed file outside
 *      any project folder (owner 10.11: "i have big buck on this box … i cant seem to spread it"); the library lists it on both
 *   4  a clip on neither box is missing everywhere and not spreadable; a second explicit spread says "already there"
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startVirtualBoxes, twoBoxes, looksFor, DEST } = require('../e2e/virtual-boxes')
const { waitFor } = require('../e2e/cluster-nodes')

const CLIP = 'MEDIA_SPREAD/VB_CLIP'
const CLIP2 = 'MEDIA_SPREAD/VB_CLIP2'
const BIG = 'TESTOWE/BIG_BUCK_BUNNY_1080P24'

describe('WO-1029 C10 shared media library on the virtual bed', { timeout: 90000 }, () => {
	const c = {}
	const media = (id) => c.bed.box(id).node.sb.dirs.media
	const put = (id, rel, bytes) => {
		const p = path.join(media(id), rel)
		fs.mkdirSync(path.dirname(p), { recursive: true })
		fs.writeFileSync(p, Buffer.alloc(bytes, 3))
		return p
	}
	const needs = async (id) => {
		const r = await c.bed.box(id).node.get('/api/cluster/media-needs?refresh=1', 20000)
		assert.equal(r.status, 200, JSON.stringify(r.data))
		return r.data
	}
	const row = (n, id) => n.files.find((f) => f.id === id)
	const spreadDone = (id) =>
		waitFor(`${id}: spread finished`, async () => {
			const r = await c.bed.box(id).node.get('/api/cluster/media-spread/status')
			return r.data && !r.data.running && r.data.run && r.data.run
		}, 30000, 200).then((r) => r.value)

	before(async () => {
		c.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1029-vb-media-'))
		c.bed = await startVirtualBoxes(c.tmp, twoBoxes({ base: 200 }))
		await c.bed.linkAll()
		const dests = c.bed.dests
		const show = {
			version: 1,
			name: 'Virtual show',
			scenes: { scenes: [...looksFor(dests), ...[['look_stream_clip', CLIP], ['look_stream_clip2', CLIP2]].map(([lid, v]) => ({ id: lid, name: lid, mainScope: '1', layers: [{ layerNumber: 20, source: { type: 'file', value: v } }] }))] },
			timelines: { timelines: [], activeId: null },
		}
		for (const n of c.bed.nodes) assert.equal((await n.post('/api/project/save', { project: show })).status, 200)
		c.src = put('vb-a', 'MEDIA_SPREAD/vb_clip.mp4', 3 * 1024 * 1024 + 17)
		put('vb-a', 'MEDIA_SPREAD/vb_clip2.mp4', 1024 * 1024)
		put('vb-a', 'TESTOWE/BIG_BUCK_BUNNY_1080P24.y4m', 5 * 1024 * 1024)
		c.bOwn = put('vb-b', 'b_own.mp4', 1234)
	})
	after(async () => {
		await c.bed?.stop()
		if (c.tmp) fs.rmSync(c.tmp, { recursive: true, force: true })
	})

	it('1: either node lists the clip missing on B (the owner of the screen its look is on)', async () => {
		for (const id of ['vb-a', 'vb-b']) {
			const n = await waitFor(`${id} sees ${CLIP} missing on vb-b`, async () => {
				const x = await needs(id)
				return row(x, CLIP)?.missing_on?.includes('vb-b') && x
			}, 20000, 300).then((r) => r.value)
			const x = row(n, CLIP)
			assert.deepEqual(x.on, ['vb-a'])
			assert.deepEqual(x.missing_on, ['vb-b'])
			assert.equal(x.spreadable, true)
			assert.equal(x.path, 'MEDIA_SPREAD/vb_clip.mp4')
			assert.ok(x.needed_on[0].destinations.some((d) => d.id === DEST.stream.id))
			assert.ok(n.servers.every((s) => s.known), JSON.stringify(n.servers))
			assert.ok(!row(n, BIG), 'big buck is not needed by any look')
			assert.ok(n.summary.to_send.files >= 2)
		}
	})

	it('2: Spread from A → B has it (same path, same size); needs empty; nothing deleted', async () => {
		const r = await c.bed.box('vb-a').node.post('/api/cluster/media-spread', { files: [CLIP], to: ['vb-b'] })
		assert.equal(r.status, 202, JSON.stringify(r.data))
		const run = await spreadDone('vb-a')
		assert.deepEqual(run.files.map((f) => [f.id, f.from, f.to, f.state]), [[CLIP, 'vb-a', 'vb-b', 'done']], JSON.stringify(run))
		const dest = path.join(media('vb-b'), 'MEDIA_SPREAD/vb_clip.mp4')
		assert.equal(fs.statSync(dest).size, fs.statSync(c.src).size)
		assert.ok(fs.existsSync(c.src), 'the source stays (no move)')
		assert.ok(fs.existsSync(c.bOwn), "B's own file stays")
		assert.ok(!fs.existsSync(path.join(media('vb-b'), 'MEDIA_SPREAD/.highascg-partial')))
		const n = await needs('vb-b')
		assert.deepEqual(row(n, CLIP).missing_on, [])
		assert.deepEqual(row(n, CLIP).on, ['vb-a', 'vb-b'])
	})

	it('3: from B, A pushes a needed clip and an explicit not-needed file outside any project folder', async () => {
		const r = await c.bed.box('vb-b').node.post('/api/cluster/media-spread', { files: [CLIP2, BIG], to: ['vb-b'] })
		assert.equal(r.status, 202, JSON.stringify(r.data))
		const run = await spreadDone('vb-b')
		assert.deepEqual(run.files.map((f) => [f.id, f.from, f.state]).sort(), [[CLIP2, 'vb-a', 'done'], [BIG, 'vb-a', 'done']].sort(), JSON.stringify(run))
		assert.equal(fs.statSync(path.join(media('vb-b'), 'TESTOWE/BIG_BUCK_BUNNY_1080P24.y4m')).size, 5 * 1024 * 1024)
		assert.ok(fs.existsSync(path.join(media('vb-a'), 'TESTOWE/BIG_BUCK_BUNNY_1080P24.y4m')))
		const lib = await c.bed.box('vb-b').node.get('/api/cluster/media-library?limit=100')
		assert.equal(lib.status, 200)
		assert.deepEqual(lib.data.items.find((i) => i.id === BIG)?.on, ['vb-a', 'vb-b'])
	})

	it('4: a clip on neither box is missing everywhere and not spreadable; a repeat spread is "already there"', async () => {
		const n = await needs('vb-a')
		const ghost = row(n, 'LOOK_A')
		assert.ok(ghost, 'the bed looks use LOOK_A, which no media folder has')
		assert.deepEqual(ghost.on, [])
		assert.equal(ghost.spreadable, false)
		assert.deepEqual(ghost.missing_on.sort(), ['vb-a', 'vb-b'])
		assert.deepEqual(row(n, CLIP2).missing_on, [])
		const again = await c.bed.box('vb-a').node.post('/api/cluster/media-spread', { files: [BIG], to: ['vb-b'] })
		assert.equal(again.status, 400)
		assert.deepEqual(again.data.skipped.map((s) => s.error), ['already there'])
		const def = await c.bed.box('vb-a').node.post('/api/cluster/media-spread', {})
		assert.equal(def.status, 400, 'only unspreadable clips are left')
		assert.ok(def.data.skipped.every((s) => s.error === 'on no linked server'), JSON.stringify(def.data.skipped))
	})
})
