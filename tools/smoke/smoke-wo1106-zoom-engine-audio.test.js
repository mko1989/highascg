'use strict'

/**
 * WO-1106 C8 / C14 — Zoom audio failure paths (fake exec / spawn / clock, nothing real is started):
 *   C8  the 2 s link tick never overlaps itself; a private PipeWire daemon that cannot start is retried with backoff
 *       (2 s doubling to 60 s) and given up after 8 failures with ONE warn line and a state status() shows; an explicit
 *       enable (or the daemon answering again) starts over.
 *   C14 pw-cat / ffmpeg 'error' (a missing binary) is handled: no uncaught exception, the bridge is torn down.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { createZoomAudio } = require('../../src/zoom/zoom-audio')

const node = (id, name, cls) => ({ id, type: 'PipeWire:Interface:Node', info: { props: { 'node.name': name, 'media.class': cls } } })
const GRAPH = [node(10, 'highascg_zoom_in', 'Audio/Sink'), node(11, 'highascg_zoom_out', 'Audio/Source')]

function rig() {
	const st = { up: false, canStart: true, t: 1000 }
	const spawns = []
	const logs = []
	const exec = async (bin) => {
		if (bin === 'pw-dump') {
			if (!st.up) throw new Error('Host is down')
			return { stdout: JSON.stringify(GRAPH) }
		}
		return { stdout: '' }
	}
	const spawn = (bin, args) => {
		const p = new EventEmitter()
		Object.assign(p, { bin, args, killed: [], unref() {} })
		p.kill = (s) => p.killed.push(s)
		p.stdin = new EventEmitter()
		p.stdin.write = () => true
		p.stdout = { pipe: () => {} }
		spawns.push(p)
		if (args.includes('pipewire') && st.canStart) st.up = true
		return p
	}
	const sock = new EventEmitter()
	sock.bind = () => {}
	sock.close = () => (sock.closed = true)
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
	const timers = { setInterval: (fn) => (ticks.push(fn), { unref() {} }), clearInterval: () => {} }
	const amcp = { isConnected: true, info: async () => ({ data: '' }), raw: async () => {} }
	const feeds = () => [{ id: 'pgm:1', label: 'Screen 1 program (ch 2)', channel: 2 }]
	const za = createZoomAudio({
		exec, spawn, fs, timers, feeds,
		createSocket: () => sock,
		getAmcp: () => amcp,
		dir: '/x/zdir', runtimeBase: '/x', stateFile: '/x/state.json',
		log: (l, m) => logs.push([l, m]),
		now: () => st.t,
		sleep: async () => {},
	})
	const daemonStarts = () => spawns.filter((p) => p.args.includes('pipewire')).length
	return { za, st, spawns, logs, ticks, sock, daemonStarts }
}

test('C8: the tick does not overlap itself; a dead daemon is retried with backoff and given up after 8 failures', async () => {
	const r = rig()
	await r.za.apply({ enabled: true })
	assert.equal(r.daemonStarts(), 1)
	// the daemon dies and cannot come back
	r.st.up = false
	r.st.canStart = false
	const a = r.ticks[0]()
	const b = r.ticks[0]()
	await Promise.all([a, b])
	assert.equal(r.daemonStarts(), 2, 'two overlapping ticks start the daemon once')
	// backoff: 2, 4, 8, 16, 32, 60, 60 s between attempts
	const waits = [2000, 4000, 8000, 16000, 32000, 60000, 60000]
	for (const w of waits) {
		const before = r.daemonStarts()
		r.st.t += w - 1
		await r.ticks[0]()
		assert.equal(r.daemonStarts(), before, `no retry before ${w} ms`)
		r.st.t += 1
		await r.ticks[0]()
		assert.equal(r.daemonStarts(), before + 1, `retry at ${w} ms`)
	}
	assert.equal(r.daemonStarts(), 1 + 8, 'eight failed restarts in all')
	// given up: no more attempts, one warn line, visible in status()
	const before = r.daemonStarts()
	for (let i = 0; i < 5; i++) {
		r.st.t += 120000
		await r.ticks[0]()
	}
	assert.equal(r.daemonStarts(), before, 'no attempts after giving up')
	const warns = r.logs.filter(([l, m]) => l === 'warn' && /did not start after 8 tries/.test(m))
	assert.equal(warns.length, 1, 'exactly one warn line')
	let s = await r.za.status()
	assert.deepEqual(s.restart, { failures: 8, gaveUp: true })
	assert.match(s.error, /did not start after 8 tries/)
	// an explicit enable starts over
	r.st.canStart = true
	s = await r.za.apply({ enabled: true })
	assert.equal(r.daemonStarts(), before + 1)
	assert.deepEqual(s.restart, { failures: 0, gaveUp: false })
	assert.equal(s.enabled, true)
})

test('C8: a successful restart resets the backoff', async () => {
	const r = rig()
	await r.za.apply({ enabled: true })
	r.st.up = false
	r.st.canStart = false
	await r.ticks[0]()
	r.st.t += 2000
	await r.ticks[0]()
	assert.deepEqual((await r.za.status()).restart, { failures: 2, gaveUp: false })
	r.st.canStart = true
	r.st.t += 4000
	await r.ticks[0]()
	assert.equal((await r.za.status()).restart.failures, 0)
	// a later death is retried at once again (no stale backoff)
	r.st.up = false
	const before = r.daemonStarts()
	await r.ticks[0]()
	assert.equal(r.daemonStarts(), before + 1)
})

test('C14: pw-cat / ffmpeg errors (missing binary) are handled and tear the bridge down', async () => {
	const r = rig()
	await r.za.apply({ enabled: true, feed: 'pgm:1' })
	const ff = r.spawns.find((p) => p.bin === 'ffmpeg')
	const rec = r.spawns.find((p) => p.bin === 'pw-cat' && p.args.includes('--record'))
	const play = r.spawns.find((p) => p.bin === 'pw-cat' && p.args.includes('--playback'))
	assert.ok(ff && rec && play)
	assert.doesNotThrow(() => ff.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })))
	assert.ok(rec.killed.includes('SIGTERM'), 'the recorder of the dead pair is stopped')
	assert.doesNotThrow(() => play.emit('error', new Error('spawn pw-cat ENOENT')))
	assert.ok(r.sock.closed, 'the return bridge is torn down')
	assert.doesNotThrow(() => rec.emit('error', new Error('spawn pw-cat ENOENT')))
	assert.match((await r.za.status()).error, /ENOENT/)
})
