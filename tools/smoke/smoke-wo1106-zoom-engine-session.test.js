'use strict'

/**
 * WO-1106 C9 / C12 — the Zoom window grabber (fakes only: no X, no window_grab, no build):
 *   C9  one promise chain per source: overlapping assigns leave exactly one grabber; a quit during a pending assign
 *       leaves none.
 *   C12 ensureBinary builds with an async child (the event loop keeps running), concurrent callers share one build,
 *       and the grab path awaits it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createZoomSession } = require('../../src/zoom/zoom-session')
const { ensureBinary } = require('../../src/zoom/zoom-grab')

const WIN = { id: '0x1', title: 'Meeting', width: 1188, height: 800, role: 'meeting' }
const deferred = () => {
	let resolve
	const promise = new Promise((r) => (resolve = r))
	return { promise, resolve }
}
const tick = () => new Promise((r) => setImmediate(r))

function rig(over = {}) {
	const grabs = []
	const s = createZoomSession({
		exists: () => true,
		exec: async () => ({ stdout: '' }),
		listWindows: async () => [WIN],
		guiRect: async () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
		ensureBinary: () => ({ ok: true, bin: '/x' }), // a plain value: the session awaits whatever comes back
		createGrab: (o) => {
			let gone
			const g = { ...o, alive: true, status: { window: o.window }, setWindow() {}, below() {}, normal() {}, move() {} }
			g.exited = new Promise((r) => (gone = r))
			g.stop = () => {
				g.alive = false
				setTimeout(gone, 5) // the real grabber exits a moment after EOF
			}
			grabs.push(g)
			return g
		},
		timers: { setInterval: () => ({ unref() {} }), clearInterval: () => {} },
		...over,
	})
	return { s, grabs, alive: () => grabs.filter((g) => g.alive) }
}

test('C9: overlapping assigns for one source leave exactly one grabber', async () => {
	const r = rig()
	await r.s.assign('share', { window: '0x1' })
	await Promise.all([r.s.assign('share', { fit: false }), r.s.assign('share', { fit: true }), r.s.assign('share', { size: '1280x720' })])
	assert.equal(r.alive().length, 1, `alive grabbers: ${r.alive().length} of ${r.grabs.length}`)
	const st = await r.s.status()
	assert.equal(st.sources.share.size, '1280x720')
	assert.equal(st.sources.share.grabbing, true)
})

test('C9: a quit while an assign waits for the window list leaves no grabber', async () => {
	const wins = deferred()
	const r = rig({ listWindows: () => wins.promise })
	const a = r.s.assign('presenter', { window: '0x1' })
	await tick()
	const q = r.s.quit()
	await tick()
	wins.resolve([WIN])
	await Promise.allSettled([a, q])
	assert.equal(r.alive().length, 0, 'the quit came after the assign: its grabber is stopped')
})

test('C9 + C12: a quit while an assign waits for the grabber build leaves no grabber', async () => {
	const built = deferred()
	const r = rig({ ensureBinary: () => built.promise })
	const a = r.s.assign('gallery', { window: '0x1' })
	await tick()
	const q = r.s.quit()
	await tick()
	built.resolve({ ok: true, bin: '/x' })
	await Promise.allSettled([a, q])
	assert.equal(r.grabs.length, 1, 'the awaited build result was used')
	assert.equal(r.alive().length, 0)
})

test('C12: ensureBinary builds with an async child, one build for concurrent callers', async () => {
	let builds = 0
	const b = deferred()
	let binary = false
	const deps = { exists: () => binary, mtime: () => 0, build: () => (builds++, b.promise.then(() => (binary = true))) }
	const p1 = ensureBinary(deps)
	const p2 = ensureBinary(deps)
	assert.ok(p1 instanceof Promise, 'ensureBinary returns a promise')
	let loopRan = false
	setImmediate(() => (loopRan = true))
	await tick()
	assert.ok(loopRan, 'the event loop runs during the build')
	b.resolve()
	const [r1, r2] = await Promise.all([p1, p2])
	assert.equal(builds, 1, 'one build shared')
	assert.ok(r1.ok && r2.ok)
	const src = fs.readFileSync(path.join(__dirname, '../../src/zoom/zoom-grab.js'), 'utf8')
	assert.doesNotMatch(src, /execFileSync/, 'no synchronous build')
	assert.match(src, /timeout: 120000/, 'the 120 s build limit is kept')
})
