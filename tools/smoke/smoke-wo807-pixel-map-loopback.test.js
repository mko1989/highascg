'use strict'

/**
 * WO-807 phase 1 acceptance on the wire (loopback only — 127.0.0.1:6455, never a broadcast; on the box a broadcast on
 * :6454 lands on its own lighting input): a 100 × 200 px region of a known colour on a channel's shm surface → pixel 1
 * of a Pixel Line head (universe 18 @ 421) → the ArtDMX packet the follow engine sends carries that colour at DMX
 * 425/426/427 on the first tick after the frame; a two-colour region carries the mean; a new frame shows on the next
 * tick; no frame for HOLD_MS → black; the DMX master off → nothing on the wire.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const dgram = require('dgram')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { ArtnetSender, decodeArtDmx } = require('../../src/fixtures/artdmx')
const { createPixelMapService, HOLD_MS } = require('../../src/fixtures/pixel-map-service')

const PORT = 6455
const TYPE = '6ad826d14d1b'
const fn = (attribute) => [{ name: attribute, attribute, from: 0, to: 255, default: 0, physFrom: 0, physTo: 1, sets: [] }]
const ch = (geometry, attribute, offsets, def = 0) => ({ name: `${geometry}_${attribute}`, geometry, break: 1, offsets, res: 1,
	attribute, default: def, initial: 0, functions: fn(attribute) })
function pixelLineMode() {
	const channels = [ch('Body 6', 'Dimmer', [1]), ch('Array 141', 'Shutter1', [2]), ch('Array 142', 'Shutter2', [3]), ch('Body 6', 'Frost1', [4])]
	for (let i = 0; i < 16; i++) {
		const o = 5 + 3 * i
		channels.push(ch(`Array ${109 + i}`, 'ColorAdd_R', [o], 255), ch(`Array ${109 + i}`, 'ColorAdd_G', [o + 1], 255), ch(`Array ${109 + i}`, 'ColorAdd_B', [o + 2], 255))
	}
	for (let i = 0; i < 16; i++) channels.push(ch(`Array ${125 + i}`, 'ColorAdd_W', [53 + i], 255))
	return { name: 'Mode11 70DMX', geometry: 'Body 6', breaks: [1], footprint: 68, channels }
}

function writeSegment(file, { width, height, pixels }, seq) {
	const stride = width * 4
	const slotSize = Math.ceil((4096 + stride * height) / 4096) * 4096
	const buf = Buffer.alloc(4096 + 3 * slotSize)
	buf.write('HASCGSHM', 0, 'latin1')
	buf.writeUInt32LE(1, 8)
	buf.writeUInt32LE(4096, 12)
	buf.writeUInt32LE(width, 16)
	buf.writeUInt32LE(height, 20)
	buf.writeUInt32LE(stride, 24)
	for (let s = 0; s < 3; s++) buf.writeBigUInt64LE(BigInt(4096 + s * slotSize), 48 + 8 * s)
	const slot = seq % 3
	const base = 4096 + slot * slotSize
	buf.writeBigUInt64LE(BigInt(2 * seq), base)
	pixels.copy(buf, base + 4096)
	buf.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot), 96)
	fs.writeFileSync(file, buf)
}
function picture(width, height, rects) {
	const px = Buffer.alloc(width * height * 4)
	for (let i = 3; i < px.length; i += 4) px[i] = 255
	for (const r of rects) {
		for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
			const i = (y * width + x) * 4
			;[px[i], px[i + 1], px[i + 2]] = [r.rgb[2], r.rgb[1], r.rgb[0]]
		}
	}
	return { width, height, pixels: px }
}

/** Bind 127.0.0.1:6455 (retrying while another loopback smoke holds it — node --test runs files in parallel). */
function listen() {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + 20000
		const attempt = () => {
			const s = dgram.createSocket('udp4')
			const got = []
			s.on('message', (m) => got.push(m))
			s.once('error', (e) => {
				s.close()
				if (e.code === 'EADDRINUSE' && Date.now() < deadline) setTimeout(attempt, 100)
				else reject(e)
			})
			s.bind(PORT, '127.0.0.1', () => resolve({ s, got }))
		}
		attempt()
	})
}
const settle = () => new Promise((r) => setTimeout(r, 60))

