'use strict'

/**
 * WO-616 T11 — follow: tracking markers → moving-head pan / tilt → Art-Net (src/fixtures/).
 * ArtDmx bytes, the IK (round trip, nearest solution, ranges), the patch rules, the 44 Hz engine
 * (master off = silence, hold on stale, refresh), a real loopback UDP capture, and the project-change hook.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('dgram')
const fs = require('fs')
const path = require('path')

const { encodeArtDmx, decodeArtDmx, parseDest, ArtnetSender } = require('../../src/fixtures/artdmx')
const { normalizePatch, parseFixed } = require('../../src/fixtures/follow-patch')
const { aim, beam, axisBytes } = require('../../src/fixtures/follow-ik')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { CLIENT_OWNED_SLICES } = require('../../src/engine/project-client-slices')
const { onProjectChanged } = require('../../src/engine/project-events')

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const FX = (o = {}) => ({ id: 'a', name: 'Spot A', universe: 3, address: 11, dest: '10.0.0.9',
	pose: { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 }, follow: 1, aim_z: 0, ...o })

describe('WO-616 T11 follow → Art-Net', () => {
	it('ArtDmx packet bytes (Art-Net 4) and decode round trip', () => {
		const data = new Uint8Array(512)
		data[0] = 7
		data[511] = 255
		const p = encodeArtDmx({ portAddress: 0x1234, sequence: 9, data })
		assert.equal(p.length, 530)
		assert.equal(p.subarray(0, 8).toString('latin1'), 'Art-Net\0')
		assert.deepEqual([...p.subarray(8, 18)], [0x00, 0x50, 0, 14, 9, 0, 0x34, 0x12, 0x02, 0x00])
		const d = decodeArtDmx(p)
		assert.equal(d.portAddress, 0x1234)
		assert.equal(d.data[0], 7)
		assert.equal(d.data[511], 255)
		assert.equal(encodeArtDmx({ portAddress: 1, data: [1, 2, 3] }).length, 22, 'odd length padded to even')
		assert.equal(decodeArtDmx(Buffer.from('nope')), null)
		assert.deepEqual(parseDest('2.0.0.1'), { host: '2.0.0.1', port: 6454 })
		assert.deepEqual(parseDest('127.0.0.1:6455'), { host: '127.0.0.1', port: 6455 })
		assert.equal(parseDest('host.local'), null)
	})

	it('IK: hung head points down at centre, round-trips any reachable target', () => {
		const fx = normalizePatch({ patch: [FX()] }).fixtures[0]
		assert.deepEqual(aim(fx, [0, 0, 0]), { pan: 0, tilt: 0 })
		const up = aim(fx, [0, 6, 0])
		assert.ok(near(up.pan, 0) && near(up.tilt, 45), 'upstage target: tilt +45 toward yaw 0 ' + JSON.stringify(up))
		for (const t of [[3, 2, 0], [-5, -1, 1], [8, 9, 0], [0.5, -7, 1.7]]) {
			const pt = aim(fx, t)
			const b = beam(fx.pose, pt.pan, pt.tilt)
			const d = [t[0], t[1], t[2] - 6]
			const n = Math.hypot(...d)
			assert.ok(b.every((x, i) => near(x, d[i] / n, 1e-9)), `beam → ${t}`)
		}
	})

	it('IK picks the solution nearest the last aim, inside the ranges', () => {
		const fx = normalizePatch({ patch: [FX()] }).fixtures[0]
		const a = aim(fx, [4, 1, 0], { pan: 200, tilt: 0 })
		assert.ok(a.pan > 100 && a.pan <= 270, '540° pan stays on the near side ' + JSON.stringify(a))
		const b = aim(fx, [4, 1, 0], { pan: -200, tilt: 0 })
		assert.ok(b.pan < -100, JSON.stringify(b))
		const narrow = normalizePatch({ patch: [FX({ tilt: { ch: 3, fine: 4, range: 90 } })] }).fixtures[0]
		assert.equal(aim(narrow, [0, 100, 5.9]), null, 'beyond ±45° tilt: unreachable (hold)')
		const floor = normalizePatch({ patch: [FX({ pose: { x: 0, y: 0, z: 0, hang: 'floor', yaw: 0 } })] }).fixtures[0]
		const f = aim(floor, [5, 0, 5])
		assert.ok(near(f.tilt, 45) && near(f.pan, 90), 'standing head: positive pan = clockwise from above ' + JSON.stringify(f))
	})

	it('DMX encoding: 16-bit centre, 8-bit, invert', () => {
		assert.deepEqual(axisBytes({ range: 540, fine: 2 }, 0), [128, 0])
		assert.deepEqual(axisBytes({ range: 540, fine: 0 }, 270), [255])
		assert.deepEqual(axisBytes({ range: 540, fine: 2, invert: true }, -270), [255, 255])
		assert.deepEqual(axisBytes({ range: 270, fine: 0 }, 999), [255], 'clamped')
	})

	it('patch rules: defaults, fixed channels, overlap / bad dest / past 512 are not output', () => {
		const p = normalizePatch({ output: { enabled: true, protocol: 'artnet' }, patch: [FX(), FX({ id: 'b', name: 'Spot B', address: 12 }),
			FX({ id: 'c', dest: 'nowhere' }), FX({ id: 'd', address: 511 }), FX({ id: 'e', universe: 4 })] })
		assert.equal(p.enabled, true)
		assert.equal(normalizePatch({}).enabled, false, 'output starts disabled')
		assert.deepEqual(p.fixtures.map((f) => f.problem === null), [true, false, false, false, true])
		assert.match(p.fixtures[1].problem, /channel 12 already used by Spot A/)
		assert.deepEqual(p.fixtures[0].slots, [10, 11, 12, 13])
		assert.deepEqual(parseFixed('6=255, 7=8 ; 0=1 600=2 x=3 6=128'), [{ ch: 6, value: 128 }, { ch: 7, value: 8 }])
	})

	it('engine: silent while off; follows live, holds stale; 1 s refresh; never loops into the own input', () => {
		let t = 0
		const marks = [{ id: 1, x: 0, y: 6, z: 0, stale: false }]
		const sent = []
		const eng = new FollowEngine({ hub: { now: () => t, list: () => marks }, now: () => t,
			send: (to, pkt) => sent.push({ to, d: decodeArtDmx(pkt) }), isSelfLoop: (to) => to.host === '10.0.0.66' })
		const patch = [FX({ fixed: '5=255' })]
		eng.configure({ output: { enabled: false }, patch })
		assert.equal(eng.tick(), 0)
		assert.equal(sent.length, 0, 'master off: nothing on the wire')
		eng.configure({ output: { enabled: true, protocol: 'artnet' }, patch })
		assert.equal(eng.tick(), 1)
		const d = sent[0].d
		assert.equal(sent[0].to.host, '10.0.0.9')
		assert.equal(d.portAddress, 3)
		const pan = (d.data[10] << 8) | d.data[11]
		const tilt = (d.data[12] << 8) | d.data[13]
		assert.equal(pan, 32768, 'pan centre')
		assert.equal(tilt, Math.round(((45 + 135) / 270) * 65535), 'tilt +45°')
		assert.equal(d.data[14], 255, 'fixed channel 5 → abs 15')
		assert.equal(d.data[0], 0, 'unpatched channels are 0')
		t += 23
		assert.equal(eng.tick(), 0, 'unchanged: no packet')
		marks[0] = { ...marks[0], x: 50, y: -40, stale: true }
		t += 23
		assert.equal(eng.tick(), 0, 'stale marker: hold (same bytes)')
		assert.equal(eng.status().fixtures[0].state, 'holding (stale)')
		t += 1000
		assert.equal(eng.tick(), 1, '1 s refresh')
		assert.deepEqual([...sent[1].d.data], [...d.data])
		eng.configure({ output: { enabled: true, protocol: 'artnet' }, patch: [FX({ dest: '10.0.0.66' })] })
		assert.equal(eng.status().fixtures[0].state, 'not output')
		assert.match(eng.status().fixtures[0].problem, /loop into this box/)
	})

	it('a real ArtDmx reaches a loopback listener', async () => {
		const rx = dgram.createSocket('udp4')
		await new Promise((r) => rx.bind(0, '127.0.0.1', r))
		const got = new Promise((r) => rx.once('message', (m) => r(decodeArtDmx(m))))
		const tx = new ArtnetSender()
		const data = new Uint8Array(512)
		data[42] = 99
		await tx.send({ host: '127.0.0.1', port: rx.address().port }, encodeArtDmx({ portAddress: 300, sequence: 1, data }))
		const d = await got
		tx.close()
		rx.close()
		assert.equal(d.portAddress, 300)
		assert.equal(d.data[42], 99)
	})

	it('wiring: fixtures is a client-owned slice; every project write notifies the engine', () => {
		assert.ok(CLIENT_OWNED_SLICES.includes('fixtures'))
		const seen = []
		const off = onProjectChanged((p) => seen.push(p.name))
		const { scheduleProjectSyncBroadcast } = require('../../src/api/routes-data-project-sync')
		scheduleProjectSyncBroadcast({}, { name: 'Show' })
		off()
		assert.deepEqual(seen, ['Show'])
		const reg = fs.readFileSync(path.join(__dirname, '../../src/tracking/register.js'), 'utf8')
		assert.match(reg, /_follow = createFollowService\(ctx, hub\)/)
		assert.match(reg, /path === '\/api\/tracking\/follow'/)
	})
})
