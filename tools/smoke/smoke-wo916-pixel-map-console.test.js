'use strict'

/**
 * WO-916 — the pixel map always on, with its own output to the lighting console (src/fixtures/pixel-map-console.js,
 * pixel-map-settings.js, wired in pixel-map-service.js / follow-service.js): pixel colour only, the fixtures' own
 * universes or a separate block, Art-Net (unicast) or sACN, sent after every sample whatever the DMX master says;
 * settings validate strictly; a real UDP round trip on 127.0.0.1:6455 (never a broadcast — :6454 is this box's input).
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert')
const dgram = require('dgram')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { ArtnetSender, decodeArtDmx } = require('../../src/fixtures/artdmx')
const { decodeE131 } = require('../../src/fixtures/sacn')
const C = require('../../src/fixtures/pixel-map-console')
const PS = require('../../src/fixtures/pixel-map-settings')
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
	for (let i = 0; i < 16; i++) channels.push(ch(`Array ${125 + i}`, 'ColorAdd_W', [53 + i], 255))
	return { name: 'Mode11 70DMX', geometry: 'Body 6', breaks: [1], footprint: 68, channels }
}

/** HASCGSHM v1 segment with one frame (seq): each { rect, rgb } painted on black. */
function writeSegment(file, width, height, rects, seq) {
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
			const hit = rects.find(({ rect: r }) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
			if (hit) [buf[i], buf[i + 1], buf[i + 2]] = [hit.rgb[2], hit.rgb[1], hit.rgb[0]]
			buf[i + 3] = 255
		}
	}
	buf.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot), 96)
	fs.writeFileSync(file, buf)
}

const A = { x: 0, y: 0, w: 40, h: 16 }
const B = { x: 100, y: 0, w: 40, h: 16 }
const PATCH = [
	{ id: 'p2', name: 'PL 2', typeId: TYPE, mode: 'Mode11 70DMX', universe: 14, address: 1, dest: '255.255.255.255' },
	{ id: 'p1', name: 'PL 1', typeId: TYPE, mode: 'Mode11 70DMX', universe: 13, address: 71, dest: '255.255.255.255' },
]
const MAPS = [
	{ id: 'a', fixtureId: 'p1', pixel: 2, channelNo: 1, rect: A },
	{ id: 'b', fixtureId: 'p2', pixel: 1, channelNo: 1, rect: B },
	{ id: 'c', fixtureId: 'p1', pixel: 1, channelNo: 1, rect: B },
]

/** Engine (DMX master OFF) + service on a temp segment; packets the console output sent land in `sent`. */
function rig(settings, extra = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo916-'))
	const file = path.join(dir, 'highascg-pgm1')
	const st = { t: 2_000_000, seq: 0, sent: [] }
	const engine = new FollowEngine({ hub: { list: () => [], now: () => st.t }, send: () => assert.fail('the DMX master is off'), now: () => st.t,
		resolveMode: (id, m) => (id === TYPE && m === 'Mode11 70DMX' ? pixelLineMode() : null) })
	engine.configure({ dmx: { enabled: false, universes: [] }, patch: PATCH })
	const pm = createPixelMapService({}, engine, { subscribe: false, now: () => st.t, surfacePath: () => file, lease: async () => {},
		channelMap: () => ({ programChannels: [1], previewChannels: [], channelResolutionsByChannel: { 1: { w: 160, h: 32 } } }),
		send: (to, packet) => st.sent.push({ to, packet }), ...extra })
	engine.pixelMap = pm
	pm.load({ pixelMappings: MAPS, pixelMapSettings: { rate_hz: 0, ...settings } })
	return {
		st, pm, engine,
		frame: (a, b) => writeSegment(file, 160, 32, [{ rect: A, rgb: a }, { rect: B, rgb: b }], ++st.seq),
		tick: (ms = 23) => {
			st.t += ms
			const n = st.sent.length
			engine.tick()
			return st.sent.slice(n)
		},
		stop: () => {
			pm.stop()
			fs.rmSync(dir, { recursive: true, force: true })
		},
	}
}
const art = (p) => decodeArtDmx(p.packet)

