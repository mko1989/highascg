'use strict'

/**
 * WO-1029 plan 07 Wave B — driving a screen that is on another linked server, on the virtual box bed
 * (tools/e2e/virtual-boxes.js `cwcBoxes`: real sandbox nodes, fake Caspars with a write log, `cluster.channelsWhereCabled`
 * on both). A = master with screen 1 (LED wall); B with screens 3 (PGM/PRV 3) and 4 (Stream PGM); screen 2 cabled
 * nowhere; screen 5 (Backup PGM) cabled on both. No copy channels: every press on another box's screen is a dest.* call
 * to its owner, and the owner's own node writes its own Caspar — the write-log invariant (`assertNoStrays`, every
 * destination written only by its own box) holds through the whole run.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startVirtualBoxes, cwcBoxes, DEST } = require('../e2e/virtual-boxes')
const { assertNoStrays, topClip } = require('../e2e/virtual-boxes-checks')
const { waitFor, clusterView } = require('../e2e/cluster-nodes')

const LED = DEST.led.id
const P3 = DEST.pgm3.id
const STREAM = DEST.stream.id
const BACKUP = DEST.backup.id
const card = (layers) => layers.some((l) => l.cg?.template === 'led_grid_test')
const ownBox = (box) => [box] // every destination: only its own box's node writes it

/** Mutating lines on box `id`'s Caspar since the mark (its own consumer housekeeping not counted). */
const writesOn = (bed, id, m) => bed.box(id).caspar.since(m[id]).filter((e) => e.channel != null && !/^(ADD|REMOVE)\s/i.test(e.line))

