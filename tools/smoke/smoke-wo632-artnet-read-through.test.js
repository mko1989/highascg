'use strict'

/**
 * WO-632 — Art-Net read-through for the follow backup: the console's frame passes through untouched while a head
 * isn't tracking, pan / tilt fade to the tracked aim over fade_s when its marker is valid and back when it is lost,
 * the console's aim seeds the IK, a box reading its own output is refused, and frames arrive through the
 * lighting input's socket (artnet-tap), never a second :6454 bind.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const { axisDeg, ConsoleFrames, normalizeThrough } = require('../../src/fixtures/follow-through')
const { axisBytes } = require('../../src/fixtures/follow-ik')
const { encodeArtDmx, decodeArtDmx } = require('../../src/fixtures/artdmx')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const tap = require('../../src/artnet/artnet-tap')

test('axisDeg inverts axisBytes (16-bit, 8-bit, inverted)', () => {
	for (const ax of [{ ch: 1, fine: 2, range: 540, invert: false }, { ch: 1, fine: 0, range: 270, invert: false },
		{ ch: 1, fine: 2, range: 540, invert: true }]) {
		for (const deg of [-200, -12.5, 0, 33, 120].filter((d) => Math.abs(d) <= ax.range / 2)) {
			const b = axisBytes(ax, deg)
			const frame = new Uint8Array(512)
			frame[0] = b[0]
			if (ax.fine) frame[1] = b[1]
			const tol = ax.fine ? 0.01 : ax.range / 255
			assert.ok(Math.abs(axisDeg(ax, frame, 1) - deg) <= tol, `${JSON.stringify(ax)} ${deg}`)
		}
	}
})

test('normalizeThrough: off by default, offset / fade clamped', () => {
	assert.deepStrictEqual(normalizeThrough(), { enabled: false, offset: 0, fade_s: 1 })
	assert.deepStrictEqual(normalizeThrough({ enabled: true, offset: 4.4, fade_s: 99 }), { enabled: true, offset: 4, fade_s: 30 })
})

function rig({ status = 1, protocol = 'artnet', offset = 10, dest = '10.0.0.9', consolePan = 90 } = {}) {
	let t = 1000
	const marker = { id: 1, x: 0, y: 4, z: 0, stale: false, status }
	const hub = { now: () => t, list: () => [marker] }
	const frames = new Map()
	const consoleFrames = { frame: (pa) => frames.get(pa) || null }
	const sent = []
	const eng = new FollowEngine({ hub, consoleFrames, now: () => t, send: (to, p) => sent.push(decodeArtDmx(p)),
		reachesSelf: (to) => to.host.startsWith('127.') && to.port === 6454 })
	const fx = { id: 'a', follow: 1, dest, address: 1, fixed: '6=255', pose: { x: 0, y: 0, z: 6 } }
	eng.configure({ output: { enabled: true, protocol, through: { enabled: true, offset, fade_s: 1 } }, patch: [fx] })
	const cons = new Uint8Array(512)
	const pan = axisBytes(eng.fixtures[0].pan, consolePan), tilt = axisBytes(eng.fixtures[0].tilt, -30)
	cons.set([pan[0], pan[1], tilt[0], tilt[1], 7, 40], 0) // ch5 = 7 (colour), ch6 dimmer 40
	cons[100] = 123 // another fixture's channel
	frames.set(offset, cons)
	const tick = (ms) => {
		for (let left = ms; left > 0; left -= 50) { // the engine caps one tick's dt at 0.5 s; run at ~20 Hz
			t += Math.min(50, left)
			eng.tick()
		}
		if (ms === 0) eng.tick()
		return sent.at(-1)?.data
	}
	return { eng, tick, cons, marker, sent, fx: () => eng.fixtures[0] }
}

test('tracking fades in from the console aim over fade_s; other channels pass through', () => {
	const r = rig()
	const first = r.tick(0)
	assert.deepStrictEqual([...first.subarray(0, 6)], [...r.cons.subarray(0, 6)], 'w = 0: exactly the console')
	assert.strictEqual(first[100], 123, 'untouched channels pass through')
	r.tick(500)
	const half = r.eng.status().fixtures[0]
	assert.strictEqual(half.through, 'fading')
	const mid = r.sent.at(-1).data
	const panMid = axisDeg(r.fx().pan, mid, 1)
	const target = r.eng.aimOf('a').pan
	assert.ok(Math.abs(panMid - (90 + (target - 90) * 0.5)) < 0.2, `half way in degrees (${panMid} vs ${target})`)
	assert.strictEqual(mid[5], Math.round(40 * 0.5 + 255 * 0.5), 'fixed dimmer blends too')
	const full = r.tick(600)
	assert.strictEqual(r.eng.status().fixtures[0].through, 'tracking')
	assert.ok(Math.abs(axisDeg(r.fx().pan, full, 1) - target) < 0.02)
	assert.strictEqual(full[5], 255)
	assert.strictEqual(full[4], 7, 'a non-follow channel of the head stays the console\'s')
	assert.strictEqual(full[100], 123)
})

test('marker lost (status 0) → fades back to the console values', () => {
	const r = rig()
	r.tick(0)
	r.tick(1100)
	r.marker.status = 0
	r.tick(500)
	assert.strictEqual(r.eng.status().fixtures[0].through, 'fading')
	const back = r.tick(600)
	assert.strictEqual(r.eng.status().fixtures[0].through, 'console')
	assert.deepStrictEqual([...back.subarray(0, 6)], [...r.cons.subarray(0, 6)])
})

test('the console aim seeds the IK (tracking starts from where the console left the head)', () => {
	// The marker is straight upstage of the head: pan 0, or pan 180 with the tilt flipped. From the console's 170°
	// the head takes the 180° solution; with no console frame it starts from centre and takes 0°.
	const r = rig({ consolePan: 170 })
	r.tick(0)
	assert.ok(Math.abs(Math.abs(r.eng.aimOf('a').pan) - 180) < 1, `nearest to the console: ${r.eng.aimOf('a').pan}`)
	const c = rig({ consolePan: 170 })
	c.eng.consoleFrames = { frame: () => null }
	c.tick(0)
	assert.ok(Math.abs(c.eng.aimOf('a').pan) < 1, `from centre: ${c.eng.aimOf('a').pan}`)
})

test('no console frame → the old output (zeros around the head); psn ignores read-through', () => {
	const r = rig({ offset: 3 })
	r.eng.consoleFrames = { frame: () => null }
	const out = r.tick(0)
	assert.strictEqual(out[100], 0)
	assert.strictEqual(out[5], 255, 'fixed channel straight out')
	const p = rig({ protocol: 'psn' })
	p.tick(0)
	assert.strictEqual(p.sent.length, 0)
})

test('a console that stops sending is held (no snap, no blackout); a first frame fades in', () => {
	const panOf = (d) => (d[0] << 8) | d[1]
	const r = rig({ status: 0, consolePan: 40 })
	const before = r.tick(2000).slice()
	const frame = r.eng.consoleFrames.frame
	r.eng.consoleFrames = { frame: () => null, last: (pa) => frame(pa) }
	assert.deepStrictEqual([...r.tick(5000)], [...before], 'the lost console\'s look is held')
	assert.strictEqual(r.eng.status().fixtures[0].console, 'held')
	// A console seen for the first time while the head is aimed fades in from the aim instead of snapping.
	const k = rig({ status: 0, consolePan: 100 })
	k.eng.consoleFrames = { frame: () => null }
	const aimed = panOf(k.tick(200))
	assert.strictEqual(k.eng.status().fixtures[0].console, 'none')
	k.eng.consoleFrames = { frame: (pa) => (pa === 10 ? k.cons : null) }
	const mid = panOf(k.tick(500))
	const target = panOf(k.cons)
	assert.ok((mid - aimed) * (target - mid) > 0, `fading: ${aimed} → ${mid} → ${target}`)
	assert.strictEqual(panOf(k.tick(1000)), target)
})

test('reading its own output is refused (offset 0 to a local :6454 destination)', () => {
	assert.match(String(rig({ offset: 0, dest: '127.0.0.1' }).fx().problem), /read its own output/)
	assert.strictEqual(rig({ offset: 10, dest: '127.0.0.1' }).fx().problem, null)
})

test('ConsoleFrames: frames come through the lighting input socket tap; stale after 2.5 s', () => {
	let t = 0
	const cf = new ConsoleFrames({ now: () => t, bind: false })
	cf.start()
	tap.publish(encodeArtDmx({ portAddress: 12, data: [1, 2, 3, 4] }), { address: '192.168.1.50' })
	tap.publish(Buffer.from('junk'), { address: 'x' })
	assert.deepStrictEqual([...cf.frame(12).subarray(0, 4)], [1, 2, 3, 4])
	assert.deepStrictEqual(cf.status().universes, [{ universe: 12, from: '192.168.1.50', age_ms: 0 }])
	t = 2600
	assert.strictEqual(cf.frame(12), null)
	assert.deepStrictEqual([...cf.last(12).subarray(0, 4)], [1, 2, 3, 4], 'the last look is still there to hold')
	cf.stop()
	tap.publish(encodeArtDmx({ portAddress: 12, data: [9, 9] }), {})
	assert.strictEqual(cf.frame(12, 0), null, 'unsubscribed on stop')
})