describe('WO-916 console settings', () => {
	it('defaults: on, Art-Net, no address, the fixtures\' own universes, 25 Hz', () => {
		assert.deepEqual(PS.normalizeSettings(null).console, { enabled: true, protocol: 'artnet', dest: '', layout: 'fixture', universe: 1 })
		assert.equal(PS.normalizeSettings(null).rate_hz, 25)
		assert.equal(PS.isDefault(PS.normalizeSettings(null)), true)
		assert.equal(PS.normalizeSettings({ rate_hz: 0 }).rate_hz, 0, '0 = every frame is a value, not junk')
		assert.equal(PS.normalizeSettings({ rate_hz: 'x' }).rate_hz, 25)
		assert.deepEqual(C.normalizeConsole({ protocol: 'sacn', universe: 0, dest: 'nope', layout: 'x' }),
			{ enabled: true, protocol: 'sacn', dest: '', layout: 'fixture', universe: 1 }, 'junk → defaults (sACN has no universe 0)')
	})

	it('validate: strict, omitted fields keep their value', () => {
		const cur = PS.normalizeSettings({ smooth: { attack_ms: 60 } })
		const ok = PS.validateSettings({ console: { dest: '10.0.0.5', protocol: 'sacn', layout: 'block', universe: 100 } }, cur)
		assert.equal(ok.ok, true)
		assert.deepEqual(ok.settings.console, { enabled: true, protocol: 'sacn', dest: '10.0.0.5', layout: 'block', universe: 100 })
		assert.equal(ok.settings.smooth.attack_ms, 60, 'smooth untouched')
		assert.equal(PS.validateSettings({ rate_hz: 30 }, cur).settings.rate_hz, 30)
		for (const bad of [{}, [], { rate_hz: 61 }, { rate_hz: 2.5 }, { console: { protocol: 'dmx' } }, { console: { dest: 'host.local' } },
			{ console: { layout: 'grid' } }, { console: { universe: -1 } }, { console: { protocol: 'sacn', universe: 0 } }, { console: { enabled: 'yes' } }, { console: 5 }]) {
			assert.equal(PS.validateSettings(bad, cur).ok, false, JSON.stringify(bad))
		}
	})
})

