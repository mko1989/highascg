'use strict'

/**
 * WO-1074 — RC car game, browser client: netcode pure modules (modules/rc-game/client/protocol.js, interp.js, net.js with a fake
 * WebSocket, standings.js, cameras.js) and a physics + lap integration (a simple bot drives a full lap).
 * Message shapes are the ones in work/notes/rc-game-contract.md.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')

const load = F.load

let PR, IN, NET, ST, CAM, TM, PH

before(async () => {
	PR = await load('protocol.js')
	IN = await load('interp.js')
	NET = await load('net.js')
	ST = await load('standings.js')
	CAM = await load('cameras.js')
	TM = await load('track-math.js')
	PH = await load('physics.js')
})

/* a v1 track (2D points + track.y) on purpose: the client still accepts them during the server transition */
const ovalTrack = () => F.ovalTrackV1()

describe('WO-1074 protocol (contract shapes)', () => {
	it('client → server messages carry exactly the contract keys', () => {
		const j = PR.joinMsg('Ola', '#FF5533', false)
		assert.deepEqual(j, { t: 'join', name: 'Ola', color: '#ff5533', spectator: false })
		assert.deepEqual(Object.keys(PR.joinMsg('x', '#000000', true)), ['t', 'name', 'color', 'spectator'])
		assert.deepEqual(PR.readyMsg(true), { t: 'ready', ready: true })
		assert.deepEqual(PR.pingMsg(123), { t: 'ping', c: 123 })
		const s = PR.stateMsg({ x: 1.23456, y: 1.42, z: -3.0001, yaw: 1.2, st: 0.3 }, 4.1234, 2, 1, 3)
		assert.deepEqual(s, { t: 's', p: [1.235, 1.42, -3], yaw: 1.2, v: 4.12, st: 0.3, cp: 2, lap: 1, fx: 3 })
		assert.deepEqual(Object.keys(s), ['t', 'p', 'yaw', 'v', 'st', 'cp', 'lap', 'fx'], 'v2: + fx')
		assert.equal(PR.stateMsg({ x: 0, y: 0, z: 0, yaw: 0, st: 0 }, 0, 0, 0).fx, 0)
		assert.equal(PR.encode(PR.readyMsg(false)), '{"t":"ready","ready":false}')
	})

	it('names: ≤ 16 chars, control characters stripped, never empty; colours #rrggbb', () => {
		assert.equal(PR.sanitizeName('  A\u0000B\u0007C\u009f  '), 'ABC')
		assert.equal(PR.sanitizeName('x'.repeat(40)).length, 16)
		assert.equal(PR.sanitizeName('🚗'.repeat(20)), '🚗'.repeat(16))
		assert.equal(PR.sanitizeName('\u0001\u0002'), 'Player')
		assert.equal(PR.validColor('#ABCdef'), '#abcdef')
		assert.equal(PR.validColor('red'), null)
		assert.equal(PR.joinMsg('a', 'javascript:1').color, '#ffffff')
	})

	it('decodes every server message of the contract', () => {
		const state = {
			enabled: true,
			maxPlayers: 10,
			phase: 'lobby',
			trackId: 'stage-oval',
			laps: 3,
			players: [],
			joinUrls: [],
			sceneRev: 'r',
		}
		const w = PR.decode(
			JSON.stringify({ t: 'welcome', id: 3, state, you: { id: 3, name: 'Ola', color: '#ff5533', slot: 2 } })
		)
		assert.equal(w.t, 'welcome')
		assert.equal(w.you.slot, 2)
		assert.deepEqual(PR.decode('{"t":"full"}'), { t: 'full' })
		assert.deepEqual(PR.decode('{"t":"off"}'), { t: 'off' })
		assert.equal(PR.decode(JSON.stringify({ t: 'state', state })).state.trackId, 'stage-oval')
		const ws = PR.decode(
			JSON.stringify({
				t: 'w',
				ts: 1000,
				cars: [
					[3, 1, 1.42, -2, 0.5, 4.1, 0.3, 19],
					[6, 1, 0, 1, 0, 0, 0],
					[4, 'bad'],
					[5, 0, 0, 0, 0, 0],
				],
			})
		)
		assert.deepEqual(
			ws,
			{
				t: 'w',
				ts: 1000,
				cars: [
					{ id: 3, x: 1, y: 1.42, z: -2, yaw: 0.5, v: 4.1, st: 0.3, fx: 19 },
					{ id: 6, x: 1, y: 0, z: 1, yaw: 0, v: 0, st: 0, fx: 0 },
				],
			},
			'v2 tuples carry fx; v1 tuples → fx 0'
		)
		assert.equal(PR.decode('{"t":"countdown","startAt":5000}').startAt, 5000)
		assert.equal(PR.decode('{"t":"lap","id":3,"lap":1,"ms":23456,"best":23456}').best, 23456)
		const res = PR.decode(
			JSON.stringify({
				t: 'results',
				order: [{ id: 3, name: 'Ola', totalMs: 71234, bestMs: 23011, laps: 3 }],
				final: true,
			})
		)
		assert.equal(res.order[0].totalMs, 71234)
		assert.equal(PR.decode('{"t":"pong","c":123,"s":99999}').s, 99999)
	})

	it('rejects garbage', () => {
		for (const bad of [
			'',
			'nope',
			'[]',
			'{"t":"zz"}',
			'{"t":"w","ts":"x","cars":[]}',
			'{"t":"countdown"}',
			'{"t":"welcome","id":1}',
			'null',
		]) {
			assert.equal(PR.decode(bad), null, bad)
		}
	})

	it('§2.6: lx / lxfull pass decode unchanged; without an `f` list they are dropped', () => {
		const full = {
			t: 'lxfull',
			ts: 5,
			on: true,
			rev: 'abc',
			lights: [{ i: 0, id: 'f0', name: 'Head', p: [0, 5.5, -4], kind: 'spot' }],
			f: [[0, 0, -1, 0, 1, 1, 1, 0.5, 20]],
		}
		assert.deepEqual(PR.decode(JSON.stringify(full)), full)
		const dark = { t: 'lxfull', ts: 6, on: false, rev: 'abc', f: [] }
		assert.deepEqual(PR.decode(JSON.stringify(dark)), dark)
		const lx = { t: 'lx', ts: 7, f: [[0, 1, 0, 0, 1, 0, 0, 1, 12]] }
		assert.deepEqual(PR.decode(JSON.stringify(lx)), lx)
		for (const bad of ['{"t":"lx","ts":1}', '{"t":"lxfull","f":{}}', '{"t":"lx","f":"x"}'])
			assert.equal(PR.decode(bad), null, bad)
	})
})

