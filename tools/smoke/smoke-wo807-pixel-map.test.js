'use strict'

/**
 * WO-807 phase 1 — region-to-fixture-pixel mapping: the pixel layout of a patched GDTF fixture (Pixel Line IP
 * "Mode11 70DMX" shape), the address math, colour → DMX, the region average read from a HASCGSHM v1 surface (exact,
 * hand-checked), the strict validation, the server-owned project key and the wiring (source).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const SRC = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const { normalizePatch } = require('../../src/fixtures/follow-patch')
const model = require('../../src/fixtures/pixel-map-model')
const frame = require('../../src/fixtures/pixel-map-frame')
const { SERVER_OWNED_SLICES, preserveClientOwnedSlices } = require('../../src/engine/project-client-slices')

const fn = (attribute) => [{ name: attribute, attribute, from: 0, to: 255, default: 0, physFrom: 0, physTo: 1, sets: [] }]
const ch = (geometry, attribute, offsets, def = 0) => ({ name: `${geometry}_${attribute}`, geometry, break: 1, offsets, res: offsets.length,
	attribute, default: def, initial: 0, functions: fn(attribute) })

/** The shape of ACME Pixel Line IP "Mode11 70DMX" as gdtf-dmx.js parses it (MHP rig, WO-807 investigation). */
function pixelLineMode() {
	const channels = [ch('Body 6', 'Dimmer', [1]), ch('Array 141', 'Shutter1', [2]), ch('Array 142', 'Shutter2', [3]), ch('Body 6', 'Frost1', [4])]
	for (let i = 0; i < 16; i++) {
		const g = `Array ${109 + i}`
		const o = 5 + 3 * i
		channels.push(ch(g, 'ColorAdd_R', [o], 255), ch(g, 'ColorAdd_G', [o + 1], 255), ch(g, 'ColorAdd_B', [o + 2], 255))
	}
	for (let i = 0; i < 16; i++) channels.push(ch(`Array ${125 + i}`, 'ColorAdd_W', [53 + i], 255))
	channels.push(ch('Array 141', 'Color Fade', [69]), ch('Array 142', 'Color Fade', [70]))
	return { name: 'Mode11 70DMX', geometry: 'Body 6', breaks: [1], footprint: 70, channels }
}

const TYPE = '6ad826d14d1b'
const patchOf = (extra = {}) => normalizePatch({ patch: [
	{ id: 'pl1042', name: 'Pixel Line IP 1042', typeId: TYPE, mode: 'Mode11 70DMX', universe: 18, address: 421, dest: '127.0.0.1:6455' },
	{ id: 'gen', name: 'Generic', universe: 1, address: 1, dest: '127.0.0.1:6455' },
], ...extra }, { resolveMode: (t, m) => (t === TYPE && m === 'Mode11 70DMX' ? pixelLineMode() : null) })

/** A HASCGSHM v1 segment (3 slots) holding BGRA `pixels` as published frame `seq` (as smoke-wo616-beam-spot.test.js). */
function writeSegment(file, { width, height, pixels }, seq, { torn = false } = {}) {
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
	buf.writeBigUInt64LE(BigInt(torn ? 2 * seq - 1 : 2 * seq), base)
	pixels.copy(buf, base + 4096)
	buf.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot), 96)
	fs.writeFileSync(file, buf)
}

/** width × height BGRA, black, with rects [{ x, y, w, h, rgb }] painted (opaque). */
function picture(width, height, rects = []) {
	const px = Buffer.alloc(width * height * 4)
	for (let i = 3; i < px.length; i += 4) px[i] = 255
	for (const r of rects) {
		for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
			const i = (y * width + x) * 4
			px[i] = r.rgb[2]
			px[i + 1] = r.rgb[1]
			px[i + 2] = r.rgb[0]
		}
	}
	return { width, height, pixels: px }
}

