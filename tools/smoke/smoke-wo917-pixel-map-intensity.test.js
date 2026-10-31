'use strict'

/**
 * WO-917 — the pixel map's intensity override (`pixelMapSettings.intensity { override, level % }`): while on, every
 * mapped head's Dimmer channels sit at `level` and its unmapped pixels (Pixel Line's white segments, GDTF default 255)
 * are dark, in the engine's buffer of the head (what the previs decodes, and what goes out when the DMX master lists
 * the universe). Off (the default) leaves dimmer / white to the head's own values — the LD's.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const M = require('../../src/fixtures/pixel-map-model')
const pmSettings = require('../../src/fixtures/pixel-map-settings')
const { createPixelMapService } = require('../../src/fixtures/pixel-map-service')

const TYPE = '6ad826d14d1b'
const fn = (attribute) => [{ name: attribute, attribute, from: 0, to: 255, default: 0, physFrom: 0, physTo: 1, sets: [] }]
const ch = (geometry, attribute, offsets, def = 0) => ({ name: `${geometry}_${attribute}`, geometry, break: 1, offsets, res: offsets.length,
	attribute, default: def, initial: 0, functions: fn(attribute) })
/** Pixel Line IP Mode11 70DMX as far as the map cares: ch1 Dimmer, 16 RGB cells 5–52, 16 W segments 53–68 (default 255). */
function pixelLineMode(dimmer = [1]) {
	const channels = [ch('Body 6', 'Dimmer', dimmer)]
	for (let i = 0; i < 16; i++) {
		const o = 5 + 3 * i
		channels.push(ch(`Array ${109 + i}`, 'ColorAdd_R', [o]), ch(`Array ${109 + i}`, 'ColorAdd_G', [o + 1]), ch(`Array ${109 + i}`, 'ColorAdd_B', [o + 2]))
	}
	for (let i = 0; i < 16; i++) channels.push(ch(`Array ${125 + i}`, 'ColorAdd_W', [53 + i], 255))
	return { name: 'Mode11 70DMX', geometry: 'Body 6', breaks: [1], footprint: 68, channels }
}

describe('WO-917 model: intensityPlan / writeIntensity', () => {
	const fx = { address: 421, gdtf: pixelLineMode() }

	it('plan = the Dimmer channel + every pixel no mapping drives (the 14 other RGB cells, the 16 W segments)', () => {
		const p = M.intensityPlan(fx, new Set([1, 2]))
		assert.deepEqual(p.dimmers.map((c) => c.offsets), [[1]])
		assert.deepEqual(p.dark.map((d) => d.pixel), Array.from({ length: 30 }, (_, i) => i + 3))
	})

	it('writes the dimmer at the level and the unmapped pixels black; the mapped ones are left alone', () => {
		const buf = new Uint8Array(512).fill(255)
		M.writeIntensity(buf, fx, M.intensityPlan(fx, new Set([1, 2])), 0.5)
		assert.equal(buf[420], 128, 'ch1 (slot 421) at 50 %')
		assert.deepEqual([...buf.subarray(424, 430)], [255, 255, 255, 255, 255, 255], 'pixels 1 + 2 untouched')
		assert.deepEqual([...buf.subarray(430, 472)], new Array(42).fill(0), 'RGB cells 3–16 dark')
		assert.deepEqual([...buf.subarray(472, 488)], new Array(16).fill(0), 'W segments dark')
		assert.equal(buf[488], 255, 'past the head untouched')
	})

	it('a 16-bit dimmer gets both bytes, big-endian; no Dimmer → only the dark pixels', () => {
		const wide = { address: 1, gdtf: pixelLineMode([1, 2]) }
		const buf = new Uint8Array(512)
		M.writeIntensity(buf, wide, M.intensityPlan(wide, new Set([1])), 1)
		assert.deepEqual([...buf.subarray(0, 2)], [255, 255])
		const none = { address: 1, gdtf: { channels: pixelLineMode().channels.slice(1) } }
		assert.equal(M.intensityPlan(none, new Set()).dimmers.length, 0)
	})
})

