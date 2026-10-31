'use strict'

/**
 * WO-897 — the pixel map samples every Caspar frame once: a watcher reads the surface's header seq (peekSeq) and kicks the
 * follow engine per new frame (FollowEngine.kick, coalesced by MIN_TICK_MS); the engine's own 23 ms clock skips while frames
 * drive it. Control: the 23 ms clock alone (before this WO) leaves ~6.5 of 50 frames/s unsampled.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { FollowEngine, TICK_MS, MIN_TICK_MS } = require('../../src/fixtures/follow-engine')
const { peekSeq } = require('../../src/fixtures/pixel-map-frame')
const { createPixelMapService } = require('../../src/fixtures/pixel-map-service')

const fn = (attribute) => [{ name: attribute, attribute, from: 0, to: 255, default: 0, physFrom: 0, physTo: 1, sets: [] }]
const ch = (geometry, attribute, offsets) => ({ name: `${geometry}_${attribute}`, geometry, break: 1, offsets, res: 1, attribute,
	default: 0, initial: 0, functions: fn(attribute) })
const TYPE = '6ad826d14d1b'
const mode = { name: 'Px', geometry: 'Body', breaks: [1], footprint: 4,
	channels: [ch('Body', 'Dimmer', [1]), ch('Px 1', 'ColorAdd_R', [2]), ch('Px 1', 'ColorAdd_G', [3]), ch('Px 1', 'ColorAdd_B', [4])] }
const resolveMode = (t, m) => (t === TYPE && m === 'Px' ? mode : null)
const PATCH = [{ id: 'pl', name: 'Pixel', typeId: TYPE, mode: 'Px', universe: 18, address: 1, dest: '127.0.0.1:6455' }]

const W = 64
const H = 16
const SLOT = 4096 * 2
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo897-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))

/** An hshm segment written in place (never truncated: the watcher may read it at any moment); publish(seq) = one frame. */
function segment(file) {
	const head = Buffer.alloc(4096 + 3 * SLOT)
	head.write('HASCGSHM', 0, 'latin1')
	head.writeUInt32LE(1, 8)
	head.writeUInt32LE(4096, 12)
	head.writeUInt32LE(W, 16)
	head.writeUInt32LE(H, 20)
	head.writeUInt32LE(W * 4, 24)
	for (let s = 0; s < 3; s++) head.writeBigUInt64LE(BigInt(4096 + s * SLOT), 48 + 8 * s)
	fs.writeFileSync(file, head)
	const fd = fs.openSync(file, 'r+')
	const px = Buffer.alloc(W * H * 4, 0x80)
	const u64 = Buffer.alloc(8)
	return {
		publish(seq) {
			const slot = seq % 3
			const base = 4096 + slot * SLOT
			u64.writeBigUInt64LE(BigInt(2 * seq))
			fs.writeSync(fd, u64, 0, 8, base)
			fs.writeSync(fd, px, 0, px.length, base + 4096)
			u64.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot))
			fs.writeSync(fd, u64, 0, 8, 96)
		},
		close: () => fs.closeSync(fd),
	}
}

/**
 * 50 fps for `frames` frames through a real engine + service; `kick` false = the engine's 23 ms clock only. rate_hz 0 =
 * every frame (WO-897); WO-916 made 25 the default (every 2nd frame of 50).
 */
async function run({ frames = 50, kick = true, rate_hz = 0 } = {}) {
	const file = path.join(dir, `pgm-${kick ? 'kick' : 'clock'}-${rate_hz}`)
	const seg = segment(file)
	const engine = new FollowEngine({ hub: { list: () => [], now: () => Date.now() }, send: () => {}, resolveMode })
	engine.configure({ dmx: { enabled: false }, patch: PATCH }) // DMX master off: nothing goes on the wire
	engine.isLive = () => true // …but sample as if the head were on it
	if (!kick) engine.kick = undefined // the watcher only kicks an engine that has kick()
	let ticks = 0
	const tick = engine.tick.bind(engine)
	engine.tick = () => (ticks++, tick())
	const svc = createPixelMapService({}, engine, { subscribe: false, surfacePath: () => file, lease: async () => {},
		channelMap: () => ({ programChannels: [1], previewChannels: [], channelResolutionsByChannel: { 1: { w: W, h: H } } }) })
	engine.pixelMap = svc
	svc.load({ pixelMappings: [{ id: 'a', fixtureId: 'pl', pixel: 1, channelNo: 1, rect: { x: 0, y: 0, w: 8, h: 8 } }], pixelMapSettings: { rate_hz } })
	engine.start()
	await new Promise((r) => setTimeout(r, 60))
	const t0 = ticks
	for (let seq = 1; seq <= frames; seq++) {
		seg.publish(seq)
		await new Promise((r) => setTimeout(r, 20))
	}
	await new Promise((r) => setTimeout(r, 40))
	engine.stop()
	svc.stop()
	seg.close()
	return { ...svc.live().stats, ticks: ticks - t0 }
}

describe('WO-897 pixel-map frame tick', () => {
	it('peekSeq reads the latest seq from the header alone; no segment → 0', () => {
		const file = path.join(dir, 'peek')
		const seg = segment(file)
		assert.equal(peekSeq(file), 0)
		seg.publish(7)
		assert.equal(peekSeq(file), 7)
		seg.close()
		assert.equal(peekSeq(path.join(dir, 'nope')), 0)
	})

	it('kick: at once after MIN_TICK_MS, coalesced inside it, a no-op while stopped', async () => {
		let t = 1000
		const e = new FollowEngine({ hub: { list: () => [], now: () => t }, send: () => {}, now: () => t })
		let n = 0
		const tick = e.tick.bind(e)
		e.tick = () => (n++, tick())
		e.kick()
		assert.equal(n, 0, 'stopped: nothing')
		e.start()
		e.kick()
		assert.equal(n, 1, 'first kick ticks at once')
		t += 2
		e.kick()
		e.kick()
		assert.equal(n, 1, 'inside MIN_TICK_MS: deferred')
		await new Promise((r) => setTimeout(r, MIN_TICK_MS + 15))
		assert.equal(n, 2, 'two kicks inside the window → one tick')
		e.stop()
		assert.ok(TICK_MS === 23 && MIN_TICK_MS < 20, 'the clock stays 23 ms; the coalescing window is under a 50 fps frame')
	})

	it('50 fps: every frame sampled once (no gap), about one tick per frame', async () => {
		const s = await run()
		assert.equal(s.missed, 0, JSON.stringify(s))
		assert.equal(s.frames, 50, JSON.stringify(s))
		assert.ok(s.ticks >= 48 && s.ticks <= 56, `ticks ${s.ticks}`)
	})

	it('WO-916 25 Hz (the default): every 2nd frame, steady — 25 sampled, 25 skipped by the rate, none missed', async () => {
		const s = await run({ rate_hz: 25 })
		assert.equal(s.missed, 0, JSON.stringify(s))
		assert.ok(s.frames >= 24 && s.frames <= 26, JSON.stringify(s))
		assert.ok(s.frames + s.skipped >= 48 && s.frames + s.skipped <= 50, JSON.stringify(s))
		assert.ok(Math.abs(s.skipped - s.frames) <= 1, 'one skipped per sampled: ' + JSON.stringify(s))
	})

	it('control: the 23 ms clock alone leaves frames unsampled (the 6.5 Hz judder)', async () => {
		const s = await run({ kick: false })
		assert.ok(s.missed >= 3 && s.frames + s.missed <= 50, JSON.stringify(s))
	})
})
