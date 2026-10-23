'use strict'
/**
 * WO-711 — PTZ cameras follow tracked people over VISCA. Encoders are byte-exact against the documented examples
 * (PTZOptics VISCA API, BirdDog / Sony VISCA-over-IP, see src/ptz/visca.js), the geometry uses the fixtures' frame
 * (X stage left, Y upstage, yaw 0 = upstage), and the service is exercised against a real UDP listener on 127.0.0.1.
 * No real PTZ camera was involved.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('dgram')

const visca = require('../../src/ptz/visca')
const model = require('../../src/ptz/ptz-model')
const { createPtzService } = require('../../src/ptz/ptz-service')

const hex = (b) => Buffer.from(b).toString('hex')
const bytes = (...a) => Buffer.from(a)

const cam = (over = {}) => model.normalizeCamera({ id: 'c1', enabled: true, host: '127.0.0.1', ...over })
const project = (...list) => ({ previs: { tracking: { ptz: list } } })

describe('WO-711 visca encoders', () => {
	it('absolute pan-tilt matches the PTZOptics worked example', () => {
		// docs.ptzoptics.com: 81 01 06 02 05 05 01 02 03 04 00 00 05 06 FF  (pan 1234h, tilt 0056h, speeds 5/5)
		assert.equal(hex(visca.panTiltAbsolute(1, 0x1234, 0x0056, 5, 5)), '81010602050501020304000005' + '06ff')
	})

	it("positions are signed 16-bit two's complement, one nibble per byte", () => {
		assert.deepEqual(visca.nibbles16(0x0990), [0, 9, 9, 0])
		assert.deepEqual(visca.nibbles16(-1), [15, 15, 15, 15])
		assert.deepEqual(visca.nibbles16(-2448), [15, 6, 7, 0]) // F670h
		assert.equal(hex(visca.panTiltAbsolute(1, -2448, 1296, 24, 20)), '8101060218140f0607000005' + '0100' + 'ff')
	})

	it('speeds and the camera address are clamped to the VISCA ranges', () => {
		const b = visca.panTiltAbsolute(3, 0, 0, 99, 0)
		assert.equal(b[0], 0x83)
		assert.equal(b[4], 0x18) // pan speed max 24
		assert.equal(b[5], 0x01) // tilt speed min 1
		assert.equal(visca.panTiltAbsolute(9, 0, 0)[0], 0x87)
	})

	it('home, preset recall and zoom direct', () => {
		assert.equal(hex(visca.home(1)), '81010604ff')
		assert.equal(hex(visca.presetRecall(1, 5)), '8101043f0205ff')
		assert.equal(hex(visca.zoomDirect(1, 0x4000)), '81010447040000' + '00ff')
		assert.equal(hex(visca.zoomDirect(2, 0x1234)), '82010447010203' + '04ff')
	})

	it('VISCA over IP header: type, big-endian length, big-endian sequence', () => {
		// Jon Skeet's encapsulated example (an inquiry): 01-10-00-05-00-00-00-00-81-09-04-00-FF
		assert.equal(hex(visca.ipFrame(0x0110, bytes(0x81, 0x09, 0x04, 0x00, 0xff), 0)), '0110000500000000' + '81090400ff')
		// BirdDog: PTZ_Direct payload is 9 bytes -> length 00 09
		const cmd = visca.ipCommand(bytes(0x81, 0x01, 0x06, 0x01, 0x09, 0x09, 0x03, 0x01, 0xff), 0x01020304)
		assert.equal(hex(cmd), '01000009' + '01020304' + '81010601090903' + '01ff')
		assert.equal(hex(visca.ipCommand(visca.home(1), 7)), '01000005' + '00000007' + '81010604ff')
		// Sony RESET: control (02 00), 1-byte payload 01, sequence 0
		assert.equal(hex(visca.ipReset()), '0200000100000000' + '01')
	})

	it('datagram(): raw for visca-udp, framed for visca-ip', () => {
		assert.equal(hex(visca.datagram('visca-udp', visca.home(1), 9)), '81010604ff')
		assert.equal(hex(visca.datagram('visca-ip', visca.home(1), 9)), '0100000500000009' + '81010604ff')
	})
})

describe('WO-711 ptz-model', () => {
	it('defaults: disabled, not auto, PTZOptics-like ranges, port by protocol', () => {
		const c = model.normalizeCamera({})
		assert.equal(c.enabled, false)
		assert.equal(c.auto, false)
		assert.equal(c.protocol, 'visca-udp')
		assert.equal(c.port, 1259)
		assert.equal(model.normalizeCamera({ protocol: 'visca-ip' }).port, 52381)
		assert.equal(c.address, 1)
		assert.deepEqual(c.pan, { min: -170, max: 170, units_per_deg: 14.4, invert: false })
		assert.deepEqual(c.tilt, { min: -30, max: 90, units_per_deg: 14.4, invert: false })
		assert.deepEqual(c.speed, { pan: 12, tilt: 10 })
		assert.equal(c.aim_z, 1.4)
		assert.deepEqual(c.home, { preset: 0 })
		assert.equal(c.zoom, null)
	})

	it('junk is clamped or defaulted; ids stay unique; non-objects are skipped', () => {
		const list = model.normalizeList([
			{ id: 'a', port: 99999, address: 12, protocol: 'telnet', zoom: '' },
			'x',
			{ id: 'a', pan: { min: 50, max: -50 } },
		])
		assert.equal(list.length, 2)
		assert.deepEqual(
			list.map((c) => c.id),
			['a', 'a_']
		)
		assert.equal(list[0].protocol, 'visca-udp') // junk protocol falls back
		assert.equal(list[0].port, 65535)
		assert.equal(list[0].address, 7)
		assert.equal(list[0].zoom, null)
		assert.deepEqual([list[1].pan.min, list[1].pan.max], [-50, 50]) // swapped bounds are put right
	})

	it('a person straight ahead is pan 0; tilt looks down at a lower target', () => {
		const c = cam({ pose: { x: 0, y: -8, z: 2.5, yaw: 0 } })
		const a = model.aimAngles(c, { x: 0, y: 0, z: 0 })
		assert.ok(Math.abs(a.pan) < 1e-9)
		assert.ok(Math.abs(a.tilt - (Math.atan2(1.4 - 2.5, 8) * 180) / Math.PI) < 1e-9)
		assert.equal(a.clamped, false)
	})

	it('stage left (+X) is pan right (+); stage right is pan left (-), whatever the yaw', () => {
		const c = cam({ pose: { x: 0, y: -8, z: 2.5, yaw: 0 } })
		const left = model.aimAngles(c, { x: 4, y: 0, z: 0 })
		const right = model.aimAngles(c, { x: -4, y: 0, z: 0 })
		assert.ok(Math.abs(left.pan - (Math.atan2(4, 8) * 180) / Math.PI) < 1e-9)
		assert.ok(left.pan > 0 && right.pan < 0)
		assert.ok(Math.abs(left.pan + right.pan) < 1e-9)
		// camera on stage-left-side facing stage left (yaw 90), person in front of it -> pan 0
		const side = cam({ pose: { x: -8, y: 0, z: 2.5, yaw: 90 } })
		assert.ok(Math.abs(model.aimAngles(side, { x: 0, y: 0, z: 0 }).pan) < 1e-9)
		assert.ok(model.aimAngles(side, { x: 0, y: 4, z: 0 }).pan < 0) // upstage of a left-facing camera is to its left
	})

	it('aim is clamped to the ranges and flagged; behind the camera hits the pan limit', () => {
		const c = cam({ pose: { x: 0, y: 0, z: 2, yaw: 0 }, pan: { min: -90, max: 90 } })
		const behind = model.aimAngles(c, { x: 1, y: -5, z: 0 })
		assert.equal(behind.pan, 90)
		assert.equal(behind.clamped, true)
		assert.equal(model.aimAngles(c, { x: 0, y: 0, z: 40 }).tilt, 90) // straight up: tilt max, no NaN
	})

	it('degrees become signed units; invert flips the sign', () => {
		assert.equal(model.toUnits({ units_per_deg: 14.4, invert: false }, 170), 2448)
		assert.equal(model.toUnits({ units_per_deg: 14.4, invert: false }, -170), -2448)
		assert.equal(model.toUnits({ units_per_deg: 14.4, invert: true }, 10), -144)
		assert.equal(model.toUnits({ units_per_deg: 14.4, invert: true }, 0), 0)
	})
})

/** A service whose sends are captured. */
function rig(...list) {
	const sent = []
	let t = 10_000
	const svc = createPtzService({
		send: (host, port, buf, protocol) => sent.push({ host, port, buf, protocol }),
		now: () => t,
	})
	svc.configure(project(...list))
	return { svc, sent, at: (ms) => (t = ms), tick: (target, ms) => svc.step(ms ?? t, () => target) }
}

