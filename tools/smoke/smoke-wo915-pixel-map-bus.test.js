'use strict'

/**
 * WO-915 — pixel mappings bound to a bus (role pgmN / prvN) follow the bus when its Caspar channel changes (WO-868 moved
 * the Dioda PGM from ch1 to ch2 and the 896 edge mappings, stored as channelNo 1, sampled the operator GUI); a POST that
 * moves a mapping to another channel takes it off the bus; the edge proposal emits the wall's bus and counts a
 * renumbered bus as applied; the previs drawing the rig makes the sampler run with the DMX master off.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const M = require('../../src/fixtures/pixel-map-model')
const P = require('../../src/fixtures/pixel-map-propose')
const { isApplied } = require('../../src/fixtures/pixel-map-proposal')
const { createPixelMapService } = require('../../src/fixtures/pixel-map-service')

const TYPE = '6ad826d14d1b'
const fn = (attribute) => [{ name: attribute, attribute, from: 0, to: 255, default: 0, physFrom: 0, physTo: 1, sets: [] }]
const ch = (geometry, attribute, offsets, def = 0) => ({ name: `${geometry}_${attribute}`, geometry, break: 1, offsets, res: 1,
	attribute, default: def, initial: 0, functions: fn(attribute) })
function pixelLineMode() {
	const channels = [ch('Body 6', 'Dimmer', [1])]
	for (let i = 0; i < 16; i++) {
		const o = 5 + 3 * i
		channels.push(ch(`Array ${109 + i}`, 'ColorAdd_R', [o], 255), ch(`Array ${109 + i}`, 'ColorAdd_G', [o + 1], 255), ch(`Array ${109 + i}`, 'ColorAdd_B', [o + 2], 255))
	}
	return { name: 'Mode11 70DMX', geometry: 'Body 6', breaks: [1], footprint: 52, channels }
}

/** HASCGSHM v1 segment with one frame (seq) of a solid colour over `rect` on black. */
function writeSegment(file, width, height, rect, rgb, seq) {
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
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = base + 4096 + y * stride + x * 4
			const on = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
			if (on) [buf[i], buf[i + 1], buf[i + 2]] = [rgb[2], rgb[1], rgb[0]]
			buf[i + 3] = 255
		}
	}
	buf.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot), 96)
	fs.writeFileSync(file, buf)
}

const RES = { 1: { w: 320, h: 180 }, 2: { w: 640, h: 360 } }
const GUI_FIRST = { programChannels: [2], previewChannels: [3], channelResolutionsByChannel: RES }
const PGM_FIRST = { programChannels: [1], previewChannels: [2], channelResolutionsByChannel: RES }

describe('WO-915 model: bus-bound mappings', () => {
	it('role pgmN / prvN is kept; anything else is not a bus', () => {
		assert.equal(M.normalizeMapping({ role: 'pgm1', channelNo: 1 }, 0).role, 'pgm1')
		assert.equal(M.normalizeMapping({ role: 'prv4', channelNo: 1 }, 0).role, 'prv4')
		for (const role of ['ch2', 'pgm5', 'PGM1', '', undefined]) assert.equal('role' in M.normalizeMapping({ role, channelNo: 1 }, 0), false, String(role))
	})

	it('bindRole: the bus channel of now; a mapping without a bus is left alone; a bus with no channel → 0 + a problem', () => {
		const m = M.normalizeMapping({ role: 'pgm1', channelNo: 1, fixtureId: 'pl', rect: { x: 0, y: 0, w: 4, h: 4 } }, 0)
		assert.equal(M.bindRole(m, GUI_FIRST).channelNo, 2)
		assert.equal(M.bindRole(m, PGM_FIRST), m, 'already on its bus channel → the same object')
		const plain = M.normalizeMapping({ channelNo: 1 }, 0)
		assert.equal(M.bindRole(plain, GUI_FIRST), plain)
		const lost = M.bindRole(m, { programChannels: [], previewChannels: [] })
		assert.equal(lost.channelNo, 0)
		const fixtures = [{ id: 'pl', name: 'PL', gdtf: { channels: pixelLineMode().channels }, mode: 'Mode11 70DMX' }]
		assert.equal(M.checkMapping(lost, { fixtures, resolutionOf: () => ({ w: 640, h: 360 }) }).problem, 'bus pgm1 has no Caspar channel')
	})

	it('POST: no channel → the bus channel; the bus channel → kept on the bus; another channel → off the bus (an operator move)', () => {
		const fixtures = [{ id: 'pl', name: 'PL', gdtf: { channels: pixelLineMode().channels }, mode: 'Mode11 70DMX' }]
		const env = { fixtures, resolutionOf: (c) => RES[c] || null, channelMap: GUI_FIRST }
		const rect = { x: 0, y: 0, w: 4, h: 4 }
		const r = M.validateMappings([
			{ id: 'a', fixtureId: 'pl', pixel: 1, role: 'pgm1', rect },
			{ id: 'b', fixtureId: 'pl', pixel: 2, role: 'pgm1', channelNo: 2, rect },
			{ id: 'c', fixtureId: 'pl', pixel: 3, role: 'pgm1', channelNo: 1, rect },
		], env)
		assert.equal(r.ok, true, JSON.stringify(r.errors))
		assert.deepEqual(r.mappings.map((m) => [m.id, m.channelNo, m.role ?? null]), [['a', 2, 'pgm1'], ['b', 2, 'pgm1'], ['c', 1, null]])
	})
})