describe('WO-807 loopback: screen region → Pixel Line pixel 1 → ArtDMX on 127.0.0.1:6455', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo807-loop-'))
	const file = path.join(dir, 'highascg-pgm1')
	let t = 1_000_000
	let art
	const sender = new ArtnetSender()
	const engine = new FollowEngine({ hub: { list: () => [], now: () => t }, send: (to, p) => sender.send(to, p), now: () => t,
		resolveMode: (id, m) => (id === TYPE && m === 'Mode11 70DMX' ? pixelLineMode() : null) })
	const leases = []
	const pm = createPixelMapService({}, engine, { subscribe: false, now: () => t, surfacePath: () => file, lease: async (roles) => leases.push(roles),
		channelMap: () => ({ programChannels: [1], previewChannels: [2], channelResolutionsByChannel: { 1: { w: 640, h: 360 } } }) })
	engine.pixelMap = pm
	const slice = (enabled) => ({ dmx: { enabled, universes: ['artnet:18'] }, patch: [
		{ id: 'pl1042', name: 'Pixel Line IP 1042', typeId: TYPE, mode: 'Mode11 70DMX', universe: 18, address: 421, dest: '127.0.0.1:6455' }] })
	const REGION = { x: 40, y: 60, w: 100, h: 200 }
	const lastPacket = () => decodeArtDmx(art.got[art.got.length - 1])
	const tick = async () => {
		const n = art.got.length
		t += 23
		engine.tick()
		await settle()
		return art.got.length > n ? lastPacket() : null
	}

	before(async () => {
		art = await listen()
	})
	after(() => {
		pm.stop()
		sender.close()
		art?.s.close()
	})

	it('a known colour reaches DMX 425/426/427 of universe 18 on the first tick after the frame', async () => {
		engine.configure(slice(true))
		pm.load({ pixelMappings: [{ id: 'm1', fixtureId: 'pl1042', pixel: 1, channelNo: 1, rect: REGION }] })
		assert.deepEqual(pm.mappings().map((m) => m.problem), [null])
		await settle()
		assert.deepEqual(leases[leases.length - 1], ['pgm1'], 'channel 1 is PGM 1 → the shared pgm1 surface')
		writeSegment(file, picture(640, 360, [{ ...REGION, rgb: [255, 64, 0] }]), 1)
		const p = await tick()
		assert.ok(p, 'a packet arrived on 127.0.0.1:6455')
		assert.equal(p.portAddress, 18)
		assert.deepEqual([...p.data.subarray(424, 427)], [255, 64, 0])
		assert.deepEqual([...p.data.subarray(427, 430)], [255, 255, 255], 'pixel 2 unmapped: its GDTF default')
		assert.equal(p.data[420], 0, 'the dimmer stays with the programmer / default (0)')
		const live = pm.live(t).mappings[0]
		assert.deepEqual([live.rgb, live.slots, live.on_wire, live.universe], [[255, 64, 0], [425, 426, 427], true, 18])
	})

	it('a two-colour region → the mean (hand calc: (200,0,40) | (0,100,0) → (100,50,20)); the next frame on the next tick', async () => {
		writeSegment(file, picture(640, 360, [{ x: 40, y: 60, w: 50, h: 200, rgb: [200, 0, 40] }, { x: 90, y: 60, w: 50, h: 200, rgb: [0, 100, 0] }]), 2)
		assert.deepEqual([...(await tick()).data.subarray(424, 427)], [100, 50, 20])
		writeSegment(file, picture(640, 360, [{ ...REGION, rgb: [1, 2, 3] }]), 3)
		assert.deepEqual([...(await tick()).data.subarray(424, 427)], [1, 2, 3])
	})

	it('no new frame for HOLD_MS → the pixel goes black (the screen is gone)', async () => {
		t += HOLD_MS
		const p = await tick()
		assert.deepEqual([...p.data.subarray(424, 427)], [0, 0, 0])
		assert.equal(pm.live(t).channels[0].state, 'stalled')
	})

	it('the DMX master off → nothing is sent (the engine rules apply to mapped pixels)', async () => {
		engine.configure(slice(false))
		writeSegment(file, picture(640, 360, [{ ...REGION, rgb: [9, 9, 9] }]), 4)
		assert.equal(await tick(), null)
		assert.equal(pm.live(t).mappings[0].on_wire, false)
	})

	it('removing the mappings releases the surface lease', async () => {
		pm.load({ pixelMappings: [] })
		await settle()
		assert.deepEqual(leases[leases.length - 1], [])
	})
})
