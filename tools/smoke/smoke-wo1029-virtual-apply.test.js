'use strict'

/**
 * WO-1029 apply — "Apply across linked servers with the air state kept" on the virtual box bed (tools/e2e/virtual-boxes.js;
 * contract: scratchpad APPLY-CONTRACT.md, shapes: APPLY-SHAPES.md). Every assertion is on a fake Caspar: its restart
 * markers (fake-caspar.js `restart`, called by the node through the sandbox hook in src/utils/caspar-restart.js), its
 * playback model (a clip's position advances with the clock, `SEEK n` = seconds x channel fps) and its write log.
 *
 *   one box    a look on PGM, another on PRV, a clip playing / paused / looping on hand-played layers, the test card ->
 *              Apply -> ONE restart, afterwards the same things on the same destinations at the right positions, `restored`
 *              matches; nothing refused after the restart; a snapshot that cannot be taken still lets the apply happen and
 *              is reported; nothing dirty -> nothing restarted; channel numbers change -> content follows its destination
 *   two boxes  only B dirty (changed on B through A's relay) -> only B's Caspar restarts (A: no restart, no dropped
 *              connection, untouched write log); only A dirty -> only A; both -> B (linked) first, A (master) last; none
 *              dirty -> nothing; no stray master writes on a follower's own screens; a backup destination gets the master's
 *              content back; B offline -> `skipped: offline`, A still applied
 * Position tolerance: POS_TOL_S seconds (the restore costs a few hundred ms and the snapshot is taken a little before the
 * restart; frame = 20 ms at 50 fps). Assertions on the engine's code fail until it lands.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startVirtualBoxes, oneBox, twoBoxes, DEST } = require('../e2e/virtual-boxes')
const { waitFor } = require('../e2e/cluster-nodes')
const { assertNoStrays, assertOneCopy } = require('../e2e/virtual-boxes-checks')
const { seedTwoLayerLooks, bankScenario } = require('../e2e/virtual-boxes-banks')

const LED = DEST.led.id
const STREAM = DEST.stream.id
const BACKUP = DEST.backup.id
const POS_TOL_S = 1.5
const LOOP_LEN_S = 20
const FAKE = { lengths: { LOOK_C: LOOP_LEN_S }, downMs: 250 }
const take = (bed, id, look, target = 'program') => bed.box(id).node.post('/api/scene/take-look', { sceneId: look, target, forceCut: true })
const raw = (bed, id, cmd) => bed.box(id).node.post('/api/amcp/raw', { cmd })

function bedFor(label, spec, setup) {
	const c = {}
	before(async () => {
		c.tmp = fs.mkdtempSync(path.join(os.tmpdir(), `wo1029-apply-${label}-`))
		c.bed = await startVirtualBoxes(c.tmp, { ...spec, fake: FAKE })
		await setup(c.bed, c)
	})
	after(async () => {
		for (const b of c.bed?.boxes.values() || []) b.node.thaw?.()
		if (c.bed) await c.bed.stop()
		if (c.tmp) fs.rmSync(c.tmp, { recursive: true, force: true })
	})
	return c
}

/** Look layers (banks A 10-99, B 110-199) of one screen: { layer: clip }. Hand layers are 200+, the test card 999. */
const lookClips = (layers) => Object.fromEntries(layers.filter((l) => (l.layer >= 10 && l.layer <= 99) || (l.layer >= 110 && l.layer <= 199)).map((l) => [l.layer % 100, l.source]))
const byLayer = (layers) => Object.fromEntries(layers.map((l) => [l.layer, l]))
const modDist = (a, b, len) => Math.min(Math.abs(a - b) % len, len - (Math.abs(a - b) % len))

/** Make `id` dirty (a destination's video mode that carries no content here is flipped); `via` = another box's relay. */
async function dirtify(bed, id, via) {
	await bed.touch(id, { via })
	await waitFor(`${id} reports dirty`, async () => (await bed.dirtyOf(id)).data?.dirty === true, 8000, 150)
}