describe('WO-1074 snapshot interpolation + clock', () => {
	const snap = (x, yaw = 0, v = 0) => ({ x, y: 0, z: 0, yaw, v, st: 0 })

	it('interpolates 100 ms in the past between the surrounding snapshots', () => {
		const b = new IN.SnapshotBuffer()
		b.push(1000, snap(0))
		b.push(1066, snap(1))
		b.push(1133, snap(2))
		const s = b.sample(1133) // render time 1033
		assert.ok(Math.abs(s.x - 0.5) < 0.01, `x ${s.x}`)
		assert.equal(s.extrap, false)
		assert.equal(b.sample(500).x, 0, 'before the first: hold the first')
	})

	it('yaw takes the short way round', () => {
		assert.ok(Math.abs(IN.lerpAngle(3.0, -3.0, 0.5) - Math.PI) < 0.15)
		const b = new IN.SnapshotBuffer({ delay: 0 })
		b.push(0, snap(0, 3.1))
		b.push(100, snap(0, -3.1))
		const y = b.sample(50).yaw
		assert.ok(Math.abs(Math.abs(y) - Math.PI) < 0.05, `yaw ${y}`)
	})

	it('extrapolates at most 200 ms and ignores stale / duplicate snapshots', () => {
		const b = new IN.SnapshotBuffer()
		b.push(0, snap(0))
		b.push(100, snap(1)) // 10 m/s along +X
		assert.equal(b.push(100, snap(5)), false)
		assert.equal(b.push(50, snap(5)), false)
		const s = b.sample(100 + 100 + 150) // render 250 = 150 ms past the last
		assert.equal(s.extrap, true)
		assert.ok(Math.abs(s.x - 2.5) < 1e-6, `x ${s.x}`)
		const far = b.sample(100 + 100 + 5000)
		assert.ok(Math.abs(far.x - 3) < 1e-6, 'capped at +200 ms')
		/* single snapshot: extrapolate along yaw with v */
		const one = new IN.SnapshotBuffer()
		one.push(0, snap(0, 0, 5))
		const e = one.sample(100 + 100)
		assert.ok(Math.abs(e.z - -0.5) < 1e-6, 'yaw 0 faces −Z')
	})

	it('render(): eases small corrections, snaps far jumps', () => {
		const b = new IN.SnapshotBuffer({ delay: 0 })
		b.push(0, snap(0))
		b.push(100, snap(0))
		assert.equal(b.render(100, 0).x, 0)
		b.push(200, snap(0.5))
		const mid = b.render(200, 16).x
		assert.ok(mid > 0 && mid < 0.5, `eased ${mid}`)
		b.push(300, snap(20))
		assert.equal(b.render(300, 32).x, 20, 'snapped')
	})

	it('ClockSync uses the lowest-RTT sample', () => {
		const c = new IN.ClockSync()
		assert.equal(c.synced, false)
		const OFFSET = 50000
		c.sample(0, 0 + 10 + OFFSET, 20) // rtt 20, symmetric
		c.sample(100, 100 + 150 + OFFSET, 400) // rtt 300, asymmetric (queued)
		assert.equal(c.synced, true)
		assert.ok(Math.abs(c.offset - OFFSET) < 1e-9)
		assert.equal(c.now(1000), 1000 + OFFSET)
		c.sample(10, Number.NaN, 20)
		assert.ok(Math.abs(c.offset - OFFSET) < 1e-9)
	})
})