describe('WO-1029 Wave B virtual boxes: dest.* drives the other box\'s screens', { timeout: 58000 }, () => {
	const c = {}
	before(async () => {
		c.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1029-vb-dest-'))
		c.bed = await startVirtualBoxes(c.tmp, cwcBoxes({ base: 150, backup: true }))
		await c.bed.linkAll()
		await c.bed.makeMaster('vb-a')
		await c.bed.shareShow()
		// both boxes know who owns each screen (GET /api/cluster `destinations`: every destination, with owners)
		await waitFor('owners known on both boxes', async () => {
			const vs = await Promise.all(['vb-a', 'vb-b'].map((id) => clusterView(c.bed.box(id).node)))
			const kinds = vs.map((v) => Object.fromEntries((v?.destinations || []).map((d) => [d.id, d.kind])))
			return kinds[0][P3] === 'remote' && kinds[0][BACKUP] === 'backup' && kinds[1][LED] === 'remote' && kinds[0][DEST.zoom.id] === 'nowhere'
		}, 20000, 300)
	})
	after(async () => {
		for (const b of c.bed?.boxes.values() || []) b.node.thaw?.()
		if (c.bed) await c.bed.stop()
		if (c.tmp) fs.rmSync(c.tmp, { recursive: true, force: true })
	})

	it('channels only where cabled: A has no channel for B\'s screens and B none for A\'s; the master forwards nothing', async () => {
		const { bed } = c
		assert.ok(bed.box('vb-a').ch(LED) > 0)
		assert.equal(bed.box('vb-a').chans.get(P3).pgm, null)
		assert.equal(bed.box('vb-b').chans.get(LED).pgm, null)
		assert.ok(bed.box('vb-b').ch(P3) > 0 && bed.box('vb-b').ch(STREAM) > 0)
		const v = await clusterView(bed.box('vb-a').node)
		assert.equal(v.fanout.active, false, 'no AMCP mirror with channels only where cabled')
		const d = Object.fromEntries(v.destinations.map((x) => [x.id, x]))
		assert.equal(d[P3].owners.length, 1)
		assert.equal(d[P3].here, false)
		assert.equal(Object.values(d[P3].online)[0], true)
	})

	it('from A: a look on screen 3 plays on B\'s channel; A\'s Caspar receives nothing', async () => {
		const { bed } = c
		const m = bed.mark()
		const r = await bed.box('vb-a').node.post('/api/scene/take-look', { sceneId: bed.look('pgm3'), target: 'program', forceCut: true })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		assert.equal(r.data.via?.[0]?.ok, true, JSON.stringify(r.data))
		await bed.waitScreen('vb-b', P3, () => topClip(bed, 'vb-b', P3) === 'LOOK_A', 'look A on B\'s screen 3')
		await bed.settle()
		assert.deepEqual(writesOn(bed, 'vb-a', m).map((e) => e.line), [], 'A wrote nothing')
		assertNoStrays(bed, m, ownBox, 'take on screen 3 from A')
	})

	it('from A: test card and FTB on screen 4 land on B', async () => {
		const { bed } = c
		const m = bed.mark()
		await bed.box('vb-a').node.post('/api/scene/take-look', { sceneId: bed.look('stream', 'b'), target: 'program', forceCut: true })
		await bed.waitScreen('vb-b', STREAM, () => topClip(bed, 'vb-b', STREAM) === 'LOOK_B', 'stream look')
		let r = await bed.box('vb-a').node.post('/api/led-test-card/channel', { screenIdx: 3, enabled: true })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		await bed.waitScreen('vb-b', STREAM, card, 'test card on B\'s screen 4')
		r = await bed.box('vb-a').node.post('/api/led-test-card/channel', { screenIdx: 3, enabled: false })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		await bed.waitScreen('vb-b', STREAM, (v) => !card(v), 'card off')
		r = await bed.box('vb-a').node.post('/api/ftb', { screenIdx: 3, durationFrames: 0 })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		await bed.waitScreen('vb-b', STREAM, (v) => v.length === 0, 'B\'s screen 4 black')
		assert.equal(topClip(bed, 'vb-b', P3), 'LOOK_A', 'screen 3 untouched')
		await bed.settle()
		assert.deepEqual(writesOn(bed, 'vb-a', m).map((e) => e.line), [])
		assertNoStrays(bed, m, ownBox)
	})

	it('from B (the follower): a take on screen 1 lands on A', async () => {
		const { bed } = c
		const m = bed.mark()
		const r = await bed.box('vb-b').node.post('/api/scene/take-look', { sceneId: bed.look('led'), target: 'program', forceCut: true })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		await bed.waitScreen('vb-a', LED, () => topClip(bed, 'vb-a', LED) === 'LOOK_A', 'look A on A\'s LED wall')
		await bed.settle()
		assert.deepEqual(writesOn(bed, 'vb-b', m).map((e) => e.line), [], 'B wrote nothing to its own Caspar for it')
		assertNoStrays(bed, m, ownBox)
	})

	it('a hot-backup screen (cabled on both): a take on A lands on both Caspars, each written by its own node', async () => {
		const { bed } = c
		const m = bed.mark()
		const r = await bed.box('vb-a').node.post('/api/scene/take-look', { sceneId: bed.look('backup'), target: 'program', forceCut: true })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		assert.equal(r.data.via?.[0]?.ok, true, JSON.stringify(r.data))
		await bed.waitScreen('vb-a', BACKUP, () => topClip(bed, 'vb-a', BACKUP) === 'LOOK_A', 'A\'s backup screen')
		await bed.waitScreen('vb-b', BACKUP, () => topClip(bed, 'vb-b', BACKUP) === 'LOOK_A', 'B\'s backup screen')
		await bed.settle()
		assertNoStrays(bed, m, ownBox)
	})

	it('a press on the backup box (B) for the backup screen goes to the master, which drives both', async () => {
		const { bed } = c
		const m = bed.mark()
		const r = await bed.box('vb-b').node.post('/api/scene/take-look', { sceneId: bed.look('backup', 'b'), target: 'program', forceCut: true })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		assert.notEqual(r.data.diverged, true, 'the master answered')
		await bed.waitScreen('vb-a', BACKUP, () => topClip(bed, 'vb-a', BACKUP) === 'LOOK_B', 'A\'s backup screen')
		await bed.waitScreen('vb-b', BACKUP, () => topClip(bed, 'vb-b', BACKUP) === 'LOOK_B', 'B\'s backup screen')
		await bed.settle()
		assertNoStrays(bed, m, ownBox)
	})

	it('"FTB all" from A blacks A\'s and B\'s screens (results per screen)', async () => {
		const { bed } = c
		const m = bed.mark()
		const r = await bed.box('vb-a').node.post('/api/ftb', { durationFrames: 0 })
		assert.equal(r.status, 200, JSON.stringify(r.data))
		assert.deepEqual((r.data.remote || []).map((x) => [x.screen, x.ok]).sort(), [[2, true], [3, true], [4, true]])
		for (const [id, dest] of [['vb-a', LED], ['vb-a', BACKUP], ['vb-b', P3], ['vb-b', BACKUP]]) await bed.waitScreen(id, dest, (v) => v.length === 0, `${id} ${dest} black`)
		await bed.settle()
		assertNoStrays(bed, m, ownBox)
	})

	it('B frozen: the take on screen 3 answers "unreachable" in bounded time and nothing lands anywhere', async () => {
		const { bed } = c
		const m = bed.mark()
		bed.box('vb-b').node.freeze()
		try {
			const t0 = Date.now()
			const r = await bed.box('vb-a').node.post('/api/scene/take-look', { sceneId: bed.look('pgm3', 'b'), target: 'program', forceCut: true }, 15000)
			const ms = Date.now() - t0
			assert.ok(r.status === 502 || r.status === 503, `${r.status} ${JSON.stringify(r.data)}`)
			assert.equal(r.data.code, 'DEST_UNREACHABLE')
			assert.ok(ms < 7000, `answered in ${ms} ms`)
			assert.deepEqual(writesOn(bed, 'vb-a', m).map((e) => e.line), [], 'never played on A instead')
			await new Promise((res) => setTimeout(res, 300)) // still frozen a little after A gave up
		} finally {
			bed.box('vb-b').node.thaw()
		}
		await bed.settle()
		assert.notEqual(topClip(bed, 'vb-b', P3), 'LOOK_B', 'the refused take did not land later')
		assertNoStrays(bed, m, ownBox)
	})
})