/** The same content on every box at once is not needed: one hand-played set on `id`'s LED (or stream) PGM. */
async function putAir(bed, id, destId, { card = false } = {}) {
	const b = bed.box(id)
	const pgm = b.ch(destId)
	const lookA = destId === LED ? 'led' : 'stream'
	assert.equal((await take(bed, id, bed.look(lookA, 'a'))).status, 200)
	if (destId === LED) assert.equal((await take(bed, id, bed.look('led', 'b'), 'preview')).status, 200)
	assert.equal((await b.node.post('/api/play', { channel: pgm, layer: 200, clip: 'E2E_BARS' })).status, 200)
	const fps = b.caspar.fps(pgm)
	assert.equal((await raw(bed, id, `CALL ${pgm}-200 SEEK ${Math.round(30 * fps)}`)).status, 200)
	assert.equal((await raw(bed, id, `PLAY ${pgm}-201 E2E_STILL`)).status, 200)
	assert.equal((await raw(bed, id, `CALL ${pgm}-201 SEEK ${Math.round(7 * fps)}`)).status, 200)
	assert.equal((await raw(bed, id, `PAUSE ${pgm}-201`)).status, 200)
	assert.equal((await raw(bed, id, `PLAY ${pgm}-202 LOOK_C LOOP`)).status, 200)
	assert.equal((await raw(bed, id, `CALL ${pgm}-202 SEEK ${Math.round(18 * fps)}`)).status, 200)
	if (card) assert.equal((await b.node.post('/api/led-test-card/channel', { channel: pgm, enabled: true })).status, 200)
	await bed.waitScreen(id, destId, (v) => v.some((l) => l.layer === 200) && v.some((l) => l.layer === 202) && (!card || v.some((l) => l.layer === 999)), 'hand-played layers up', 8000)
}

/** What the screens of `id` show now, with the wall clock, for comparing before / after. */
function snap(bed, id, destId) {
	const s = bed.screens(id)[destId]
	return { t: Date.now(), pgm: s.pgm, prv: s.prv }
}

