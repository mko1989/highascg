'use strict'

/**
 * WO-615 T3/T4 — typed fixtures in the patch and the DMX they put on the wire: gdtf-patch.js (pan / tilt derived
 * from the mode, value encoding, defaults), follow-patch.js (typeId / mode, sACN, collisions across typed and
 * generic fixtures), the engine (programmer, `fixtures.dmx` master + per-universe enable, E1.31 packets), the
 * /api/fixtures/dmx + /program routes, and a loopback wire test (Art-Net 127.0.0.1:6455, sACN unicast
 * 127.0.0.1:5569 — never the box's own :6454 / :5568). Fixture: tools/fixtures/gdtf/test-spot.xml (synthetic).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const dgram = require('dgram')
const fs = require('fs')
const path = require('path')
const { Packet } = require('sacn')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { applyType, encodeValue, writeGdtf, normalizeDmx, cleanValue } = require('../../src/fixtures/gdtf-patch')
const { normalizePatch, normalizeFixture } = require('../../src/fixtures/follow-patch')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { encodeE131, decodeE131, sacnDest, boxCid } = require('../../src/fixtures/sacn')
const { decodeArtDmx, ArtnetSender } = require('../../src/fixtures/artdmx')
const { RouteRegistry } = require('../../src/api/route-registry')
const { register } = require('../../src/api/routes-fixture-dmx')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const TYPE = 'aaaaaaaaaaaa'
let _modes = null
async function modes() {
	if (!_modes) _modes = (await parseDescription(XML)).modes
	return _modes
}
const resolver = (list) => (id, name) => (id === TYPE ? list.find((m) => m.name === name) || null : null)
const hub = { list: () => [], now: () => 0 }

test('E1.31: header layers, multicast group, and the sacn package parses our packets', () => {
	const d = new Uint8Array(512)
	d[0] = 255
	d[511] = 7
	const buf = encodeE131({ universe: 7, sequence: 42, priority: 120, data: d })
	assert.strictEqual(buf.length, 638)
	assert.strictEqual(buf.readUInt16BE(16), 0x7000 | 622)
	assert.strictEqual(buf.readUInt16BE(38), 0x7000 | 600)
	assert.strictEqual(buf.readUInt16BE(115), 0x7000 | 523)
	const p = new Packet(buf)
	assert.deepStrictEqual([p.universe, p.sequence, p.priority, p.sourceName], [7, 42, 120, 'HighAsCG'])
	const back = decodeE131(buf)
	assert.strictEqual(back.data[0], 255)
	assert.strictEqual(back.data[511], 7)
	assert.deepStrictEqual(boxCid('a'), boxCid('a'))
	assert.deepStrictEqual(sacnDest('', 300), { host: '239.255.1.44', port: 5568 })
	assert.deepStrictEqual(sacnDest('10.0.0.9', 1), { host: '10.0.0.9', port: 5568 })
	assert.strictEqual(sacnDest('nope', 1), null)
})

test('applyType: pan / tilt from the mode (range, falling tilt flips invert), channels with a slot', async () => {
	const std = (await modes()).find((m) => m.name === 'Standard')
	const fx = applyType(normalizeFixture({ tilt: { invert: false }, pan: { invert: true } }, 0), std)
	assert.deepStrictEqual(fx.pan, { ch: 1, fine: 2, range: 540, invert: true })
	assert.deepStrictEqual(fx.tilt, { ch: 3, fine: 4, range: 270, invert: true }, 'tilt 135 → −135 falls')
	assert.strictEqual(fx.moving, true)
	assert.strictEqual(fx.gdtf.channels.length, 6, 'the virtual dimmer has no slot')
	const pix = applyType(
		normalizeFixture({}, 0),
		(await modes()).find((m) => m.name === 'Pixels')
	)
	assert.strictEqual(pix.moving, false)
})

test('encodeValue / writeGdtf: physical, norm, dmx, set; defaults; per-geometry keys win', async () => {
	const std = (await modes()).find((m) => m.name === 'Standard')
	const [pan, tilt, , dim, wheel] = std.channels
	assert.strictEqual(encodeValue(pan, pan.functions[0], 0), 32768)
	assert.strictEqual(encodeValue(pan, pan.functions[0], 270), 65535)
	assert.strictEqual(encodeValue(tilt, tilt.functions[0], 135), 0, 'falling physical range')
	assert.strictEqual(encodeValue(dim, dim.functions[0], 0.5), 128)
	assert.strictEqual(encodeValue(dim, dim.functions[0], { norm: 1 }), 255)
	assert.strictEqual(encodeValue(dim, dim.functions[0], { dmx: 999 }), 255)
	assert.strictEqual(encodeValue(wheel, wheel.functions[0], { set: 'Red' }), 10)
	assert.strictEqual(encodeValue(wheel, wheel.functions[1], 1), 255, 'Spin 128…255')
	const fx = applyType(normalizeFixture({ address: 11 }, 0), std)
	const buf = new Uint8Array(512)
	writeGdtf(buf, fx, null)
	assert.deepStrictEqual([...buf.subarray(10, 17)], [128, 0, 128, 0, 0, 0, 0], 'defaults: pan/tilt 32768, rest 0')
	writeGdtf(buf, fx, { Dimmer: 1, Color1: { set: 'Gobo' }, Pan: -270 })
	assert.deepStrictEqual([...buf.subarray(10, 17)], [0, 0, 128, 0, 0, 255, 20])
	writeGdtf(buf, fx, { Color1WheelSpin: 1 })
	assert.strictEqual(buf[16], 255, 'the key attribute picks the function')
	writeGdtf(buf, fx, { Shutter1: { dmx: 3 } })
	assert.strictEqual(buf[16], 3, 'shared offset 7: the programmed twin wins, whichever comes first in the file')
	const pix = applyType(
		normalizeFixture({ address: 1 }, 0),
		(await modes()).find((m) => m.name === 'Pixels')
	)
	const pb = new Uint8Array(512)
	writeGdtf(pb, pix, { ColorAdd_R: 0.5, 'Pixel 2/ColorAdd_R': 1, Dimmer: 1 })
	assert.deepStrictEqual([...pb.subarray(0, 4)], [255, 128, 255, 128])
	assert.strictEqual(cleanValue(NaN), undefined)
	assert.deepStrictEqual(cleanValue({ set: 'Red', junk: 1 }), { set: 'Red' })
	assert.deepStrictEqual(
		[...normalizeDmx({ enabled: true, universes: ['sacn:1', 'sacn:0', 'artnet:3', 'x:1'] }).universes],
		['sacn:1', 'artnet:3']
	)
})

test('normalizePatch: typed footprint, collisions across typed + generic, sACN, unknown type, follow without pan', async () => {
	const resolveMode = resolver(await modes())
	const p = normalizePatch(
		{
			patch: [
				{ id: 'spot', typeId: TYPE, mode: 'Standard', universe: 0, address: 1 },
				{ id: 'gen', universe: 0, address: 7 }, // generic pan 1/2 tilt 3/4 → slots 7–10, spot ends at 7
				{ id: 'bar', typeId: TYPE, mode: 'Pixels', protocol: 'sacn', universe: 5, address: 509 },
				{ id: 'bar2', typeId: TYPE, mode: 'Pixels', protocol: 'sacn', universe: 5, address: 510 },
				{ id: 'lost', typeId: 'bbbbbbbbbbbb', mode: 'Standard', universe: 9 },
				{ id: 'parfollow', typeId: TYPE, mode: 'Pixels', follow: 3, universe: 8 },
			],
		},
		{ resolveMode }
	)
	const by = Object.fromEntries(p.fixtures.map((f) => [f.id, f]))
	assert.deepStrictEqual(by.spot.slots, [0, 1, 2, 3, 4, 5, 6])
	assert.strictEqual(by.spot.problem, null)
	assert.match(by.gen.problem, /channel 7 already used by Fixture 1/)
	assert.strictEqual(by.bar.problem, null)
	assert.deepStrictEqual(by.bar.to, { host: '239.255.0.5', port: 5568 })
	assert.match(by.bar2.problem, /past channel 512/)
	assert.match(by.lost.problem, /not found/)
	assert.match(by.parfollow.problem, /no Pan \/ Tilt/)
	assert.strictEqual(normalizeFixture({ protocol: 'sacn', universe: 0 }, 0).universe, 1, 'sACN universes start at 1')
	assert.strictEqual(p.dmx.enabled, false, 'DMX master off by default')
})

function engineWith(list, slice) {
	const sent = []
	const e = new FollowEngine({
		hub,
		send: (to, pkt) => sent.push({ to, pkt }),
		resolveMode: resolver(list),
		now: () => 1000,
	})
	e.configure(slice)
	return { e, sent }
}

test('engine: typed universes need the DMX master + listing; programmer; follow overrides pan only when aimed', async () => {
	const list = await modes()
	const patch = [
		{ id: 'spot', typeId: TYPE, mode: 'Standard', protocol: 'sacn', universe: 2, address: 1 },
		{ id: 'gen', universe: 0, address: 1, dest: '127.0.0.1:6455' },
	]
	const { e, sent } = engineWith(list, { output: { enabled: true, protocol: 'artnet' }, patch })
	e.tick()
	assert.deepStrictEqual(
		sent.map((s) => s.to.port),
		[6455],
		'follow backup on: generic Art-Net only; typed sACN silent'
	)
	e.configure({ output: { enabled: true, protocol: 'artnet' }, dmx: { enabled: true, universes: ['sacn:2'] }, patch })
	sent.length = 0
	assert.deepStrictEqual(e.program(['spot', 'ghost'], { Dimmer: 1, Pan: 90 }), ['spot'])
	e.tick()
	const s = sent.find((x) => x.to.port === 5568)
	const pkt = decodeE131(s.pkt)
	assert.strictEqual(pkt.universe, 2)
	assert.deepStrictEqual(
		[...pkt.data.subarray(0, 7)],
		[170, 170, 128, 0, 0, 255, 0],
		'pan 90° of ±270 = 2/3 → 43690, dimmer full'
	)
	e.program(['spot'], { Pan: null })
	e.tick()
	assert.strictEqual(e.values().spot.Pan, undefined)
	assert.strictEqual(e.hold('spot', 0, 45).tilt, 45)
	sent.length = 0
	e._uni.forEach((u) => (u.last = null))
	e.tick()
	const held = decodeE131(sent.find((x) => x.to.port === 5568).pkt).data
	assert.deepStrictEqual(
		[...held.subarray(0, 4)],
		[128, 0, 85, 85],
		'a calibration hold aims the typed head: tilt 45° on 135 → −135 = 1/3'
	)
	e.clearProgram()
	assert.deepStrictEqual(e.values(), {})
	e.configure({ output: { enabled: false }, dmx: { enabled: false, universes: ['sacn:2'] }, patch })
	sent.length = 0
	e.tick()
	assert.strictEqual(sent.length, 0, 'both masters off → nothing on the wire')
	const st = e.status()
	assert.deepStrictEqual(
		st.universes.map((u) => [u.protocol, u.universe, u.typed, u.live]),
		[
			['sacn', 2, true, false],
			['artnet', 0, false, false],
		]
	)
})

test('engine: sACN onto the box’s own input universe is refused', async () => {
	const e = new FollowEngine({
		hub,
		send: () => {},
		resolveMode: resolver(await modes()),
		isSelfLoop: (to, u, proto) => proto === 'sacn' && u === 1,
	})
	e.configure({
		patch: [
			{ id: 'a', protocol: 'sacn', universe: 1 },
			{ id: 'b', protocol: 'sacn', universe: 2 },
		],
	})
	// WO-695: refused on the WIRE only (noSend) — the frame is still built, so the previs beams + programmer work.
	assert.match(e.fixtures[0].noSend, /loop into this box's sACN input \(universe 1\)/)
	assert.strictEqual(e.fixtures[0].problem, null)
	assert.strictEqual(e.fixtures[1].noSend, null)
	assert.match(e.status().fixtures[0].problem, /loop into this box/, 'the operator still sees why it is not sent')
	assert.strictEqual(e.status().fixtures[0].state, 'not output')
})

test('routes: usage map, frame, programmer', async () => {
	const { e } = engineWith(await modes(), {
		dmx: { enabled: true, universes: ['artnet:4'] },
		patch: [
			{ id: 'spot', name: 'Spot', typeId: TYPE, mode: 'Standard', universe: 4, address: 101, dest: '127.0.0.1:6455' },
		],
	})
	const routes = new RouteRegistry()
	register(routes)
	const ctx = { fixtureService: { engine: e } }
	const call = (method, p, body = '', query = {}) => routes.dispatch(method, p, body, ctx, undefined, query)
	const usage = JSON.parse((await call('GET', '/api/fixtures/dmx')).body)
	assert.deepStrictEqual(usage.dmx, { enabled: true, priority: 100, universes: ['artnet:4'], visualise: false, sacn_port: 5568, iface: '' })
	assert.deepStrictEqual(usage.universes[0].fixtures[0], {
		id: 'spot',
		name: 'Spot',
		address: 101,
		from: 101,
		to: 107,
		channels: 7,
		problem: null,
	})
	assert.strictEqual(usage.universes[0].used, 7)
	const prog = await call('POST', '/api/fixtures/program', JSON.stringify({ id: 'spot', values: { Dimmer: 1 } }))
	assert.deepStrictEqual(JSON.parse(prog.body), { changed: ['spot'] })
	assert.strictEqual((await call('POST', '/api/fixtures/program', '{"values":{}}')).status, 400)
	e.tick()
	const fr = JSON.parse((await call('GET', '/api/fixtures/dmx/frame', '', { protocol: 'artnet', universe: '4' })).body)
	assert.strictEqual(fr.live, true)
	assert.strictEqual(fr.data[105], 255)
	assert.strictEqual((await call('GET', '/api/fixtures/dmx/frame', '', { protocol: 'sacn', universe: '4' })).status, 404)
	assert.deepStrictEqual(JSON.parse((await call('GET', '/api/fixtures/program')).body).values, { spot: { Dimmer: 1 } })
	await call('DELETE', '/api/fixtures/program', '', { id: 'spot' })
	assert.deepStrictEqual(e.values(), {})
	assert.strictEqual((await routes.dispatch('GET', '/api/fixtures/dmx', '', {}, undefined, {})).status, 503)
})

test('wire: Art-Net and sACN reach a loopback receiver with the exact channel bytes', async () => {
	const listen = (port) =>
		new Promise((resolve) => {
			const s = dgram.createSocket('udp4')
			const got = []
			s.on('message', (m) => got.push(m))
			s.bind(port, '127.0.0.1', () => resolve({ s, got }))
		})
	const art = await listen(6455)
	const sac = await listen(5569)
	const sender = new ArtnetSender()
	const e = new FollowEngine({ hub, send: (to, pkt) => sender.send(to, pkt), resolveMode: resolver(await modes()) })
	e.configure({
		dmx: { enabled: true, universes: ['artnet:3', 'sacn:9'] },
		patch: [
			{ id: 'a', typeId: TYPE, mode: 'Standard', universe: 3, address: 1, dest: '127.0.0.1:6455' },
			{ id: 'p', typeId: TYPE, mode: 'Pixels', protocol: 'sacn', universe: 9, address: 20, dest: '127.0.0.1:5569' },
		],
	})
	e.program(['a'], { Dimmer: 0.5, Color1: { set: 'Red' } })
	e.program(['p'], { 'Pixel 3/ColorAdd_R': 1 })
	e.tick()
	for (let i = 0; i < 50 && (!art.got.length || !sac.got.length); i++) await new Promise((r) => setTimeout(r, 10))
	sender.close()
	art.s.close()
	sac.s.close()
	const a = decodeArtDmx(art.got[0])
	assert.strictEqual(a.portAddress, 3)
	assert.deepStrictEqual([...a.data.subarray(0, 8)], [128, 0, 128, 0, 0, 128, 10, 0])
	const p = decodeE131(sac.got[0])
	assert.strictEqual(p.universe, 9)
	assert.deepStrictEqual([...p.data.subarray(18, 24)], [0, 0, 0, 0, 255, 0])
})