describe('WO-916 console output through the service (DMX master off)', () => {
	it('fixture layout: each head\'s own universe + slots, colour only (dimmer / white 0), with the master off', () => {
		const r = rig({ console: { dest: '10.0.0.5' } })
		r.frame([200, 100, 50], [9, 8, 7])
		const out = r.tick()
		assert.deepEqual(out.map((p) => [p.to, art(p).portAddress]).sort((x, y) => x[1] - y[1]),
			[[{ host: '10.0.0.5', port: 6454 }, 13], [{ host: '10.0.0.5', port: 6454 }, 14]])
		const u13 = art(out.find((p) => art(p).portAddress === 13)).data
		// p1 at 71: pixel 1 = slots 75–77 (B), pixel 2 = 78–80 (A); dimmer (71) and the white segments stay 0
		assert.deepEqual([...u13.subarray(74, 80)], [9, 8, 7, 200, 100, 50])
		assert.equal(u13[70], 0, 'no dimmer')
		assert.equal([...u13].reduce((a, b) => a + b, 0), 9 + 8 + 7 + 200 + 100 + 50, 'nothing but the mapped colours')
		assert.deepEqual([...art(out.find((p) => art(p).portAddress === 14)).data.subarray(4, 7)], [9, 8, 7])
		const live = r.pm.live(r.st.t)
		assert.equal(live.console.universes.length, 2)
		assert.deepEqual(live.mappings.find((m) => m.id === 'a').console, { universe: 13 })
		r.stop()
	})

	it('unchanged → no packet until the 1 s refresh; a change goes out on the next sample', () => {
		const r = rig({ console: { dest: '10.0.0.5' } })
		r.frame([1, 2, 3], [4, 5, 6])
		assert.equal(r.tick().length, 2)
		r.frame([1, 2, 3], [4, 5, 6])
		assert.equal(r.tick().length, 0, 'same bytes')
		r.frame([1, 2, 3], [4, 5, 99])
		assert.equal(r.tick().length, 2, 'B feeds both universes')
		r.frame([1, 2, 3], [4, 5, 99])
		assert.equal(r.tick(C.REFRESH_MS).length, 2, 'refresh')
		r.stop()
	})

	it('block layout: R G B per mapping from the first universe on, ordered by fixture universe / address, then pixel', () => {
		const r = rig({ console: { dest: '10.0.0.5:6455', layout: 'block', universe: 40 } })
		r.frame([200, 100, 50], [9, 8, 7])
		const out = r.tick()
		assert.equal(out.length, 1)
		const p = art(out[0])
		assert.equal(p.portAddress, 40)
		assert.equal(out[0].to.port, 6455)
		// order: p1 (universe 13) pixel 1 = c (B), p1 pixel 2 = a (A), then p2 (universe 14) pixel 1 = b (B)
		assert.deepEqual([...p.data.subarray(0, 9)], [9, 8, 7, 200, 100, 50, 9, 8, 7])
		const live = r.pm.live(r.st.t).mappings
		assert.deepEqual(['c', 'a', 'b'].map((id) => live.find((m) => m.id === id).console), [
			{ universe: 40, slots: [1, 2, 3] }, { universe: 40, slots: [4, 5, 6] }, { universe: 40, slots: [7, 8, 9] }])
		r.stop()
	})

	it('block layout wraps at 170 pixels per universe', () => {
		const list = Array.from({ length: 171 }, (_, i) => ({ m: { id: `m${i}`, enabled: true, pixel: i + 1 }, problem: null,
			fx: { id: 'f', universe: 1, address: 1 }, px: {} }))
		const places = C.placesOf(list, { layout: 'block', universe: 5 })
		assert.deepEqual([places[169].universe, places[169].slots], [5, [508, 509, 510]])
		assert.deepEqual([places[170].universe, places[170].slots], [6, [1, 2, 3]])
	})

	it('sACN: unicast to the address on :5568, or multicast with none; a source of its own', () => {
		const r = rig({ console: { protocol: 'sacn' } })
		r.frame([10, 20, 30], [0, 0, 0])
		const out = r.tick()
		assert.deepEqual(out.map((p) => p.to).sort((a, b) => a.host.localeCompare(b.host)),
			[{ host: '239.255.0.13', port: 5568 }, { host: '239.255.0.14', port: 5568 }])
		const d = decodeE131(out.find((p) => p.to.host.endsWith('.13')).packet)
		assert.equal(d.sourceName, 'HighAsCG pixel map')
		assert.deepEqual([...d.data.subarray(77, 80)], [10, 20, 30])
		r.stop()
		const u = rig({ console: { protocol: 'sacn', dest: '10.0.0.9' } })
		u.frame([10, 20, 30], [0, 0, 0])
		assert.deepEqual(u.tick().map((p) => p.to), [{ host: '10.0.0.9', port: 5568 }, { host: '10.0.0.9', port: 5568 }])
		u.stop()
	})

	it('Art-Net with no address sends nothing (no broadcast onto this box\'s own input) and says why', () => {
		const r = rig({})
		r.frame([10, 20, 30], [0, 0, 0])
		assert.equal(r.tick().length, 0)
		assert.deepEqual(r.pm.live(r.st.t).console.universes.map((u) => u.problem), ['no console address', 'no console address'])
		r.stop()
	})

	it('a universe that would land on this box\'s own input is not sent; the others are', () => {
		const r = rig({ console: { dest: '127.0.0.1' } }, { isSelfLoop: (to, u) => to.port === 6454 && u === 13 })
		r.frame([10, 20, 30], [1, 1, 1])
		assert.deepEqual(r.tick().map((p) => art(p).portAddress), [14])
		assert.match(r.pm.live(r.st.t).console.universes[0].problem, /loop into this box's own Art-Net input/)
		r.stop()
	})

	it('console off → nothing; the sampling (and the engine bytes the previs draws) go on', () => {
		const r = rig({ console: { dest: '10.0.0.5', enabled: false } })
		r.frame([10, 20, 30], [0, 0, 0])
		assert.equal(r.tick().length, 0)
		const fx = r.engine.fixtures.find((f) => f.id === 'p1')
		assert.deepEqual([...r.engine.frameOf(fx).subarray(77, 80)], [10, 20, 30])
		r.stop()
	})
})

describe('WO-916 on the wire: Art-Net to 127.0.0.1:6455', () => {
	let sock
	after(() => sock?.close())
	it('the console universe arrives as ArtDmx with the mapped colours', async () => {
		const got = []
		sock = await new Promise((resolve, reject) => {
			const deadline = Date.now() + 20000
			const attempt = () => {
				const s = dgram.createSocket('udp4')
				s.on('message', (m) => got.push(m))
				s.once('error', (e) => {
					s.close()
					if (e.code === 'EADDRINUSE' && Date.now() < deadline) setTimeout(attempt, 100)
					else reject(e)
				})
				s.bind(6455, '127.0.0.1', () => resolve(s))
			}
			attempt()
		})
		const sender = new ArtnetSender()
		const r = rig({ console: { dest: '127.0.0.1:6455', layout: 'block', universe: 7 } }, { send: (to, p) => sender.send(to, p) })
		r.frame([255, 64, 0], [0, 0, 255])
		r.tick()
		await new Promise((res) => setTimeout(res, 80))
		sender.close()
		r.stop()
		const p = got.map(decodeArtDmx).find((x) => x?.portAddress === 7)
		assert.ok(p, `an ArtDmx on universe 7 (got ${got.length})`)
		assert.deepEqual([...p.data.subarray(0, 9)], [0, 0, 255, 255, 64, 0, 0, 0, 255])
	})
})

describe('WO-916 wiring', () => {
	it('follow-service hands the pixel map the same send (lighting duty) and self-loop guard as the engine', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/fixtures/follow-service.js'), 'utf8')
		assert.match(src, /const send = \(to, packet\) => \{\n\t\tif \(lightingOn\(\)\) return sender\.send\(to, packet\)\n\t\tblocked\+\+/)
		assert.match(src, /send,\n\t\tisSelfLoop,\n\t\treachesSelf,/)
		assert.match(src, /createPixelMapService\(ctx, engine, \{ log, send, isSelfLoop \}\)/)
	})

	it('the service sends the console after every sample and keeps the rate in the watcher', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/fixtures/pixel-map-service.js'), 'utf8')
		assert.match(src, /if \(sampled \|\| t - consoleAt >= CONSOLE_REFRESH_MS\) \{/)
		assert.match(src, /if \(t - s\.dueAt < minGap\(\)\) \{/)
		assert.match(src, /const minGap = \(\) => \(settings\.rate_hz > 0 \? 750 \/ settings\.rate_hz : 0\)/)
	})
})