const fakeEnv = () => F.fakeNetEnv(NET)

describe('WO-1074 RcNet (fake WebSocket)', () => {
	const state = { enabled: true, phase: 'lobby', players: [] }

	it('ws URL is /api/game/rc/ws on the page host', () => {
		assert.equal(NET.wsUrlFor({ protocol: 'http:', host: '192.168.1.17:4200' }), 'ws://192.168.1.17:4200/api/game/rc/ws')
		assert.equal(NET.wsUrlFor({ protocol: 'https:', host: 'x' }), 'wss://x/api/game/rc/ws')
	})

	it('joins on open, pings, syncs the clock, throttles own state', () => {
		const e = fakeEnv()
		e.net.connect('Ola', '#ff5533')
		const ws = e.sockets[0]
		ws.open()
		assert.deepEqual(ws.sent[0], { t: 'join', name: 'Ola', color: '#ff5533', spectator: false })
		assert.equal(ws.sent[1].t, 'ping')
		ws.recv({ t: 'pong', c: ws.sent[1].c, s: 90000 })
		assert.ok(e.net.clock.synced)
		ws.recv({ t: 'welcome', id: 3, state, you: { id: 3, slot: 0 } })
		assert.equal(e.net.status, 'joined')
		const car = { x: 1, y: 0, z: 2, yaw: 0, st: 0 }
		ws.sent.length = 0
		assert.equal(e.net.sendState(PR.stateMsg(car, 1, 0, 0)), true)
		assert.equal(e.net.sendState(PR.stateMsg({ ...car, x: 2 }, 1, 0, 0)), false, '< 60 ms later')
		e.advance(70)
		assert.equal(e.net.sendState(PR.stateMsg({ ...car, x: 2 }, 1, 0, 0)), true)
		e.advance(70)
		assert.equal(e.net.sendState(PR.stateMsg({ ...car, x: 2 }, 1, 0, 0)), false, 'unchanged → no resend')
		e.advance(1000)
		assert.equal(e.net.sendState(PR.stateMsg({ ...car, x: 2 }, 1, 0, 0)), true, '1 s keepalive')
		assert.ok(ws.sent.filter((m) => m.t === 's').length === 3)
		/* never faster than 20 Hz over a burst */
		ws.sent.length = 0
		for (let i = 0; i < 100; i++) {
			e.advance(10)
			e.net.sendState(PR.stateMsg({ ...car, x: i }, 1, 0, 0))
		}
		assert.ok(ws.sent.filter((m) => m.t === 's').length <= 20, 'at most 20 per second')
		e.net.setReady(true)
		assert.deepEqual(ws.sent[ws.sent.length - 1], { t: 'ready', ready: true })
	})

	it('reconnects with backoff after a drop and rejoins', () => {
		const e = fakeEnv()
		e.net.connect('Ola', '#ff5533')
		e.sockets[0].open()
		e.sockets[0].drop(1006)
		assert.equal(e.net.status, 'closed')
		e.advance(499)
		assert.equal(e.sockets.length, 1)
		e.advance(1)
		assert.equal(e.sockets.length, 2, 'retry after 500 ms')
		e.sockets[1].drop(1006)
		e.advance(999)
		assert.equal(e.sockets.length, 2)
		e.advance(1)
		assert.equal(e.sockets.length, 3, 'then 1 s')
		e.sockets[2].open()
		assert.equal(e.sockets[2].sent[0].t, 'join')
		e.sockets[2].recv({ t: 'welcome', id: 1, state })
		assert.equal(e.net.attempt, 0, 'backoff reset after welcome')
	})

	it('full / off / 4403 / kicked stop reconnecting', () => {
		for (const [how, want] of [
			['full', 'full'],
			['off', 'off'],
			[4403, 'off'],
			[4409, 'kicked'],
		]) {
			const e = fakeEnv()
			e.net.connect('A', '#000000')
			e.sockets[0].open()
			if (typeof how === 'string') {
				e.sockets[0].recv({ t: how })
				e.sockets[0].drop(1000)
			} else e.sockets[0].drop(how)
			assert.equal(e.net.status, want, String(how))
			e.advance(60000)
			assert.equal(e.sockets.length, 1, `${how}: no reconnect`)
		}
	})

	it('other closes (4408 silent after a phone slept, 1013 busy) reconnect', () => {
		for (const code of [4408, 1013, 1000]) {
			const e = fakeEnv()
			e.net.connect('A', '#000000')
			e.sockets[0].open()
			e.sockets[0].drop(code)
			assert.equal(e.net.status, 'closed', String(code))
			e.advance(600)
			assert.equal(e.sockets.length, 2, `${code}: reconnected`)
		}
	})

	it('§2.6: binary frames (wall pictures) go to onBinary as ArrayBuffer / Blob, never to decode / onMessage', () => {
		const e = fakeEnv()
		const bins = []
		e.net.env.onBinary = (d) => bins.push(d)
		e.net.connect('A', '#000000')
		const ws = e.sockets[0]
		assert.equal(ws.binaryType, 'arraybuffer')
		ws.open()
		const frame = new Uint8Array([4, 112, 103, 109, 49, 0xff, 0xd8, 0xff, 0xd9]).buffer // [u8 n][pgm1][JPEG]
		const blob = new Blob([new Uint8Array(frame)])
		ws.onmessage({ data: frame })
		ws.onmessage({ data: blob })
		assert.equal(bins.length, 2)
		assert.equal(bins[0], frame)
		assert.equal(bins[1], blob)
		assert.equal(e.messages.length, 0, 'not decoded')
		ws.recv({ t: 'lx', ts: 1, f: [] })
		assert.deepEqual(e.messages, [{ t: 'lx', ts: 1, f: [] }])
		assert.equal(bins.length, 2, 'JSON never reaches onBinary')
		delete e.net.env.onBinary // no stage fx: a picture is dropped, not decoded
		ws.onmessage({ data: frame })
		assert.equal(e.messages.length, 1)
	})

	it('spectators join with spectator: true', () => {
		const e = fakeEnv()
		e.net.connect('Spectator', '#ffffff', true)
		e.sockets[0].open()
		assert.equal(e.sockets[0].sent[0].spectator, true)
	})
})

