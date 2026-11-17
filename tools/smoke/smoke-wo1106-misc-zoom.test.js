'use strict'

/**
 * WO-1106 D3 (zoom) — fakes only: no X, no window_grab, no PipeWire, no Caspar.
 *   session  the 2 s rebind() waits for the window list, then works in the source's chain (C9) and re-checks: a quit
 *            or an assign that ran during the await is not undone, and nothing throws into the timer's catch.
 *   audio    apply()'s own link + feed pass takes the tick's single-flight slot: with a tick in flight it waits, so
 *            the return feed's consumer is ADDed once, not by both passes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { createZoomSession } = require('../../src/zoom/zoom-session')
const { createZoomAudio } = require('../../src/zoom/zoom-audio')

const WIN = { id: '0x1', title: 'Meeting', width: 1188, height: 800, role: 'meeting' }
const WIN2 = { id: '0x2', title: 'Meeting', width: 1188, height: 800, role: 'meeting' } // Zoom recreated the window
const deferred = () => {
	let resolve
	const promise = new Promise((r) => (resolve = r))
	return { promise, resolve }
}
const settle = async (n = 5) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

function sessionRig() {
	const grabs = []
	let list = async () => [WIN]
	const s = createZoomSession({
		exists: () => true,
		exec: async () => ({ stdout: '' }),
		listWindows: () => list(),
		guiRect: async () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
		ensureBinary: () => ({ ok: true, bin: '/x' }),
		createGrab: (o) => {
			const g = { ...o, alive: true, status: { window: o.window }, setWindows: [], below() {}, normal() {}, move() {}, exited: Promise.resolve() }
			g.setWindow = (id) => g.setWindows.push(id)
			g.stop = () => (g.alive = false)
			grabs.push(g)
			return g
		},
		timers: { setInterval: () => ({ unref() {} }), clearInterval: () => {} },
	})
	return { s, grabs, setList: (fn) => (list = fn) }
}

test('D3: a quit while rebind() waits for the window list — no TypeError, no re-bind', async () => {
	const r = sessionRig()
	await r.s.assign('share', { window: '0x1' })
	const g = r.grabs[0]
	g.status.window = null // the grabber reports "window gone"
	const wins = deferred()
	r.setList(() => wins.promise)
	const rb = r.s.rebind()
	await settle()
	await r.s.quit()
	wins.resolve([WIN2])
	await rb // rejected with "Cannot read properties of null (reading 'setWindow')" before the fix
	assert.deepEqual(g.setWindows, ['0x1'], 'the stopped grab was not pointed at the new window')
	r.setList(async () => [WIN2])
	assert.equal((await r.s.status()).sources.share.window, null, 'the quit stands')
})

test('D3: an assign while rebind() waits for the window list — the new grab keeps its window', async () => {
	const r = sessionRig()
	await r.s.assign('share', { window: '0x1' })
	r.grabs[0].status.window = null
	const wins = deferred()
	r.setList(() => wins.promise)
	const rb = r.s.rebind()
	await settle()
	r.setList(async () => [WIN, WIN2])
	await r.s.assign('share', { window: '0x1', fit: false }) // a fit change restarts the grabber
	wins.resolve([WIN, WIN2])
	await rb
	assert.equal(r.grabs.length, 2)
	assert.deepEqual(r.grabs[1].setWindows, ['0x1'], 'the rebind of the old grab did not move the new one')
	assert.equal((await r.s.status()).sources.share.window, '0x1')
})

test('D3: rebind() still re-binds a lost window to the same-title one (the normal path)', async () => {
	const r = sessionRig()
	await r.s.assign('share', { window: '0x1' })
	r.grabs[0].status.window = null
	r.setList(async () => [WIN2])
	await r.s.rebind()
	assert.deepEqual(r.grabs[0].setWindows, ['0x1', '0x2'])
	assert.equal((await r.s.status()).sources.share.window, '0x2')
})

const node = (id, name, cls) => ({ id, type: 'PipeWire:Interface:Node', info: { props: { 'node.name': name, 'media.class': cls } } })
const GRAPH = [node(10, 'highascg_zoom_in', 'Audio/Sink'), node(11, 'highascg_zoom_out', 'Audio/Source')]

function audioRig() {
	const spawn = (bin, args) => {
		const p = new EventEmitter()
		Object.assign(p, { bin, args, unref() {}, kill() {} })
		p.stdin = new EventEmitter()
		p.stdin.write = () => true
		p.stdout = { pipe: () => {} }
		return p
	}
	const sock = new EventEmitter()
	sock.bind = () => {}
	sock.close = () => {}
	const files = {}
	const fs = {
		existsSync: () => true,
		mkdirSync: () => {},
		writeFileSync: (f, d) => (files[f] = d),
		readFileSync: (f) => {
			if (files[f]) return files[f]
			throw new Error('ENOENT')
		},
	}
	const ticks = []
	const st = { consumer: false, adds: 0, gate: null }
	const amcp = {
		isConnected: true,
		info: async () => {
			if (st.gate) await st.gate.promise
			return { data: st.consumer ? 'port_9277' : '' }
		},
		raw: async (cmd) => {
			if (/^ADD /.test(cmd)) {
				st.adds++
				st.consumer = true
			}
		},
	}
	const za = createZoomAudio({
		exec: async (bin) => ({ stdout: bin === 'pw-dump' ? JSON.stringify(GRAPH) : '' }),
		spawn, fs, createSocket: () => sock, getAmcp: () => amcp,
		timers: { setInterval: (fn) => (ticks.push(fn), { unref() {} }), clearInterval: () => {} },
		feeds: () => [{ id: 'pgm:1', label: 'Screen 1 program (ch 2)', channel: 2 }],
		dir: '/x/zdir', runtimeBase: '/x', stateFile: '/x/state.json',
		now: () => 1000, sleep: async () => {},
	})
	return { za, st, ticks }
}

test('D3: apply() during a tick in flight waits for it — the return consumer is ADDed once', async () => {
	const r = audioRig()
	await r.za.apply({ enabled: true, feed: 'pgm:1' })
	assert.equal(r.st.adds, 1)
	// Caspar restarted: the consumer is gone; a tick and an apply both find it missing
	r.st.consumer = false
	r.st.adds = 0
	r.st.gate = deferred()
	const t = r.ticks[0]() // the 2 s tick, held in its AMCP INFO
	await settle()
	const a = r.za.apply({})
	await settle()
	r.st.gate.resolve()
	await Promise.all([t, a])
	assert.equal(r.st.adds, 1, 'one ADD — apply did not run its pass beside the tick')
	const again = r.ticks[0]()
	assert.notEqual(again, undefined)
	await again
	assert.equal(r.st.adds, 1, 'the slot was released: a later tick runs and finds the consumer')
})