describe('WO-711 ptz-service', () => {
	it('sends an absolute pan-tilt (raw VISCA for visca-udp) to the right place', () => {
		const r = rig({ id: 'c1', enabled: true, host: '127.0.0.1', port: 1259, pose: { x: 0, y: -8, z: 2.5, yaw: 0 } })
		r.tick({ x: 4, y: 0, z: 0 }, 10_000)
		assert.equal(r.sent.length, 1)
		assert.equal(r.sent[0].host, '127.0.0.1')
		assert.equal(r.sent[0].port, 1259)
		const c = cam({ pose: { x: 0, y: -8, z: 2.5, yaw: 0 } })
		const a = model.aimAngles(c, { x: 4, y: 0, z: 0 })
		assert.equal(
			hex(r.sent[0].buf),
			hex(visca.panTiltAbsolute(1, model.toUnits(c.pan, a.pan), model.toUnits(c.tilt, a.tilt), 12, 10))
		)
		assert.equal(r.svc.status()[0].state, 'following')
	})

	it('rate limit: at most 10 Hz per camera', () => {
		const r = rig({ id: 'c1', enabled: true, host: '127.0.0.1' })
		r.tick({ x: 0, y: 0, z: 0 }, 10_000)
		r.tick({ x: 5, y: 0, z: 0 }, 10_050)
		r.tick({ x: 5, y: 0, z: 0 }, 10_099)
		assert.equal(r.sent.length, 1)
		r.tick({ x: 5, y: 0, z: 0 }, 10_100)
		assert.equal(r.sent.length, 2)
		for (let t = 10_200; t < 11_200; t += 10) r.tick({ x: (t % 7) - 3, y: 0, z: 0 }, t)
		assert.ok(r.sent.length <= 2 + 10, `1 s of 100 Hz steps sent ${r.sent.length}`)
	})

	it('deadband: a move under 0.3 degrees is not resent, a bigger one is', () => {
		const r = rig({ id: 'c1', enabled: true, host: '127.0.0.1', pose: { x: 0, y: -10, z: 1.4, yaw: 0 } })
		r.tick({ x: 0, y: 0, z: 0 }, 10_000)
		// 0.05 m sideways at 10 m is 0.29 degrees: inside the band; 0.1 m is 0.57 degrees: outside
		r.tick({ x: 0.05, y: 0, z: 0 }, 10_200)
		assert.equal(r.sent.length, 1)
		r.tick({ x: 0.1, y: 0, z: 0 }, 10_400)
		assert.equal(r.sent.length, 2)
		// the band is measured against the last SENT aim, so a slow drift still arrives
		r.tick({ x: 0.13, y: 0, z: 0 }, 10_600)
		assert.equal(r.sent.length, 2)
		r.tick({ x: 0.25, y: 0, z: 0 }, 10_800)
		assert.equal(r.sent.length, 3)
	})

	it('home goes out once on entering home; null sends nothing; following re-arms it', () => {
		const r = rig({ id: 'c1', enabled: true, host: '127.0.0.1' })
		r.tick(null, 10_000)
		assert.equal(r.sent.length, 0)
		r.tick('home', 10_000)
		r.tick('home', 10_500)
		r.tick('home', 12_000)
		assert.equal(r.sent.length, 1)
		assert.equal(hex(r.sent[0].buf), '81010604ff')
		assert.equal(r.svc.status()[0].state, 'home')
		r.tick(null, 13_000)
		assert.equal(r.sent.length, 1)
		assert.equal(r.svc.status()[0].state, 'home') // null leaves the camera where it is
		r.tick({ x: 1, y: 1, z: 0 }, 14_000)
		assert.equal(r.sent.length, 2)
		r.tick('home', 15_000)
		assert.equal(r.sent.length, 3)
		assert.equal(hex(r.sent[2].buf), '81010604ff')
	})

	it('a home preset recalls it instead of the Home command', () => {
		const r = rig({ id: 'c1', enabled: true, host: '127.0.0.1', home: { preset: 3 } })
		r.tick('home', 10_000)
		assert.equal(hex(r.sent[0].buf), '8101043f0203ff')
	})

	it('a fixed zoom goes out once with the first aim', () => {
		const r = rig({ id: 'c1', enabled: true, host: '127.0.0.1', zoom: 0x2000 })
		r.tick({ x: 0, y: 0, z: 0 }, 10_000)
		r.tick({ x: 3, y: 0, z: 0 }, 10_200)
		assert.equal(r.sent.length, 3) // pan-tilt, zoom, pan-tilt
		assert.equal(hex(r.sent[1].buf), '81010447' + '02000000' + 'ff')
	})

	it('disabled cameras are never sent to; cameras() lists them with their flags', () => {
		const r = rig({ id: 'off', host: '127.0.0.1', auto: true }, { id: 'on', enabled: true, host: '127.0.0.1' })
		r.tick({ x: 0, y: 0, z: 0 }, 10_000)
		r.tick('home', 10_500)
		assert.equal(r.sent.length, 2) // 'on' only: pan-tilt then home
		assert.deepEqual(r.svc.cameras(), [
			{ id: 'off', name: 'PTZ 1', enabled: false, auto: true },
			{ id: 'on', name: 'PTZ 2', enabled: true, auto: false },
		])
		const st = r.svc.status()
		assert.equal(st[0].state, 'disabled')
		assert.equal(st[0].last_sent_ms_ago, null)
	})

	it('a bad host or port leaves an error in status() and sends nothing', () => {
		const r = rig(
			{ id: 'a', enabled: true, host: '' },
			{ id: 'b', enabled: true, host: 'not a host!' },
			{ id: 'c', enabled: true, host: '127.0.0.1', port: 'x' }
		)
		assert.doesNotThrow(() => r.tick({ x: 0, y: 0, z: 0 }, 10_000))
		assert.equal(r.sent.length, 1) // c has a default port
		const st = r.svc.status()
		assert.match(st[0].error, /no host/)
		assert.match(st[1].error, /bad host/)
		assert.equal(st[0].state, 'error')
		assert.equal(st[2].error, null)
	})

	it('a throwing send is an error in status(), not an exception; a throwing targetOf is survived', () => {
		const svc = createPtzService({
			send: () => {
				throw new Error('boom')
			},
			now: () => 1,
		})
		svc.configure(project({ id: 'c1', enabled: true, host: '127.0.0.1' }))
		assert.doesNotThrow(() => svc.step(1, () => ({ x: 0, y: 0, z: 0 })))
		assert.match(svc.status()[0].error, /boom/)
		assert.doesNotThrow(() =>
			svc.step(5000, () => {
				throw new Error('x')
			})
		)
	})

	it('visca-ip sends the Sony RESET before the first command, then counts the sequence from 0', () => {
		const r = rig({ id: 'c1', enabled: true, host: '127.0.0.1', protocol: 'visca-ip' })
		r.tick({ x: 0, y: 0, z: 0 }, 10_000)
		r.tick({ x: 6, y: 0, z: 0 }, 10_200)
		assert.equal(r.sent.length, 3)
		assert.equal(hex(r.sent[0].buf), '0200000100000000' + '01')
		assert.equal(r.sent[1].buf.readUInt16BE(0), 0x0100)
		assert.equal(r.sent[1].buf.readUInt32BE(4), 0)
		assert.equal(r.sent[2].buf.readUInt32BE(4), 1)
		assert.equal(r.sent[1].port, 52381)
	})

	it('configure() with a changed host starts over; the same config keeps state', () => {
		const r = rig({ id: 'c1', enabled: true, host: '127.0.0.1' })
		r.tick('home', 10_000)
		r.svc.configure(project({ id: 'c1', enabled: true, host: '127.0.0.1' }))
		r.tick('home', 10_500)
		assert.equal(r.sent.length, 1)
		r.svc.configure(project({ id: 'c1', enabled: true, host: '127.0.0.2' }))
		r.tick('home', 11_000)
		assert.equal(r.sent.length, 2)
		r.svc.configure({})
		assert.deepEqual(r.svc.cameras(), [])
	})
})