describe('WO-1074 standings + director', () => {
	it('orders cars by progress; a car behind the start line at lap 0 is last', () => {
		const T = TM.prepareTrack(ovalTrack())
		const r = new ST.RaceTracker(T)
		const at = (s) => TM.pointAt(T, s)
		let p = at(-0.5)
		r.move('behind', p.x, p.z, 0, true)
		p = at(3)
		r.move('ahead', p.x, p.z, 0, true)
		p = at(1)
		r.move('mid', p.x, p.z, 0, true)
		assert.deepEqual(r.order(), ['ahead', 'mid', 'behind'])
		/* server lap message wins */
		r.serverLap('behind', 1)
		r.move('behind', at(-0.4).x, at(-0.4).z, 10)
		assert.equal(r.order()[0], 'behind')
		/* a teleport-sized jump across gates (respawn, grid placement, snapshot snap) never counts */
		const j = new ST.RaceTracker(T)
		j.move('t', at(T.cpS[1] - 0.3).x, at(T.cpS[1] - 0.3).z, 0, true)
		assert.ok(ST.MAX_STEP_M >= (24 * 150) / 1000, 'v2: a 24 m/s car over a slow 150 ms frame is not a teleport')
		assert.equal(j.move('t', at(T.cpS[1] + 4.8).x, at(T.cpS[1] + 4.8).z, 1), null)
		assert.equal(j.cars.get('t').lap.cp, 0)
		assert.equal(j.move('t', at(T.cpS[2] - 0.1).x, at(T.cpS[2] - 0.1).z, 2), null)
		r.finish('mid', 60000)
		assert.equal(r.order()[0], 'mid', 'finished first')
		assert.equal(r.positionOf('mid'), 1)
		assert.equal(r.positionOf('nobody'), 0)
	})

	it('a simple bot drives a whole lap of the oval through the physics and the race tracker', () => {
		const T = TM.prepareTrack(ovalTrack())
		const env = PH.createEnv(T, [{ id: 'stage', y: 1.42, rect: [-12, -9, 12, 9] }], [])
		const car = PH.createCar(TM.gridPose(T, 0))
		const r = new ST.RaceTracker(T)
		r.reset(0)
		r.move('me', car.x, car.z, 0, true, car.y)
		let laps = 0
		let off = 0
		let hint = -1
		for (let i = 0; i < 60 * 60 && laps < 1; i++) {
			const n = TM.nearestOnTrack(T, car.x, car.z, hint)
			hint = n.seg
			const tgt = TM.pointAt(T, n.s + 1.6)
			const want = Math.atan2(-(tgt.x - car.x), -(tgt.z - car.z))
			let err = want - car.yaw
			while (err > Math.PI) err -= 2 * Math.PI
			while (err < -Math.PI) err += 2 * Math.PI
			const v = PH.forwardSpeed(car)
			PH.stepCar(car, { throttle: v < 5.5 ? 1 : 0, brake: v > 7 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 3)) }, env)
			if (!car.onTrack) off++
			const ev = r.move('me', car.x, car.z, (i * 1000) / 60, false, car.y)
			if (ev?.type === 'lap') laps = ev.lap
		}
		assert.equal(laps, 1, 'completed a lap')
		assert.ok(off < 60, `mostly on the asphalt (${off} off-track steps)`)
		const lap = r.cars.get('me').lap
		assert.ok(lap.lastMs > (T.total / 9) * 1000, `lap time ${lap.lastMs} ms is plausible (not faster than top speed)`)
	})

	it('chase camera sits behind the car; director is deterministic and always returns a pose', () => {
		const c = CAM.chaseTarget({ x: 0, y: 0, z: 0, yaw: 0 }, 5)
		assert.ok(c.eye[2] > 0, 'behind = +Z when facing −Z')
		assert.ok(c.target[2] < 0, 'looks ahead')
		const T = TM.prepareTrack(ovalTrack())
		const cars = { a: { x: 8, y: 1.42, z: 0, yaw: 0, v: 5 }, b: { x: -8, y: 1.42, z: 0, yaw: Math.PI, v: 4 } }
		const run = () => {
			const d = new CAM.Director(42)
			const out = []
			for (let t = 0; t < 40; t += 0.5) {
				const p = d.update(t, 0.5, T, ['a', 'b'], (id) => cars[id] || null)
				assert.ok(p.eye.every(Number.isFinite) && p.target.every(Number.isFinite))
				out.push(d.shot)
			}
			return out
		}
		const a = run()
		assert.deepEqual(a, run())
		assert.ok(new Set(a).size >= 2, 'cuts between shots')
		const empty = new CAM.Director(1).update(0, 0.1, T, [], () => null)
		assert.ok(empty.eye.every(Number.isFinite))
	})
})