describe('WO-1029 virtual boxes: apply with the air state kept', { timeout: 58000, concurrency: true }, () => {
	describe('the fake Caspar itself: playback model, restart, consumers', () => {
		it('plays, pauses, seeks (channel frames), loops, restarts empty and keeps its log', async () => {
			const { startFakeCaspar } = require('../e2e/fake-caspar')
			const net = require('node:net')
			let t = 1000000
			const fake = await startFakeCaspar({ host: '127.0.2.199', channels: ['1080p5000', '720p2500'], now: () => t, lengths: { LOOK_C: 20 }, downMs: 80 })
			const sock = net.connect(fake.port, fake.host)
			let buf = ''
			sock.on('data', (d) => (buf += d))
			const send = async (line) => {
				buf = ''
				sock.write(line + '\r\n')
				await waitFor(line, () => /\r\n/.test(buf), 3000, 10)
				await new Promise((r) => setTimeout(r, 20))
				return buf
			}
			try {
				await send('PLAY 1-10 E2E_BARS SEEK 1500') // 50 fps: 30 s
				await send('PLAY 2-10 E2E_BARS SEEK 250') // 25 fps: 10 s
				assert.equal(fake.position(1, 10), 30)
				assert.equal(fake.position(2, 10), 10)
				t += 4000
				assert.equal(fake.position(1, 10), 34)
				await send('PAUSE 1-10')
				t += 4000
				assert.equal(fake.position(1, 10), 34)
				assert.equal(fake.clip(1, 10).paused, true)
				await send('CALL 1-10 SEEK 50') // one second in channel frames
				assert.equal(fake.position(1, 10), 1)
				await send('RESUME 1-10')
				t += 1000
				assert.equal(fake.position(1, 10), 2)
				await send('PLAY 1-11 LOOK_C LOOP SEEK 900') // 18 s of a 20 s clip
				t += 5000
				assert.equal(fake.position(1, 11), 3, 'wraps modulo its length')
				const info = await send('INFO 1')
				assert.match(info, /<layer_10>.*<time>7\.000<\/time><time>600\.000<\/time>.*<paused>false<\/paused>/s)
				assert.match(info, /<layer_11>.*<loop>true<\/loop>/s)
				// the node's own INFO parser reads what the fake says
				const parsed = await new Promise((res, rej) => require('xml2js').parseString(info.split('\r\n').slice(1).join(''), { explicitArray: false }, (e, r) => (e ? rej(e) : res(r))))
				const L = require('../../src/state/info-channel-parse').extractChannelInfoFromParsed(parsed).layers
				assert.equal(L[10].fgClip, 'E2E_BARS')
				assert.equal(Number(L[10].timeSec), 7)
				assert.equal(L[10].fgState, 'playing')
				await send('ADD 1-700 STREAM udp://127.0.0.1:9 -f mpegts')
				assert.deepEqual(fake.consumers(1).map((x) => [x.index, x.name]), [[700, 'ffmpeg[udp://127.0.0.1:9]']])
				assert.match(await send('INFO 1'), /<port_700><consumer>ffmpeg\[udp:\/\/127\.0\.0\.1:9\]<\/consumer>/)
				await send('REMOVE 1-700')
				assert.equal(fake.consumers(1).length, 0)
				const m = fake.mark()
				const down = new Promise((r) => sock.once('close', r))
				await fake.restart({ channels: ['1080p5000'] })
				await down
				assert.equal(fake.position(1, 10), null, 'a restarted Caspar is empty')
				assert.equal(fake.channelCount(), 1)
				assert.equal(fake.restarts(m).length, 1)
				assert.ok(fake.writes().some((e) => e.restart && e.seq > m), 'the write log keeps a restart marker')
				assert.ok(fake.writes().some((e) => /E2E_BARS/.test(e.line)), 'and what was written before')
				const again = net.connect(fake.port, fake.host)
				await new Promise((r, j) => again.once('connect', r).once('error', j))
				again.destroy()
				fake.set({ refuseInfo: true })
			} finally {
				sock.destroy()
				await fake.close()
			}
		})
	})

	describe('one box: LED wall + stream + a spare destination', { concurrency: false }, () => {
		const c = bedFor('one', oneBox({ base: 160, spare: true }), async (bed, c) => {
			c.base = await bed.baseline()
		})

		it('Apply restarts the fake Caspar once and puts every thing back where it was', async () => {
			const { bed } = c
			const a = bed.box('vb-a')
			await putAir(bed, 'vb-a', LED, { card: true })
			await putAir(bed, 'vb-a', STREAM)
			await dirtify(bed, 'vb-a')
			await bed.settle()
			const before = snap(bed, 'vb-a', LED)
			const streamBefore = snap(bed, 'vb-a', STREAM)
			const m = bed.mark()
			const pgm = a.ch(LED)
			const r = await bed.apply('vb-a')
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 400))
			const row = r.data.results.find((x) => x.self)
			assert.ok(row?.applied && row.ok, `applied: ${JSON.stringify(row)?.slice(0, 400)}`)
			assert.equal(bed.restartsOf('vb-a', m).length, 1, 'the fake Caspar restarted exactly once')
			assert.equal(a.caspar.dropped() > 0, true, 'the node saw a real disconnect')

			// afterwards: the same things on the same destinations (channels unchanged in this scenario)
			await bed.refreshChannels('vb-a')
			assert.equal(a.ch(LED), pgm)
			const after = await bed.waitRestored('vb-a', (s) => {
				const L = byLayer(s[LED].pgm)
				return L[200] && L[201] && L[202] && L[999] && L[200].playing && s[LED].prv.length > 0 && s[STREAM].pgm.length >= 4 && s
			}, 'LED look, hand-played clips, card and stream are back', 20000)
			const L = byLayer(after[LED].pgm)
			const elapsed = (Date.now() - before.t) / 1000
			assert.deepEqual(lookClips(after[LED].pgm), lookClips(before.pgm), 'LED PGM look is the same')
			assert.deepEqual(lookClips(after[LED].prv), lookClips(before.prv), 'LED PRV look (staged, not on air) is the same')
			assert.deepEqual(lookClips(after[STREAM].pgm), lookClips(streamBefore.pgm), 'stream look is the same')
			assert.equal(L[200].source, 'E2E_BARS')
			const wantPlay = byLayer(before.pgm)[200].position + (Date.now() - before.t) / 1000
			assert.ok(Math.abs(L[200].position - wantPlay) <= POS_TOL_S, `playing clip at ${L[200].position.toFixed(2)} s, wanted ~${wantPlay.toFixed(2)} (+-${POS_TOL_S})`)
			assert.equal(L[201].playing, false, 'the paused clip is still paused')
			assert.ok(Math.abs(L[201].position - 7) <= 0.1, `paused clip held at its frame (${L[201].position})`)
			assert.equal(L[202].playing, true)
			assert.equal(L[202].loop, true)
			const wantLoop = (byLayer(before.pgm)[202].position + elapsed) % LOOP_LEN_S
			assert.ok(modDist(L[202].position, wantLoop, LOOP_LEN_S) <= POS_TOL_S, `looping clip at ${L[202].position.toFixed(2)} s, wanted ~${wantLoop.toFixed(2)} modulo ${LOOP_LEN_S}`)
			assert.ok(L[999], 'the test card is back on 999')
			assertOneCopy(a, pgm, 'LOOK_A') // a look comes back once (WO-1029: the re-take must not add a copy on the other bank)
			assertOneCopy(a, a.ch(STREAM), 'LOOK_A')

			// the answer says what it did
			const rs = row.restored
			assert.ok(rs && typeof rs === 'object', `restored block: ${JSON.stringify(row)?.slice(0, 300)}`)
			const clips = (rs.clips || []).filter((x) => x.channel === pgm)
			for (const l of [200, 201, 202]) assert.ok(clips.some((x) => x.layer === l), `restored.clips names layer ${l}: ${JSON.stringify(clips)}`)
			assert.equal(clips.find((x) => x.layer === 201)?.paused, true)
			assert.ok(rs.card, 'restored.card')
			assert.equal(typeof rs.ms, 'number')

			// nothing the node wrote after the restart was refused: the channels existed when it wrote
			assert.deepEqual(a.caspar.rejected(m['vb-a']).map((e) => e.line), [], 'no write refused after the restart')
			const marker = bed.restartsOf('vb-a', m)[0]
			assert.ok(a.caspar.since(marker.seq).every((e) => e.seq > marker.seq && !(e.channel > a.caspar.channelCount())))
		})

		it('nothing dirty: Apply restarts nothing and says so', async () => {
			const { bed } = c
			await waitFor('vb-a clean', async () => (await bed.dirtyOf('vb-a')).data?.dirty === false, 8000, 150)
			const m = bed.mark()
			const r = await bed.apply('vb-a')
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 300))
			assert.ok(r.data.results.length >= 1)
			for (const x of r.data.results) {
				assert.equal(x.applied, false)
				assert.equal(x.skipped, 'clean')
			}
			assert.equal(bed.restartsOf('vb-a', m).length, 0)
		})

		it('a snapshot that cannot be taken: the apply still happens and reports it', async () => {
			const { bed } = c
			const a = bed.box('vb-a')
			await dirtify(bed, 'vb-a')
			const m = bed.mark()
			a.caspar.set({ refuseInfo: true })
			let r
			try {
				r = await bed.apply('vb-a')
			} finally {
				a.caspar.set({ refuseInfo: false })
			}
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 300))
			const row = r.data.results.find((x) => x.self)
			assert.ok(row.applied && row.ok, `the apply happened: ${JSON.stringify(row)?.slice(0, 300)}`)
			assert.equal(bed.restartsOf('vb-a', m).length, 1)
			assert.match(String(row.restored_reason || row.error || row.message || ''), /snapshot/i, `reported: ${JSON.stringify(row)?.slice(0, 1800)}`)
			await bed.waitConnected('vb-a')
		})

		it('channel numbers change across the restart: content follows its destination', async () => {
			const { bed } = c
			const a = bed.box('vb-a')
			await bed.refreshChannels('vb-a')
			await putAir(bed, 'vb-a', STREAM)
			const was = a.ch(STREAM)
			const hadLed = bed.screens('vb-a')[LED].pgm.length > 0
			const m = bed.mark()
			// the LED wall is deleted on this box: the stream destination moves up to channels 1 / 2
			const rm = await a.node.post('/api/device-view', { removeDestination: { id: LED } })
			assert.ok(rm.status === 200 && rm.data?.ok !== false, JSON.stringify(rm.data)?.slice(0, 200))
			a.cabled.delete(LED)
			await waitFor('vb-a reports dirty', async () => (await bed.dirtyOf('vb-a')).data?.dirty === true, 8000, 150)
			const r = await bed.apply('vb-a')
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 300))
			const row = r.data.results.find((x) => x.self)
			assert.ok(row.applied && row.ok, JSON.stringify(row)?.slice(0, 300))
			await bed.refreshChannels('vb-a')
			const now = a.ch(STREAM)
			assert.notEqual(now, was, `the stream destination was renumbered (${was} -> ${now})`)
			const s = await bed.waitRestored('vb-a', (sc) => {
				const L = byLayer(sc[STREAM].pgm)
				return L[200] && L[202] && sc
			}, 'stream content on its new channel', 20000)
			assert.equal(lookClips(s[STREAM].pgm)[10], 'LOOK_A')
			assert.equal(byLayer(s[STREAM].pgm)[201].playing, false)
			// the old number now belongs to the backup destination: the stream's content must not be there
			const bk = Object.fromEntries(a.caspar.visible(a.ch(BACKUP)).map((l) => [l.layer, l]))
			assert.ok(!bk[200] && !bk[202], 'the stream content is not on the old channel number (now the backup destination)')
			if (hadLed) assert.ok((row.restored?.skipped || []).length >= 1, 'content of the removed destination is dropped and reported')
			assert.deepEqual(a.caspar.rejected(bed.restartsOf('vb-a', m)[0].seq).map((e) => e.line), [])
		})
	})

	describe('one box: a program look on bank B / bank A comes back once, on its own bank', { concurrency: false }, () => {
		const c = bedFor('banks', oneBox({ base: 190, spare: true }), async (bed, c) => {
			c.base = await bed.baseline()
			await seedTwoLayerLooks(bed) // two-layer looks look_led_2a / 2b beside the seeded ones
		})
		const ctx = { LED, take, raw, dirtify, POS_TOL_S }
		const scenario = (...args) => bankScenario(c.bed, ctx, ...args)
		const one = (v) => `look_led_${v}`
		const two = (v) => `look_led_2${v}`
		it('one-layer look on bank B (three takes, previous look still on bank A) comes back once', async () => {
			await scenario([one('a'), one('b'), one('a')], { 10: 'LOOK_A' }, 'LOOK_B', 'b')
		})
		it('one-layer look on bank A (two takes) comes back once, the leftover sits on bank B', async () => {
			await scenario([one('a'), one('b')], { 10: 'LOOK_B' }, 'LOOK_A', 'a')
		})
		it('two-layer look on bank B comes back once per clip, on bank B', async () => {
			await scenario([two('a'), two('b'), two('a')], { 10: 'LOOK_A', 11: 'LOOK_C' }, 'LOOK_B', 'b')
		})
	})

	describe('two boxes: A (LED wall, master) and B (Stream PGM), a backup destination on both', { concurrency: false }, () => {
		const c = bedFor('two', twoBoxes({ base: 170, backup: true }), async (bed) => {
			await bed.baseline()
			await bed.linkAll()
			await bed.makeMaster('vb-a')
			await bed.shareShow()
			await bed.waitForwarding('vb-a')
			assert.equal((await take(bed, 'vb-a', bed.look('led', 'a'))).status, 200)
			assert.equal((await take(bed, 'vb-b', bed.look('stream', 'a'))).status, 200)
			assert.equal((await take(bed, 'vb-a', bed.look('backup', 'a'))).status, 200)
			await bed.waitScreen('vb-b', BACKUP, (v) => v.length > 0, 'backup content reached B (master fan-out)')
			await bed.settle()
		})

		const plan = async (id) => (await c.bed.planOf(id)).data

		it('only B is dirty (changed on B through A\'s relay): Apply on A restarts ONLY B', async () => {
			const { bed } = c
			await dirtify(bed, 'vb-b', 'vb-a')
			await waitFor('A\'s plan: B dirty, A clean', async () => {
				const p = await plan('vb-a')
				const rows = Object.fromEntries((p?.servers || []).map((x) => [x.id, x]))
				return rows['vb-b']?.dirty === true && rows['vb-a']?.dirty === false && rows
			}, 10000, 200)
			const m = bed.mark()
			const aDropped = bed.box('vb-a').caspar.dropped()
			const streamBefore = bed.screens('vb-b')[STREAM].pgm
			const r = await bed.apply('vb-a')
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 400))
			const rows = Object.fromEntries(r.data.results.map((x) => [x.id, x]))
			assert.ok(rows['vb-b']?.applied && rows['vb-b'].ok, JSON.stringify(rows['vb-b'])?.slice(0, 300))
			assert.equal(rows['vb-a']?.applied, false)
			assert.equal(rows['vb-a']?.skipped, 'clean')
			assert.equal(bed.restartsOf('vb-b', m).length, 1, 'B restarted once')
			// A is untouched: no restart, no dropped connection, nothing written to its Caspar
			assert.equal(bed.restartsOf('vb-a', m).length, 0, 'A\'s Caspar was NOT restarted')
			assert.equal(bed.box('vb-a').caspar.dropped(), aDropped, 'A\'s node kept its connection')
			assert.deepEqual(bed.box('vb-a').caspar.since(m['vb-a']).map((e) => e.line), [], 'A\'s write log is untouched')
			// B's own content is back on B
			await bed.refreshChannels('vb-b')
			const back = await bed.waitRestored('vb-b', (s) => s[STREAM].pgm.length >= streamBefore.length && s, 'B stream content restored', 20000)
			assert.deepEqual(lookClips(back[STREAM].pgm), lookClips(streamBefore), 'B stream look restored')
			assert.ok(rows['vb-b'].restored, 'B\'s restore is in the answer')
			// no stray master writes on the follower's OWN screens after its restart; the backup destination is shared
			await bed.settle()
			assertNoStrays(bed, m, (box, dest) => (dest === BACKUP ? ['vb-a', 'vb-b'] : [box]), 'after B\'s restart')
			await bed.waitScreen('vb-b', BACKUP, (v) => v.length > 0, 'the backup destination got the master\'s content back')
		})

		it('only A is dirty: only A restarts, B is untouched', async () => {
			const { bed } = c
			await dirtify(bed, 'vb-a')
			const m = bed.mark()
			const bDropped = bed.box('vb-b').caspar.dropped()
			const r = await bed.apply('vb-a')
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 400))
			const rows = Object.fromEntries(r.data.results.map((x) => [x.id, x]))
			assert.ok(rows['vb-a']?.applied && rows['vb-a'].ok, JSON.stringify(rows['vb-a'])?.slice(0, 300))
			assert.equal(rows['vb-b']?.skipped, 'clean')
			assert.equal(bed.restartsOf('vb-a', m).length, 1)
			assert.equal(bed.restartsOf('vb-b', m).length, 0, 'B\'s Caspar was NOT restarted')
			assert.equal(bed.box('vb-b').caspar.dropped(), bDropped)
			await bed.refreshChannels('vb-a')
			await bed.waitRestored('vb-a', (s) => s[LED].pgm.length > 0 && s, 'A LED look restored', 20000)
			await bed.settle()
			assert.deepEqual(bed.box('vb-b').caspar.since(m['vb-b']).filter((e) => e.channel !== bed.box('vb-b').ch(BACKUP) && e.channel !== bed.box('vb-b').ch(BACKUP, 'prv')).map((e) => e.line), [], 'nothing written to B\'s own screens')
			assertNoStrays(bed, m, (box, dest) => (dest === BACKUP ? ['vb-a', 'vb-b'] : [box]), 'after A\'s restart')
		})

		it('both dirty: B (linked) first, A (master) last', async () => {
			const { bed } = c
			await dirtify(bed, 'vb-b', 'vb-a')
			await dirtify(bed, 'vb-a')
			const m = bed.mark()
			const r = await bed.apply('vb-a')
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 400))
			assert.deepEqual(r.data.results.map((x) => x.id), ['vb-b', 'vb-a'], 'answer lists B first')
			assert.ok(r.data.results.every((x) => x.applied && x.ok), JSON.stringify(r.data.results)?.slice(0, 400))
			const order = bed.restartOrder(m).map((x) => x.box)
			assert.deepEqual(order, ['vb-b', 'vb-a'], 'restart markers: B, then A')
		})

		it('the client path: wait:false answers 202, WS cluster:apply events and GET /apply/status follow it', async () => {
			const { bed } = c
			const { createRemoteClient } = require('../e2e/remote-client')
			const client = createRemoteClient({ url: bed.box('vb-a').node.url, localAddress: '127.0.3.9' })
			const events = []
			try {
				assert.equal((await client.connect()).wsStatus, 101)
				client.ws.on('message', (m) => {
					const text = String(m)
					if (!text.includes('cluster:apply')) return
					try {
						events.push(JSON.parse(text))
					} catch {
						/* not JSON */
					}
				})
				await dirtify(bed, 'vb-b', 'vb-a')
				const m = bed.mark()
				const r = await bed.apply('vb-a', { wait: false })
				assert.equal(r.status, 202, JSON.stringify(r.data)?.slice(0, 300))
				assert.ok(r.data.accepted && r.data.run_id)
				const runId = r.data.run_id
				const st = await waitFor('status shows the run done', async () => {
					const x = (await bed.box('vb-a').node.get('/api/cluster/apply/status')).data
					return x?.run?.run_id === runId && x.run.finished_at && x
				}, 40000, 200)
				assert.equal(st.value.running, false)
				const row = st.value.run.results.find((x) => x.id === 'vb-b')
				assert.ok(row?.applied && row.ok, JSON.stringify(st.value.run.results)?.slice(0, 300))
				assert.equal(bed.restartsOf('vb-b', m).length, 1)
				assert.equal(bed.restartsOf('vb-a', m).length, 0)
				await waitFor('the WS told the client the run is done', async () => events.some((e) => JSON.stringify(e).includes('"done"')), 5000, 100)
				const text = JSON.stringify(events)
				for (const phase of ['start', 'server', 'done']) assert.ok(text.includes(`"phase":"${phase}"`), `WS cluster:apply phase ${phase}: ${text.slice(0, 400)}`)
			} finally {
				client.close()
			}
		})

		it('nothing dirty: Apply restarts nothing on either box', async () => {
			const { bed } = c
			await waitFor('both clean', async () => (await bed.dirtyOf('vb-a')).data?.dirty === false && (await bed.dirtyOf('vb-b')).data?.dirty === false, 10000, 200)
			const m = bed.mark()
			const r = await bed.apply('vb-a')
			assert.equal(r.status, 200)
			assert.ok(r.data.results.every((x) => x.applied === false && x.skipped === 'clean'), JSON.stringify(r.data.results)?.slice(0, 300))
			assert.equal(bed.restartOrder(m).length, 0)
		})
	})

	describe('two boxes: B offline', { concurrency: false }, () => {
		const c = bedFor('offline', twoBoxes({ base: 180, backup: true }), async (bed) => {
			await bed.baseline()
			await bed.linkAll()
			await bed.makeMaster('vb-a')
			await bed.shareShow()
			await bed.waitForwarding('vb-a')
		})

		it('B frozen: reported skipped offline, A is still applied', async () => {
			const { bed } = c
			await dirtify(bed, 'vb-a')
			const m = bed.mark()
			bed.box('vb-b').node.freeze()
			await waitFor('A sees B offline', async () => {
				const p = (await bed.planOf('vb-a')).data
				return p?.servers?.find((x) => x.id === 'vb-b')?.online === false
			}, 30000, 500)
			const r = await bed.apply('vb-a')
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 400))
			const rows = Object.fromEntries(r.data.results.map((x) => [x.id, x]))
			assert.equal(rows['vb-b']?.applied, false)
			assert.equal(rows['vb-b']?.skipped, 'offline')
			assert.ok(rows['vb-a']?.applied && rows['vb-a'].ok, JSON.stringify(rows['vb-a'])?.slice(0, 300))
			assert.equal(bed.restartsOf('vb-a', m).length, 1)
			assert.equal(bed.restartsOf('vb-b', m).length, 0)
		})
	})
})