/** Receive `n` datagrams on 127.0.0.1:random. */
function listener() {
	const s = dgram.createSocket('udp4')
	const got = []
	const waiters = []
	s.on('message', (m) => {
		got.push(Buffer.from(m))
		for (const w of [...waiters]) if (got.length >= w.n) (waiters.splice(waiters.indexOf(w), 1), w.res())
	})
	return new Promise((res) =>
		s.bind(0, '127.0.0.1', () =>
			res({
				port: s.address().port,
				got,
				until: (n) => (got.length >= n ? Promise.resolve() : new Promise((r) => waiters.push({ n, res: r }))),
				close: () => s.close(),
			})
		)
	)
}

describe('WO-711 real UDP round trip on 127.0.0.1', () => {
	it('visca-udp and visca-ip both arrive as the documented bytes', async () => {
		const udp = await listener()
		const ip = await listener()
		const svc = createPtzService({ now: () => 1_000 })
		svc.configure(
			project(
				{
					id: 'raw',
					enabled: true,
					host: '127.0.0.1',
					port: udp.port,
					protocol: 'visca-udp',
					pose: { x: 0, y: -8, z: 2.5, yaw: 0 },
				},
				{
					id: 'sony',
					enabled: true,
					host: '127.0.0.1',
					port: ip.port,
					protocol: 'visca-ip',
					address: 1,
					pose: { x: 0, y: -8, z: 2.5, yaw: 0 },
				}
			)
		)
		const timeout = setTimeout(() => assert.fail('no datagrams within 3 s'), 3000)
		try {
			svc.step(1_000, () => ({ x: 4, y: 0, z: 0 }))
			svc.step(2_000, () => 'home')
			await Promise.all([udp.until(2), ip.until(3)])
			const c = cam({ pose: { x: 0, y: -8, z: 2.5, yaw: 0 } })
			const a = model.aimAngles(c, { x: 4, y: 0, z: 0 })
			const move = visca.panTiltAbsolute(1, model.toUnits(c.pan, a.pan), model.toUnits(c.tilt, a.tilt), 12, 10)
			assert.equal(hex(udp.got[0]), hex(move))
			assert.equal(hex(udp.got[1]), '81010604ff')
			assert.equal(hex(ip.got[0]), '0200000100000000' + '01')
			assert.equal(hex(ip.got[1]), hex(visca.ipCommand(move, 0)))
			assert.equal(hex(ip.got[2]), hex(visca.ipCommand(visca.home(1), 1)))
			assert.ok(svc.status().every((s) => s.error === null))
		} finally {
			clearTimeout(timeout)
			svc.close()
			udp.close()
			ip.close()
		}
	})

	it('close() releases the socket and later steps send nothing', async () => {
		const l = await listener()
		const svc = createPtzService({ now: () => 1 })
		svc.configure(project({ id: 'c', enabled: true, host: '127.0.0.1', port: l.port }))
		svc.step(1, () => 'home')
		await l.until(1)
		svc.close()
		assert.doesNotThrow(() => svc.step(5_000, () => ({ x: 0, y: 0, z: 0 })))
		await new Promise((r) => setTimeout(r, 50))
		assert.equal(l.got.length, 1)
		l.close()
	})
})
