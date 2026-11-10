'use strict'

/**
 * WO-1029 phase 2a — a Godot operator client on another machine drives the boxes (owner 10.11: a client on a remote
 * Mac / Windows machine "should be able to drive both boxes … do virtual tests for the above too"). Virtual box bed
 * (tools/e2e/virtual-boxes.js: real sandbox nodes + fake Caspars with a screen model and a write log), remote client
 * (tools/e2e/remote-client.js: same HTTP + WS API, its own loopback alias, auth ON with the shared password).
 *
 *   one box        auth refusals; connect; take, test card, FTB, raw AMCP, media play land on the box's screens;
 *                  the JPEG video feed upgrade is accepted (a sandbox has no shm ring: frames are not checked)
 *   two boxes      A = LED wall (cabled on A only), B = Stream PGM (on B only), A master.
 *                  client on A: each press lands on the right box and nowhere else;
 *                  client on B: its own Stream PGM runs locally (rule 1), a look on A's LED reaches A via the master
 *                  (rule 4), test card / FTB / raw AMCP on A's LED → 409 REMOTE_SCREEN (rule 5), GET /api/cluster
 *                  destinations (rule 6); master frozen → the LED take has no reachable owner → 409 (rule 4)
 *   three boxes    C master with nothing cabled; C frozen → B's look take on A's LED goes straight to A (rule 4)
 * Contract: scratchpad P2A-CONTRACT.md (WO-1029 phase 2a). Assertions on the new rules fail until the ownership code lands.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startVirtualBoxes, oneBox, twoBoxes, threeBoxes, DEST } = require('../e2e/virtual-boxes')
const { createRemoteClient } = require('../e2e/remote-client')
const { assertOnlyWriters, assertNoStrays, onlyWriters, wrote, topClip } = require('../e2e/virtual-boxes-checks')

const PW = 'virtual-boxes-pw'
const LED = DEST.led.id
const STREAM = DEST.stream.id
const card = (layers) => layers.some((l) => l.cg?.template === 'led_grid_test')

function bedFor(label, spec, setup) {
	const c = {}
	before(async () => {
		c.tmp = fs.mkdtempSync(path.join(os.tmpdir(), `wo1029-vb-${label}-`))
		c.bed = await startVirtualBoxes(c.tmp, { ...spec, password: PW })
		c.clients = []
		c.client = (boxId, alias, password = PW) => {
			const x = createRemoteClient({ url: c.bed.box(boxId).node.url, password, localAddress: alias })
			c.clients.push(x)
			return x
		}
		if (setup) await setup(c.bed, c)
	})
	after(async () => {
		for (const x of c.clients || []) x.close()
		for (const b of c.bed?.boxes.values() || []) b.node.thaw?.()
		if (c.bed) await c.bed.stop()
		if (c.tmp) fs.rmSync(c.tmp, { recursive: true, force: true })
	})
	return c
}

describe('WO-1029 virtual boxes: a remote client', { timeout: 58000, concurrency: true }, () => {
	describe('one box', { concurrency: false }, () => {
		const c = bedFor('one', oneBox())
		let cl
		it('wrong or missing password: state, live socket and video feed refused', async () => {
			const m = c.bed.mark()
			for (const pw of ['', 'not-the-password']) {
				const x = c.client('vb-a', '127.0.3.2', pw)
				const k = await x.connect()
				assert.equal(k.status, 401, `password "${pw}": ${JSON.stringify(k.state)}`)
				assert.equal((await x.takeLook(c.bed.look('led'))).status, 401)
				assert.equal((await x.videoFeed(['pgm1'], 200)).status, 401)
			}
			assertNoStrays(c.bed, m, () => [], 'a refused client wrote nothing')
		})
		it('connects with the password: state + live socket (first push)', async () => {
			cl = c.client('vb-a', '127.0.3.1')
			const k = await cl.connect()
			assert.equal(k.status, 200)
			assert.equal(k.wsStatus, 101)
			assert.ok(k.wsFirst, 'the live socket pushed something')
			const d = await cl.destinations()
			assert.deepEqual(d.list.map((x) => x.id), [LED, STREAM])
			assert.deepEqual((await cl.looks()).list.map((l) => l.id).sort(), ['look_led_a', 'look_led_b', 'look_stream_a', 'look_stream_b'])
		})
		it('take, test card, FTB, raw AMCP, media play land on the box\'s screens', async () => {
			const bed = c.bed
			assert.equal((await cl.takeLook(bed.look('led'))).status, 200)
			await bed.waitScreen('vb-a', LED, () => topClip(bed, 'vb-a', LED) === 'LOOK_A', 'look A')
			assert.equal((await cl.takeLook(bed.look('stream', 'b'))).status, 200)
			await bed.waitScreen('vb-a', STREAM, () => topClip(bed, 'vb-a', STREAM) === 'LOOK_B', 'look B')
			const on = await cl.testCard(LED)
			assert.equal(on.status, 200, JSON.stringify(on.data))
			await bed.waitScreen('vb-a', LED, card, 'test card up')
			assert.equal((await cl.testCard(LED, false)).status, 200)
			await bed.waitScreen('vb-a', LED, (v) => !card(v), 'test card down')
			const f = await cl.ftb(LED)
			assert.equal(f.status, 200, JSON.stringify(f.data))
			await bed.waitScreen('vb-a', LED, (v) => v.length === 0, 'black after FTB')
			assert.equal(topClip(bed, 'vb-a', STREAM), 'LOOK_B', 'FTB on the LED wall left Stream PGM alone')
			const ch = bed.box('vb-a').ch(LED)
			assert.equal((await cl.amcp(`PLAY ${ch}-30 LOOK_C`)).status, 200)
			assert.equal((await cl.play(LED, 'LOOK_B', 20)).status, 200)
			await bed.waitScreen('vb-a', LED, (v) => v.some((l) => l.layer === 30 && l.fg?.source === 'LOOK_C') && v.some((l) => l.layer === 20 && l.fg?.source === 'LOOK_B'), 'raw + media play')
			assertNoStrays(bed, { 'vb-a': 0 }, undefined, 'one box: only its own node writes')
		})
		it('video feed (WO-670 P1): the upgrade is accepted with the password', async () => {
			const v = await cl.videoFeed(['pgm1'], 800)
			assert.equal(v.status, 101)
			assert.equal(v.stayedOpen, true, 'the feed socket stays open after the role request')
			// not checked: pictures — a sandbox has no Caspar shm ring (video-feed.js reads <root>/shm/highascg-<role>)
		})
	})

	describe('two boxes: A (LED wall) master, B (Stream PGM) follower', { concurrency: false }, () => {
		const c = bedFor('two', twoBoxes({ base: 80 }), async (bed) => {
			await bed.linkAll()
			await bed.makeMaster('vb-a')
			await bed.shareShow()
			await bed.waitForwarding('vb-a')
		})
		let onA, onB
		it('both clients connect (one per box, each from its own address)', async () => {
			onA = c.client('vb-a', '127.0.3.11')
			onB = c.client('vb-b', '127.0.3.12')
			for (const x of [onA, onB]) assert.equal((await x.connect()).status, 200)
		})
		it('client on the master: a LED take lands on A only', async () => {
			const { bed } = c
			const m = bed.mark()
			assert.equal((await onA.takeLook(bed.look('led'))).status, 200)
			await bed.waitScreen('vb-a', LED, () => topClip(bed, 'vb-a', LED) === 'LOOK_A', 'LED look on A')
			await bed.settle()
			assert.deepEqual(onlyWriters(bed, { box: 'vb-b', dest: LED, since: m, allowed: [] }).map((e) => e.line), [], 'nothing on B\'s copy of the LED wall')
			assertNoStrays(bed, m)
		})
		it('client on the master: Stream PGM take + test card land on B (forwarded) and nowhere else', async () => {
			const { bed } = c
			const m = bed.mark()
			assert.equal((await onA.takeLook(bed.look('stream'))).status, 200)
			await bed.waitScreen('vb-b', STREAM, () => topClip(bed, 'vb-b', STREAM) === 'LOOK_A', 'stream look on B')
			assert.ok(wrote(bed, 'vb-b', STREAM, m, 'vb-a').length > 0, 'the master\'s node wrote it')
			assert.equal((await onA.testCard(STREAM)).status, 200)
			await bed.waitScreen('vb-b', STREAM, card, 'test card on B')
			assert.equal((await onA.testCard(STREAM, false)).status, 200)
			await bed.waitScreen('vb-b', STREAM, (v) => !card(v), 'test card off on B')
			await bed.settle()
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: [] }, 'the LED wall untouched')
			assertNoStrays(bed, m, (box, dest) => (dest === STREAM ? ['vb-a', 'vb-b'] : [box]))
		})
		it('client on the follower: its own Stream PGM is driven locally while the master forwards to it (rule 1)', async () => {
			const { bed } = c
			const fan = (await onA.cluster()).data?.fanout?.peers?.['vb-b']
			assert.ok((fan?.destinations || []).some((d) => d.id === STREAM), 'precondition: the master forwards Stream PGM to B')
			const m = bed.mark()
			const t = await onB.testCard(STREAM)
			assert.equal(t.status, 200, `test card on B's own screen: ${t.status} ${JSON.stringify(t.data)}`)
			await bed.waitScreen('vb-b', STREAM, card, 'test card by B')
			assert.ok(wrote(bed, 'vb-b', STREAM, m, 'vb-b').some((e) => /^CG /.test(e.line)), 'B\'s own node wrote the card')
			assert.equal((await onB.testCard(STREAM, false)).status, 200)
			const k = await onB.takeLook(bed.look('stream', 'b'))
			assert.equal(k.status, 200, JSON.stringify(k.data))
			assert.notEqual(k.data?.viaMaster, true, 'taken locally, not handed to the master')
			await bed.waitScreen('vb-b', STREAM, () => topClip(bed, 'vb-b', STREAM) === 'LOOK_B', 'B\'s take')
			const ch = bed.box('vb-b').ch(STREAM)
			assert.equal((await onB.amcp(`PLAY ${ch}-30 LOOK_C`)).status, 200, 'raw AMCP on its own screen')
			await bed.waitScreen('vb-b', STREAM, (v) => v.some((l) => l.layer === 30), 'raw AMCP by B')
			await bed.settle()
			assertOnlyWriters(bed, { box: 'vb-b', dest: STREAM, since: m, allowed: ['vb-b'] }, 'only B drove its screen here')
		})
		it('client on the follower: a look on A\'s LED wall reaches A via the master (rule 4)', async () => {
			const { bed } = c
			const m = bed.mark()
			const k = await onB.takeLook(bed.look('led', 'b'))
			assert.equal(k.status, 200, JSON.stringify(k.data))
			await bed.waitScreen('vb-a', LED, () => topClip(bed, 'vb-a', LED) === 'LOOK_B', 'LED look B on A')
			await bed.settle()
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: ['vb-a'] }, 'A played it itself')
		})
		it('client on the follower: test card / FTB / raw AMCP on A\'s LED wall → 409 REMOTE_SCREEN (rule 5)', async () => {
			const { bed } = c
			const m = bed.mark()
			const ch = bed.box('vb-b').ch(LED)
			for (const [what, r] of [['test card', await onB.testCard(LED)], ['FTB', await onB.ftb(LED)], ['raw AMCP', await onB.amcp(`PLAY ${ch}-30 LOOK_C`)]]) {
				assert.equal(r.status, 409, `${what}: ${r.status} ${JSON.stringify(r.data)}`)
				assert.equal(r.data?.code, 'REMOTE_SCREEN', what)
				assert.ok((r.data?.owners || []).includes('vb-a'), `${what}: owners ${JSON.stringify(r.data?.owners)}`)
			}
			await bed.settle()
			assert.deepEqual(onlyWriters(bed, { box: 'vb-b', dest: LED, since: m, allowed: [] }).map((e) => e.line), [], 'not run on B\'s copy channel either')
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: [] }, 'A\'s LED untouched')
		})
		it('GET /api/cluster: destinations with owners and kind (rule 6)', async () => {
			const d = (await onB.cluster()).data?.destinations || []
			const led = d.find((x) => x.id === LED)
			const st = d.find((x) => x.id === STREAM)
			assert.ok(led && st, JSON.stringify(d))
			assert.deepEqual([led.kind, led.here, led.owners], ['remote', false, ['vb-a']])
			assert.deepEqual([st.kind, st.here, st.owners.includes('vb-b')], ['own', true, true])
		})
		it('master frozen: a look on A\'s LED wall has no reachable master or owner → 409, nothing played (rule 4)', async (t) => {
			const { bed } = c
			const m = bed.mark()
			bed.box('vb-a').node.freeze()
			try {
				const t0 = Date.now()
				const slow = createRemoteClient({ url: bed.box('vb-b').node.url, password: PW, localAddress: '127.0.3.13', timeoutMs: 20000 })
				const k = await slow.takeLook(bed.look('led'))
				const ms = Date.now() - t0
				t.diagnostic(`answered ${k.status} in ${ms} ms: ${JSON.stringify(k.data)?.slice(0, 200)}`)
				slow.close()
				assert.equal(k.status, 409, `after ${ms} ms: ${k.status} ${JSON.stringify(k.data)}`)
				assert.ok(ms < 11000, `answered in ${ms} ms: before a failover (12 s) could make B the master`)
				assert.ok(String(k.data?.error || '').length > 0, 'a clear error')
			} finally {
				bed.box('vb-a').node.thaw()
			}
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: [] }, 'nothing reached A\'s LED')
			assert.deepEqual(onlyWriters(bed, { box: 'vb-b', dest: LED, since: m, allowed: [] }).map((e) => e.line), [], 'not played on B\'s copy')
		})
	})

	describe('three boxes: C master (nothing cabled), A = LED, B = Stream PGM', { concurrency: false }, () => {
		const c = bedFor('three', threeBoxes({ base: 90 }), async (bed) => {
			await bed.linkAll()
			await bed.makeMaster('vb-c')
			await bed.shareShow()
			await bed.waitForwarding('vb-c')
		})
		it('C frozen: a look on A\'s LED pressed on B goes straight to its owner A (rule 4)', async () => {
			const { bed } = c
			const onB = c.client('vb-b', '127.0.3.21')
			assert.equal((await onB.connect()).status, 200)
			const m = bed.mark()
			bed.box('vb-c').node.freeze()
			try {
				const k = await onB.takeLook(bed.look('led', 'b'))
				assert.equal(k.status, 200, JSON.stringify(k.data))
				await bed.waitScreen('vb-a', LED, () => topClip(bed, 'vb-a', LED) === 'LOOK_B', 'LED look on A')
			} finally {
				bed.box('vb-c').node.thaw()
			}
			assertOnlyWriters(bed, { box: 'vb-a', dest: LED, since: m, allowed: ['vb-a'] }, 'A took it locally (no re-relay, not via C)')
		})
	})
})