describe('WO-915 service: the bus moves, the mapping follows; the previs watching samples with the master off', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo915-'))
	const segs = { pgm1: path.join(dir, 'highascg-pgm1'), ch1: path.join(dir, 'highascg-ch1') }
	let t = 5_000_000
	let map = PGM_FIRST
	const leases = []
	const engine = new FollowEngine({ hub: { list: () => [], now: () => t }, send: () => {}, now: () => t,
		resolveMode: (id, m) => (id === TYPE && m === 'Mode11 70DMX' ? pixelLineMode() : null) })
	const pm = createPixelMapService({}, engine, { subscribe: false, now: () => t, surfacePath: (role) => segs[role] || path.join(dir, role),
		lease: async (roles) => leases.push(roles), channelMap: () => map })
	engine.pixelMap = pm
	// DMX master OFF: nothing goes on the wire, so only a watcher makes the sampler run
	engine.configure({ dmx: { enabled: false, universes: [] }, patch: [
		{ id: 'pl', name: 'Pixel Line IP 1042', typeId: TYPE, mode: 'Mode11 70DMX', universe: 18, address: 421, dest: '127.0.0.1:6455' }] })
	const fx = () => engine.fixtures.find((f) => f.id === 'pl')
	const cell1 = () => [...engine.frameOf(fx()).subarray(424, 427)]
	const settle = () => new Promise((r) => setTimeout(r, 20))
	const REGION = { x: 10, y: 20, w: 30, h: 40 }
	after(() => pm.stop())

	it('channel 1 is PGM 1: the bus mapping samples pgm1 like a plain channel-1 mapping would', async () => {
		pm.load({ pixelMappings: [{ id: 'bus', fixtureId: 'pl', pixel: 1, role: 'pgm1', channelNo: 1, rect: REGION }] })
		await settle()
		assert.deepEqual(pm.mappings().map((m) => [m.channelNo, m.role, m.problem]), [[1, 'pgm1', null]])
		assert.deepEqual(leases.at(-1), ['pgm1'])
	})

	it('with the master off and nobody looking, the sampler idles (the head is not on the wire)', () => {
		t += 23
		engine.tick() // builds the head's universe (before that it counts as on the wire, WO-807)
		writeSegment(segs.pgm1, 640, 360, REGION, [200, 40, 10], 1)
		t += 23
		engine.tick()
		assert.deepEqual(cell1(), [0, 0, 0], 'not sampled → the mapped cell is driven dark')
		assert.ok(pm.live(t).stats.idle_ticks > 0)
		t += 6000 // that /live read is not "looking" any more
	})

	it('the previs drawing the rig (watch) → the next frame lands in the head\'s bytes with the master off', () => {
		pm.watch(t)
		writeSegment(segs.pgm1, 640, 360, REGION, [200, 40, 10], 2)
		t += 23
		engine.tick()
		assert.deepEqual(cell1(), [200, 40, 10])
		assert.equal(engine.isLive(fx()), false, 'still nothing on the wire')
	})

	it('only looked at (nothing on the wire) → at most one sample per 100 ms; the eye does not need 48/s', () => {
		writeSegment(segs.pgm1, 640, 360, REGION, [7, 8, 9], 3)
		t += 23
		engine.tick()
		assert.deepEqual(cell1(), [200, 40, 10], '23 ms after the last sample: not read yet')
		t += 80
		engine.tick()
		assert.deepEqual(cell1(), [7, 8, 9], '103 ms: sampled')
	})

	it('WO-868 flips the channels: the bus mapping moves to ch2 (still pgm1), the plain ch1 mapping would sample the GUI', async () => {
		map = GUI_FIRST
		pm.load({ pixelMappings: [
			{ id: 'bus', fixtureId: 'pl', pixel: 1, role: 'pgm1', channelNo: 1, rect: REGION },
			{ id: 'plain', fixtureId: 'pl', pixel: 2, channelNo: 1, rect: REGION },
		] })
		await settle()
		assert.deepEqual(pm.mappings().map((m) => [m.id, m.channelNo, m.role ?? null, m.problem]),
			[['bus', 2, 'pgm1', null], ['plain', 1, null, null]])
		assert.deepEqual(leases.at(-1), ['ch1', 'pgm1'], 'ch1 is no bus now → its own surface; the bus keeps pgm1')
		pm.watch(t)
		writeSegment(segs.pgm1, 640, 360, REGION, [0, 128, 255], 4)
		writeSegment(segs.ch1, 320, 180, { x: 0, y: 0, w: 0, h: 0 }, [0, 0, 0], 1)
		t += 100
		engine.tick()
		assert.deepEqual(cell1(), [0, 128, 255], 'pixel 1 follows the Dioda picture on its new channel')
		assert.deepEqual([...engine.frameOf(fx()).subarray(427, 430)], [0, 0, 0], 'pixel 2 (absolute ch1) reads the GUI channel')
	})

	it('follow-service visual() marks the pixel map watched (pinned)', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/fixtures/follow-service.js'), 'utf8')
		assert.match(src, /visual: \(\) => \{\n\t\t\tpixelMap\.watch\(\)/)
	})
})

