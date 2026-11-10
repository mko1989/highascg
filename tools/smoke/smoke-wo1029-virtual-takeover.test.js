'use strict'

/**
 * WO-1029 phase 2a — the stray layer (10.11, live): after a takeover the new master replayed its own copy of a screen
 * onto the other box's LED wall. "obviously that's bad, need a good harness". Virtual box bed (tools/e2e/virtual-boxes.js):
 * A = LED wall (cabled on A only), B = Stream PGM (on B only); every assertion is on the fake Caspars' write logs, so a
 * stray write is caught whoever sends it (catch-up, replay, reconnect, restart).
 *
 *   takeover   a layer only on B's COPY of the LED channel (the incident probe, PLAY <ch>-99, put there while B was
 *              alone); A master; A frozen → B takes over → ZERO writes from B's node to A's own screens until B's
 *              operator presses one, also once A is back (thawed, no failback) and B's catch-up to it ran; then
 *              B's press lands on A (last press wins, rule 2); A's local press wins and B's catch-up never replays over it (holder, rule 3); Make master on A
 *              → no strays to B's Stream PGM; a node restart of each box → no strays
 *   backup     a destination cabled on both: it DOES get catch-up (B's Caspar restarts → the master replays it, and only
 *              it), it DOES hold the follower (409 AIR_HELD, rule 1), and with the master not answering a backup take
 *              on B plays locally within ~1 s, answered `diverged` (rule 4)
 * Contract: scratchpad P2A-CONTRACT.md (rules 1–4). Assertions on the new rules fail until the ownership code lands.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startVirtualBoxes, twoBoxes, DEST } = require('../e2e/virtual-boxes')
const { waitFor, clusterView } = require('../e2e/cluster-nodes')
const { assertOnlyWriters, assertNoStrays, wrote, topClip } = require('../e2e/virtual-boxes-checks')

const LED = DEST.led.id
const STREAM = DEST.stream.id
const BACKUP = DEST.backup.id
const take = (bed, id, look) => bed.box(id).node.post('/api/scene/take-look', { sceneId: look, target: 'program', forceCut: true })

function bedFor(label, spec, setup) {
	const c = {}
	before(async () => {
		c.tmp = fs.mkdtempSync(path.join(os.tmpdir(), `wo1029-vb-${label}-`))
		c.bed = await startVirtualBoxes(c.tmp, spec)
		await setup(c.bed, c)
	})
	after(async () => {
		for (const b of c.bed?.boxes.values() || []) b.node.thaw?.()
		if (c.bed) await c.bed.stop()
		if (c.tmp) fs.rmSync(c.tmp, { recursive: true, force: true })
	})
	return c
}

describe('WO-1029 virtual boxes: takeover and strays', { timeout: 58000, concurrency: true }, () => {
	describe('takeover: A (LED wall) master, B (Stream PGM) follower', { concurrency: false }, () => {
		const c = bedFor('takeover', twoBoxes({ base: 100 }), async (bed, c) => {
			const ledOnB = bed.box('vb-b').ch(LED)
			// B alone: the incident probe on B's copy of the LED channel, and each box's own screen on air
			const p = await bed.box('vb-b').node.post('/api/amcp/raw', { cmd: `PLAY ${ledOnB}-99 LOOK_C` })
			assert.equal(p.status, 200, JSON.stringify(p.data))
			assert.equal((await take(bed, 'vb-a', bed.look('led'))).status, 200)
			assert.equal((await take(bed, 'vb-b', bed.look('stream'))).status, 200)
			await bed.waitScreen('vb-b', STREAM, () => topClip(bed, 'vb-b', STREAM) === 'LOOK_A', 'B\'s own screen on air')
			c.m0 = bed.mark()
			await bed.linkAll()
			await bed.makeMaster('vb-a')
			await bed.shareShow()
			await bed.waitForwarding('vb-a')
			await bed.settle()
		})

		it('A becomes master: it writes nothing to B\'s own Stream PGM (holder empty), B nothing to A', () => {
			assertOnlyWriters(c.bed, { box: 'vb-b', dest: STREAM, since: c.m0, allowed: ['vb-b'] }, 'join catch-up')
			assertOnlyWriters(c.bed, { box: 'vb-a', dest: LED, since: c.m0, allowed: ['vb-a'] }, 'join catch-up')
		})

		it('A frozen → B takes over → zero writes from B to A\'s LED wall', async () => {
			const { bed } = c
			const m = bed.mark()
			bed.box('vb-a').node.freeze()
			await bed.waitMaster('vb-b', 1, [bed.box('vb-b').node], 30000)
			await bed.settle()
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: [] }, 'after the takeover')
			assert.equal(topClip(bed, 'vb-a', LED), 'LOOK_A', 'A\'s own look still up')
		})

		it('A thawed: no failback; B (new master) catches A up → still zero writes on A\'s LED wall (the stray layer)', async () => {
			const { bed } = c
			const m = bed.mark()
			bed.box('vb-a').node.thaw()
			const epoch = (await clusterView(bed.box('vb-b').node)).master.epoch
			await bed.waitMaster('vb-b', epoch)
			await bed.waitForwarding('vb-b', ['vb-a']) // B now forwards to A: its catch-up ran
			await bed.settle()
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: ['vb-a'] }, 'B\'s catch-up after the takeover')
			assert.notEqual(topClip(bed, 'vb-a', LED), 'LOOK_C', 'B\'s copy-channel probe is not on A\'s LED wall')
			assert.equal(topClip(bed, 'vb-a', LED), 'LOOK_A', 'A\'s own look still up')
			assertOnlyWriters(bed, { box: 'vb-b', dest: STREAM, since: m, allowed: ['vb-b'] }, 'B\'s own screen')
		})

		it('B\'s operator presses A\'s LED wall → it lands on A (last press wins)', async () => {
			const { bed } = c
			const m = bed.mark()
			assert.equal((await take(bed, 'vb-b', bed.look('led', 'b'))).status, 200)
			await bed.waitScreen('vb-a', LED, () => topClip(bed, 'vb-a', LED) === 'LOOK_B', 'B\'s press on A')
			assert.ok(wrote(bed, 'vb-a', LED, m, 'vb-b').length > 0, 'written by B\'s node (the master)')
		})

		it('A\'s local press wins; B\'s catch-up never replays over it (holder → A)', async () => {
			const { bed } = c
			const r = await take(bed, 'vb-a', bed.look('led'))
			assert.equal(r.status, 200, JSON.stringify(r.data))
			assert.notEqual(r.data?.viaMaster, true, 'A\'s own screen is taken locally (rule 1)')
			await bed.waitScreen('vb-a', LED, () => topClip(bed, 'vb-a', LED) === 'LOOK_A', 'A\'s local press')
			await waitFor('B records A as the holder of the LED wall', async () => {
				const d = (await clusterView(bed.box('vb-b').node))?.destinations || []
				return d.find((x) => x.id === LED)?.holder === 'vb-a'
			}, 8000, 200)
			const m = bed.mark()
			bed.box('vb-a').caspar.dropConnections() // every connection to A's Caspar drops: B's fan-out reconnects → catch-up
			await waitFor('B reconnected to A\'s Caspar', async () => bed.box('vb-a').caspar.connections().filter((x) => x.who === 'vb-b' && !x.closed).length > 0, 15000, 200)
			await bed.waitForwarding('vb-b', ['vb-a'])
			await bed.waitOwnCaspar('vb-a')
			await bed.settle()
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: ['vb-a'] }, 'B\'s catch-up after A\'s press')
			assert.equal(topClip(bed, 'vb-a', LED), 'LOOK_A')
		})

		it('Make master on A → no stray writes to B\'s own Stream PGM', async () => {
			const { bed } = c
			const m = bed.mark()
			await bed.makeMaster('vb-a')
			await bed.waitForwarding('vb-a')
			await bed.settle()
			assertNoStrays(bed, m, undefined, 'after Make master on A')
			assert.equal(topClip(bed, 'vb-b', STREAM), 'LOOK_A', 'B\'s own look still up')
		})

		it('a node restart of each box → no stray writes', async () => {
			const { bed } = c
			const m = bed.mark()
			const epoch = (await clusterView(bed.box('vb-a').node)).master.epoch
			await bed.restart('vb-a')
			await bed.waitMaster('vb-a', epoch)
			await bed.waitForwarding('vb-a')
			await bed.settle()
			assertNoStrays(bed, m, undefined, 'after A (master) restarted')
			const m2 = bed.mark()
			await bed.restart('vb-b')
			await bed.waitMaster('vb-a', epoch)
			await bed.waitForwarding('vb-a')
			await bed.settle()
			assertNoStrays(bed, m2, undefined, 'after B (follower) restarted')
		})
	})

	describe('backup: a destination cabled on both boxes', { concurrency: false }, () => {
		const c = bedFor('backup', twoBoxes({ base: 110, backup: true }), async (bed) => {
			await bed.linkAll()
			await bed.makeMaster('vb-a')
			await bed.shareShow()
			await bed.waitForwarding('vb-a')
			await bed.settle()
		})

		it('a take on the master lands on both boxes', async () => {
			const { bed } = c
			const m = bed.mark()
			assert.equal((await take(bed, 'vb-a', bed.look('backup'))).status, 200)
			for (const id of ['vb-a', 'vb-b']) await bed.waitScreen(id, BACKUP, () => topClip(bed, id, BACKUP) === 'LOOK_A', `backup on ${id}`)
			assert.ok(wrote(bed, 'vb-b', BACKUP, m, 'vb-a').length > 0, 'forwarded by the master')
		})

		it('B\'s Caspar restarts → the master catches the backup up (and only the backup)', async () => {
			const { bed } = c
			const m = bed.mark()
			bed.box('vb-b').caspar.wipe()
			bed.box('vb-b').caspar.dropConnections()
			await bed.waitScreen('vb-b', BACKUP, () => topClip(bed, 'vb-b', BACKUP) === 'LOOK_A', 'backup caught up on B', 15000)
			await bed.waitOwnCaspar('vb-b') // B's own node reconnects too (casparcg-connection retries every 5 s)
			assert.ok(wrote(bed, 'vb-b', BACKUP, m, 'vb-a').length > 0, 'replayed by the master')
			await bed.settle()
			assertNoStrays(bed, m, (box, dest) => (dest === BACKUP ? ['vb-a', 'vb-b'] : [box]), 'the catch-up')
		})

		it('B holds the backup screen: test card there → 409 AIR_HELD (rule 1)', async () => {
			const { bed } = c
			const m = bed.mark()
			const r = await bed.box('vb-b').node.post('/api/led-test-card/channel', { channel: bed.box('vb-b').ch(BACKUP), enabled: true })
			assert.equal(r.status, 409, JSON.stringify(r.data))
			assert.equal(r.data?.code, 'AIR_HELD')
			await bed.settle()
			assertOnlyWriters(bed, { box: 'vb-b', dest: BACKUP, since: m, allowed: ['vb-a'] }, 'nothing from B itself')
		})

		it('master not answering: a backup take on B plays locally within ~1 s, answered diverged (rule 4)', async () => {
			// A frozen for this one press: its socket still accepts (kernel backlog), the call just gets no answer — the
			// "master does not answer in ~1 s" case. (A forwarder cut no longer works here: the signed hello re-addresses
			// B's link to A's own address around it, WO-1029 P1a.) Well inside the 12 s failover.
			const { bed } = c
			const m = bed.mark()
			bed.box('vb-a').node.freeze()
			let ms
			try {
				const t0 = Date.now()
				const r = await take(bed, 'vb-b', bed.look('backup', 'b'))
				ms = Date.now() - t0
				const shape = JSON.stringify({ status: r.status, ok: r.data?.ok, diverged: r.data?.diverged, viaMaster: r.data?.viaMaster, via: r.data?.via, error: r.data?.error, code: r.data?.code })
				assert.equal(r.status, 200, shape)
				assert.equal(r.data?.diverged, true, shape)
				assert.notEqual(r.data?.viaMaster, true, shape)
				assert.ok(ms < 3000, `answered in ${ms} ms`)
				await bed.waitScreen('vb-b', BACKUP, () => topClip(bed, 'vb-b', BACKUP) === 'LOOK_B', 'local take on B')
				assert.ok(wrote(bed, 'vb-b', BACKUP, m, 'vb-b').length > 0, 'played by B\'s own node')
			} finally {
				bed.box('vb-a').node.thaw()
			}
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: [] }, 'A\'s LED untouched')
			assertOnlyWriters(bed, { box: 'vb-a', dest: BACKUP, since: m, allowed: ['vb-a'] }, 'B\'s diverged take stays on B')
		})
	})
})
