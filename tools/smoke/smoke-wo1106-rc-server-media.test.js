'use strict'

/**
 * WO-1106 — RC game server, the heavy parts:
 *   B38  rc-video.js: `{ t: 'video' }` acts on a change only, and the feed client + lease outlive the last subscriber
 *        5 s, so on / off flapping never restarts the wall-picture worker / ffmpeg; the host switch and stop are at once
 *   B40  rc-scene.js baker: edits during a bake cost one more bake, not one per rev seen
 *   B52  rc-scene.js baker: drop() forgets the last bake (also one that finishes after the drop)
 *   B51  rc-fresh-import.js: the bot brain's folder is import()ed under a version, its relative imports too
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createRcVideo, LEASE_ID } = require('../../modules/rc-game/server/rc-video')
const { createSceneBaker } = require('../../modules/rc-game/server/rc-scene')
const { freshImport, folderVersion, passVersion } = require('../../modules/rc-game/server/rc-fresh-import')

function videoBed() {
	const feed = { added: 0, closed: 0, asked: 0, client: null }
	feed.addClient = (c) => {
		feed.added++
		feed.client = c
		c.on('message', () => feed.asked++)
		c.on('close', () => feed.closed++)
	}
	const leases = []
	const timeouts = []
	const video = createRcVideo({
		feed: () => feed,
		lease: (id, roles) => leases.push([id, roles]),
		roles: () => ['pgm1'],
		setInterval: () => ({}),
		clearInterval: () => {},
		setTimeout: (fn, ms) => (timeouts.push({ fn, ms }), timeouts.length),
		clearTimeout: (id) => (timeouts[id - 1] = null),
	})
	const fire = () => {
		const live = timeouts.filter(Boolean)
		timeouts.length = 0
		for (const x of live) x.fn()
		return live.map((x) => x.ms)
	}
	return { feed, leases, video, fire, pending: () => timeouts.filter(Boolean).length }
}

test('B38: one socket flapping video on / off 40× → one feed client, never closed, the lease never released', () => {
	const b = videoBed()
	const A = { readyState: 1 }
	b.video.subscribe(A, true)
	assert.equal(b.feed.added, 1)
	const asked = b.feed.asked
	for (let i = 0; i < 40; i++) {
		b.video.subscribe(A, false)
		b.video.subscribe(A, true)
	}
	for (let i = 0; i < 10; i++) b.video.subscribe(A, true) // repeats of the same wish change nothing
	assert.equal(b.feed.added, 1, 'no new feed client')
	assert.equal(b.feed.closed, 0, 'the worker is never stopped')
	assert.equal(b.feed.asked, asked, 'the feed is not re-asked')
	assert.ok(b.leases.every(([, r]) => r.length), 'the lease is never released')
	assert.equal(b.pending(), 0, 'a subscriber again: the pending close is cancelled')
	assert.equal(b.video.subscribers(), 1)
})

test('B38: last subscriber gone → closed 5 s later (not at once); the host switch and stop() close at once', () => {
	const b = videoBed()
	const A = { readyState: 1 }
	b.video.subscribe(A, true)
	b.video.detach(A)
	assert.equal(b.feed.closed, 0, 'still open right after the last subscriber left')
	assert.deepEqual(b.fire(), [5000])
	assert.equal(b.feed.closed, 1)
	assert.deepEqual(b.leases.at(-1), [LEASE_ID, []])
	b.video.subscribe(A, true)
	assert.equal(b.feed.added, 2)
	b.video.setOn(false)
	assert.equal(b.feed.closed, 2, 'walls off: at once')
	assert.deepEqual(b.leases.at(-1), [LEASE_ID, []])
	b.video.setOn(true)
	assert.equal(b.feed.added, 3)
	b.video.subscribe(A, false)
	b.video.stop()
	assert.equal(b.feed.closed, 3, 'stop (disable) closes at once, lingering or not')
	assert.equal(b.pending(), 0)
})

const emptyStore = { get: () => null, mesh: async () => null, fileOf: () => null }
const stage = (k) => ({ name: 'P', previs: { tracking: { grid: { width: 10, depth: 8, z_offset: k } } } })

test('B40: four edits while a bake runs → two bakes (the first and the current), every waiter gets a scene', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-b40-'))
	try {
		let k = 1
		let t = 1e6
		const baked = []
		const b = createSceneBaker({ loadProject: () => stage(k), mvrStore: emptyStore, cacheDir: dir, scale: 1, now: () => t,
			log: (lvl, m) => /baked in/.test(m) && baked.push(m.split(' ')[2]) })
		const r1 = b.rev()
		const p1 = b.get()
		await new Promise((r) => setImmediate(r))
		const ps = []
		for (k = 2; k <= 4; k++) {
			t += 3000 // past the rev memo
			ps.push(b.get())
		}
		const r4 = b.rev()
		const [o1, ...rest] = await Promise.all([p1, ...ps])
		assert.equal(o1.rev, r1)
		assert.deepEqual(rest.map((o) => o.rev), [r4, r4, r4], 'the stale waiters get the current scene')
		assert.deepEqual(baked, [r1, r4], 'two bakes, not four')
		assert.equal(b.peek().rev, r4)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('B52: drop() forgets the last bake, and a bake that ends after the drop is not kept', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-b52-'))
	try {
		const b = createSceneBaker({ loadProject: () => stage(1), mvrStore: emptyStore, cacheDir: dir, scale: 1 })
		await b.get()
		assert.ok(b.peek())
		b.drop()
		assert.equal(b.peek(), null)
		const p = b.get()
		b.drop()
		const out = await p
		assert.ok(out.json, 'the waiter still gets its scene')
		assert.equal(b.peek(), null, 'not kept after the drop')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('B51: an edited client file reaches the next import, also through a relative import', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-b51-'))
	try {
		fs.writeFileSync(path.join(dir, 'brain.js'), "import { v } from './phys.js'\nexport const val = v\n")
		fs.writeFileSync(path.join(dir, 'phys.js'), 'export const v = 1\n')
		const v1 = folderVersion(dir)
		const [a1, p1] = await freshImport(dir, ['brain.js', 'phys.js'])
		assert.equal(a1.val, 1)
		assert.equal(p1.v, 1)
		const [again] = await freshImport(dir, ['brain.js'])
		assert.equal(again, a1, 'unchanged folder: the same module (no new copy per load)')
		fs.writeFileSync(path.join(dir, 'phys.js'), 'export const v = 22\n')
		assert.notEqual(folderVersion(dir), v1)
		const [a2, p2] = await freshImport(dir, ['brain.js', 'phys.js'])
		assert.equal(a2.val, 22, 'the entry sees the new physics')
		assert.equal(p2.v, 22)
		assert.equal(a2.val, p2.v, 'one copy of each file per version')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
	assert.equal(passVersion('file:///m/client/a.js?rcv=1', 'file:///m/client/b.js'), 'file:///m/client/b.js?rcv=1')
	assert.equal(passVersion('file:///m/client/a.js?rcv=1', 'file:///m/other/b.js'), 'file:///m/other/b.js', 'other folders untouched')
	assert.equal(passVersion('file:///m/client/a.js', 'file:///m/client/b.js'), 'file:///m/client/b.js', 'no version, no change')
	assert.equal(passVersion('file:///m/client/a.js?rcv=1', 'node:fs'), 'node:fs')
	assert.equal(passVersion(undefined, 'file:///x.js'), 'file:///x.js')
	const bots = fs.readFileSync(path.join(__dirname, '../../modules/rc-game/server/rc-room-bots.js'), 'utf8')
	assert.match(bots, /freshImport\(CLIENT_DIR, \['bot-brain\.js', 'physics\.js', 'track-math\.js', 'occ\.js'\]\)/, 'the bots load through it')
	assert.doesNotMatch(bots, /import\(pathToFileURL/, 'no fixed-URL import left')
})