describe('WO-807 pixel layout and address math (patch → fixture pixels)', () => {
	const fx = patchOf().fixtures[0]

	it('Pixel Line IP Mode11 70DMX: 16 RGB pixels (stride 3 from offset 5) then 16 white segments', () => {
		assert.equal(fx.problem, null)
		const px = model.pixelsOf(fx)
		assert.equal(px.length, 32)
		assert.deepEqual([px[0].pixel, px[0].geometry, px[0].order], [1, 'Array 109', 'rgb'])
		assert.deepEqual(px[0].channels.map((c) => c.offsets[0]), [5, 6, 7])
		assert.deepEqual(px[15].channels.map((c) => c.offsets[0]), [50, 51, 52])
		assert.deepEqual([px[16].geometry, px[16].order, px[16].channels[0].offsets[0]], ['Array 125', 'w', 53])
		for (let n = 1; n <= 16; n++) assert.equal(px[n - 1].channels[0].offsets[0], 5 + 3 * (n - 1), `pixel ${n} first offset`)
	})

	it('absolute DMX slots: address 421, pixel 1 → 425/426/427, pixel 16 → 470/471/472', () => {
		const px = model.pixelsOf(fx)
		assert.deepEqual(model.slotsOf(fx, px[0]), [425, 426, 427])
		assert.deepEqual(model.slotsOf(fx, px[15]), [470, 471, 472])
		assert.deepEqual(model.slotsOf(fx, px[31]), [488])
	})

	it('an untyped (generic) fixture has no pixels', () => {
		assert.deepEqual(model.pixelsOf(patchOf().fixtures[1]), [])
	})

	it('writePixel puts the colour at the pixel slots only (0-based buffer index = slot − 1)', () => {
		const buf = new Uint8Array(512).fill(7)
		const px = model.pixelsOf(fx)
		const out = model.writePixel(buf, fx, px[1], [10, 20, 30])
		assert.deepEqual(out, [{ slot: 428, value: 10 }, { slot: 429, value: 20 }, { slot: 430, value: 30 }])
		assert.deepEqual([...buf.slice(427, 430)], [10, 20, 30])
		assert.equal(buf[426], 7)
		assert.equal(buf[430], 7)
		model.writePixel(buf, fx, px[1], null)
		assert.deepEqual([...buf.slice(427, 430)], [0, 0, 0], 'no colour (no signal) → black')
	})

	it('colour → DMX: white extraction, white-only, amber, CMY, override order, 16-bit', () => {
		assert.deepEqual(model.componentValues([200, 150, 100], 'rgbw'), [100, 50, 0, 100])
		assert.deepEqual(model.componentValues([200, 150, 100], 'w'), [100], 'a white segment shows min(r, g, b)')
		assert.deepEqual(model.componentValues([200, 150, 100], 'rgb'), [200, 150, 100])
		assert.deepEqual(model.componentValues([200, 150, 100], 'a'), [75])
		assert.deepEqual(model.componentValues([200, 150, 100], 'cmy'), [55, 105, 155])
		const buf = new Uint8Array(512)
		const px = model.pixelsOf(fx)[0]
		model.writePixel(buf, fx, px, [10, 20, 30], 'grb')
		assert.deepEqual([...buf.slice(424, 427)], [20, 10, 30])
		const wide = { address: 1, gdtf: { channels: [ch('P1', 'ColorRGB_Red', [1, 2]), ch('P1', 'ColorRGB_Green', [3, 4]), ch('P1', 'ColorRGB_Blue', [5, 6]), ch('P1', 'ColorAdd_GY', [7])] } }
		const wpx = model.pixelsOf(wide)
		assert.equal(wpx[0].order, 'rgb-')
		const b2 = new Uint8Array(512).fill(9)
		model.writePixel(b2, wide, wpx[0], [255, 128, 0])
		assert.deepEqual([...b2.slice(0, 7)], [255, 255, 128, 128, 0, 0, 0], '16-bit big-endian (128 → 32896), lime driven dark')
	})
})