describe('WO-917 settings', () => {
	it('defaults to off at 100 %, a write of intensity alone keeps the rest; junk is refused', () => {
		const d = pmSettings.normalizeSettings(null)
		assert.deepEqual(d.intensity, { override: false, level: 100 })
		assert.equal(pmSettings.isDefault(d), true)
		const r = pmSettings.validateSettings({ intensity: { override: true } }, { ...d, rate_hz: 30 })
		assert.equal(r.ok, true)
		assert.deepEqual(r.settings.intensity, { override: true, level: 100 })
		assert.equal(r.settings.rate_hz, 30)
		assert.equal(pmSettings.isDefault(r.settings), false)
		for (const bad of [{ override: 'yes' }, { level: 101 }, { level: 50.5 }, { level: '50' }, []]) {
			assert.equal(pmSettings.validateSettings({ intensity: bad }, d).ok, false, JSON.stringify(bad))
		}
		assert.deepEqual(pmSettings.normalizeSettings({ intensity: { override: 1, level: 400 } }).intensity, { override: false, level: 100 })
	})
})

describe('WO-917 service: the override in the head\'s engine bytes (master off — what the previs shows)', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo917-'))
	let t = 5_000_000
	const engine = new FollowEngine({ hub: { list: () => [], now: () => t }, send: () => {}, now: () => t,
		resolveMode: (id, m) => (id === TYPE && m === 'Mode11 70DMX' ? pixelLineMode() : null) })
	const pm = createPixelMapService({}, engine, { subscribe: false, now: () => t, surfacePath: (role) => path.join(dir, role),
		lease: async () => {}, channelMap: () => ({ programChannels: [1], channelResolutionsByChannel: { 1: { w: 320, h: 180 } } }) })
	engine.pixelMap = pm
	engine.configure({ dmx: { enabled: false, universes: [] }, patch: [
		{ id: 'pl', name: 'Pixel Line IP 1042', typeId: TYPE, mode: 'Mode11 70DMX', universe: 18, address: 421, dest: '127.0.0.1:6455' }] })
	const frame = () => engine.frameOf(engine.fixtures.find((f) => f.id === 'pl'))
	const MAPS = [1, 2].map((pixel) => ({ id: `p${pixel}`, fixtureId: 'pl', pixel, role: 'pgm1', channelNo: 1, rect: { x: 10 * pixel, y: 0, w: 4, h: 4 } }))
	const run = (intensity) => {
		pm.load({ pixelMappings: MAPS, pixelMapSettings: { rate_hz: 0, ...(intensity ? { intensity } : {}) } })
		t += 23
		engine.tick()
		return frame()
	}
	after(() => pm.stop())

	it('off: dimmer and white stay the head\'s own (GDTF defaults 0 / 255)', () => {
		const b = run(null)
		assert.equal(b[420], 0)
		assert.deepEqual([...b.subarray(472, 488)], new Array(16).fill(255))
	})

	it('on at 100 %: dimmer full, W segments dark; at 40 %: 102; off again: back to the head\'s own', () => {
		let b = run({ override: true, level: 100 })
		assert.equal(b[420], 255)
		assert.deepEqual([...b.subarray(472, 488)], new Array(16).fill(0))
		assert.equal(engine.isLive(engine.fixtures.find((f) => f.id === 'pl')), false, 'master off: nothing on the wire')
		assert.deepEqual(pm.live(t).intensity, { override: true, level: 100 })
		b = run({ override: true, level: 40 })
		assert.equal(b[420], 102)
		b = run(null)
		assert.equal(b[420], 0)
		assert.deepEqual([...b.subarray(472, 488)], new Array(16).fill(255))
	})

	it('wiring: write() applies it per mapped head while override is on', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/fixtures/pixel-map-service.js'), 'utf8')
		assert.match(src, /if \(settings\.intensity\.override\) writeIntensity\(buf, fx, planOf\(fx, list\), settings\.intensity\.level \/ 100\)/)
	})
})