describe('WO-915 proposal: the wall bus travels with the mappings', () => {
	const WALL_OBJ = { id: 'w1', type: 'led_wall', panel_mm: [500, 500], panels: [8, 4], position: [0, 1, 0], rotation: [0, 0, 0],
		source: { role: 'pgm1', rect: { x: 0, y: 0, w: 1024, h: 512 } } }

	it('wallOf carries a bus role, never a chN', () => {
		assert.equal(P.wallOf(WALL_OBJ, { channelNo: 2, raster: { w: 1024, h: 512 }, role: 'pgm1' }).role, 'pgm1')
		assert.equal('role' in P.wallOf(WALL_OBJ, { channelNo: 2, raster: { w: 1024, h: 512 }, role: 'ch2' }), false)
		assert.match(fs.readFileSync(path.join(ROOT, 'src/fixtures/pixel-map-propose.js'), 'utf8'),
			/channelNo: hit\.wall\.channelNo, \.\.\.\(hit\.wall\.role \? \{ role: hit\.wall\.role \} : \{\}\)/)
	})

	it('isApplied: same bus on another channel number = applied; an unbound channel-1 copy is not', () => {
		const rect = { x: 50, y: 0, w: 40, h: 16 }
		const p = [{ fixtureId: 'pl', pixel: 1, channelNo: 2, role: 'pgm1', rect, mode: 'average' }]
		assert.equal(isApplied(p, [{ fixtureId: 'pl', pixel: 1, channelNo: 1, role: 'pgm1', rect, mode: 'average' }]), true)
		assert.equal(isApplied(p, [{ fixtureId: 'pl', pixel: 1, channelNo: 1, rect, mode: 'average' }]), false)
		assert.equal(isApplied([{ ...p[0], role: undefined, channelNo: 1 }], [{ fixtureId: 'pl', pixel: 1, channelNo: 1, rect, mode: 'average' }]), true)
	})
})