describe('WO-807 region average from a HASCGSHM surface', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo807-frame-'))
	const file = path.join(dir, 'seg')

	it('a 100 × 200 region of two colours → the mean, checked by hand', () => {
		// left 50 columns (200, 0, 40), right 50 columns (0, 100, 0): mean (100, 50, 20)
		writeSegment(file, picture(640, 360, [{ x: 40, y: 60, w: 50, h: 200, rgb: [200, 0, 40] }, { x: 90, y: 60, w: 50, h: 200, rgb: [0, 100, 0] }]), 4)
		const s = frame.createRegionSampler([{ x: 40, y: 60, w: 100, h: 200, mode: 'average' }, { x: 40, y: 60, w: 100, h: 200, mode: 'point' }])
		const r = s.read(file)
		assert.equal(r.state, 'frame')
		assert.equal(r.seq, 4)
		assert.deepEqual(r.colours[0], [100, 50, 20])
		assert.deepEqual(r.colours[1], [200, 0, 40], 'point = the centre pixel: x (40 + 139) >> 1 = 89, inside the left half')
		assert.equal(r.reads, 200, 'one read per sampled row (the two regions share their rows)')
		assert.equal(s.read(file, { since: 4 }).state, 'none', 'the same frame is not averaged twice')
	})

	it('reports missing / torn frames instead of averaging them', () => {
		const s = frame.createRegionSampler([{ x: 0, y: 0, w: 10, h: 10, mode: 'average' }])
		assert.equal(s.read(path.join(dir, 'nope')).state, 'missing')
		writeSegment(file, picture(64, 64), 7, { torn: true })
		assert.equal(s.read(file).state, 'lapped')
	})

	it('exact for every pixel up to MAX_SAMPLES; a stride above it, still the true mean of a flat picture', () => {
		const W = 1920
		const H = 1080
		const pic = picture(W, H, [{ x: 0, y: 0, w: W, h: H, rgb: [90, 30, 200] }, { x: 13, y: 0, w: 1, h: H, rgb: [255, 255, 255] }])
		writeSegment(file, pic, 9)
		// 1-px white line every 13 px would alias the legacy 8 × 8 stride; here the region is exact (100 × 200 = 20 000 px)
		const regions = [{ x: 0, y: 0, w: 100, h: 200, mode: 'average' }, { x: 200, y: 200, w: 1600, h: 800, mode: 'average' }]
		const r = frame.createRegionSampler(regions).read(file)
		const exact = (c, white) => Math.round((c * 99 + white) / 100)
		assert.deepEqual(r.colours[0], [exact(90, 255), exact(30, 255), exact(200, 255)])
		const big = frame.samplingOf(regions[1], W, H)
		assert.ok(big.step > 1 && big.nx * big.ny >= frame.MAX_SAMPLES, `stride ${big.step}, ${big.nx * big.ny} samples`)
		assert.deepEqual(r.colours[1], [90, 30, 200])
		assert.deepEqual(r.colours[0], frame.averageBgra(pic.pixels, W * 4, frame.samplingOf(regions[0], W, H)))
	})

	it('regions are clipped to the surface; one fully outside gives no colour', () => {
		writeSegment(file, picture(100, 100, [{ x: 90, y: 90, w: 10, h: 10, rgb: [255, 0, 0] }]), 11)
		const r = frame.createRegionSampler([{ x: 90, y: 90, w: 50, h: 50, mode: 'average' }, { x: 200, y: 0, w: 5, h: 5, mode: 'average' }]).read(file)
		assert.deepEqual(r.colours, [[255, 0, 0], null])
	})
})

describe('WO-807 mapping validation (strict on write)', () => {
	const env = { fixtures: patchOf().fixtures, resolutionOf: (c) => (c === 1 ? { w: 3840, h: 1792 } : null) }
	const ok = { id: 'a', fixtureId: 'pl1042', pixel: 1, channelNo: 1, rect: { x: 100, y: 100, w: 100, h: 200 } }

	it('a valid mapping normalizes with the defaults (enabled, average, auto order)', () => {
		const r = model.validateMappings([ok], env)
		assert.equal(r.ok, true)
		assert.deepEqual(r.mappings[0], { ...ok, enabled: true, mode: 'average', colourOrder: 'auto' })
	})

	it('rejects: unknown fixture, untyped fixture, pixel out of range, rect outside, channel not running, bad mode/order, duplicates', () => {
		const bad = [
			[{ ...ok, fixtureId: 'nope' }, /not in the patch/],
			[{ ...ok, fixtureId: 'gen' }, /no GDTF type/],
			[{ ...ok, pixel: 33 }, /pixel 33 outside 1…32/],
			[{ ...ok, rect: { x: 3800, y: 0, w: 100, h: 10 } }, /not inside channel 1 \(3840×1792\)/],
			[{ ...ok, rect: { x: 0, y: 0, w: 0, h: 10 } }, /not inside/],
			[{ ...ok, channelNo: 2 }, /channel 2 is not running/],
			[{ ...ok, mode: 'median' }, /mode "median"/],
			[{ ...ok, colourOrder: 'rgbw' }, /4 letters, pixel 1 has 3 channels/],
		]
		for (const [m, re] of bad) {
			const r = model.validateMappings([m], env)
			assert.equal(r.ok, false, JSON.stringify(m))
			assert.match(r.errors[0].error, re)
		}
		const dup = model.validateMappings([ok, { ...ok, id: 'b' }], env)
		assert.match(dup.errors[0].error, /already mapped by "a"/)
		assert.match(model.validateMappings([ok, { ...ok, pixel: 2 }, { ...ok, pixel: 3, id: 'a' }], env).errors[0].error, /duplicate id/)
		assert.equal(model.validateMappings('x', env).ok, false)
	})

	it('stored lists normalize with unique ids', () => {
		assert.deepEqual(model.normalizeMappings([{ id: 'x' }, { id: 'x' }, {}]).map((m) => m.id), ['x', 'x_', 'pm3'])
		assert.deepEqual(model.normalizeMappings(null), [])
	})
})

describe('WO-807 project key and wiring', () => {
	it('pixelMappings is server-owned: a client save keeps the stored copy, Save As keeps its own', () => {
		assert.ok(SERVER_OWNED_SLICES.includes('pixelMappings'))
		const stored = { name: 'Show', pixelMappings: [{ id: 'a' }] }
		const stale = { name: 'Show', pixelMappings: [] }
		preserveClientOwnedSlices(stale, stored)
		assert.deepEqual(stale.pixelMappings, [{ id: 'a' }])
		const web = { name: 'Show' }
		preserveClientOwnedSlices(web, stored)
		assert.deepEqual(web.pixelMappings, [{ id: 'a' }])
		const saveAs = { name: 'New', pixelMappings: [{ id: 'b' }] }
		preserveClientOwnedSlices(saveAs, null)
		assert.deepEqual(saveAs.pixelMappings, [{ id: 'b' }])
	})

	it('the follow engine samples at tick start and writes after each head; the service hangs off follow-service', () => {
		const eng = SRC('src/fixtures/follow-engine.js')
		assert.match(eng, /this\.pixelMap\?\.sample\(now\)/)
		assert.match(eng, /writeFixture\(u\.buf, fx, fx\.moving && aimed \? next : null, fx\.fixedList\)\n\t\t\t\}\n\t\t\tthis\.pixelMap\?\.write\(u\.buf, fx, now\)/)
		const svc = SRC('src/fixtures/follow-service.js')
		assert.match(svc, /const pixelMap = createPixelMapService\(ctx, engine, \{ log \}\)/)
		assert.match(svc, /engine\.pixelMap = pixelMap/)
		assert.match(svc, /pixelMap\.stop\(\)/)
	})

	it('routes are registered on an existing router line; the legacy JS pixel-map flag stays off', () => {
		assert.match(SRC('src/api/router.js'), /require\('\.\/routes-pixel-map'\)\.register\(routes\)/)
		assert.match(SRC('src/config/defaults-core.js'), /legacyJsPixelmap:\s*false/)
		assert.doesNotMatch(SRC('src/fixtures/pixel-map-service.js'), /require\('\.\.\/sampling\//, 'no legacy sampler, no dmxnet')
	})
})
