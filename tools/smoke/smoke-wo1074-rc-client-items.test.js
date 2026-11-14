'use strict'

/**
 * WO-1074 v2 — RC client items (modules/rc-game/client/items.js, rocket.js, protocol.js §2.4, net.js sendEvent): the exact message
 * shapes, the box → roulette → held → use flow against a fake socket, the closed-form rocket path (two clients with
 * different frame timing agree at every server time; it follows the centre line's height up a ramp and down a drop and
 * ends at 5 s), the slick / rocket / pulse own-car hit tests, turbo / shield / spin-out.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')

let PR, NET, IT, RK, TM, P, R, IP

before(async () => {
	PR = await F.load('protocol.js')
	NET = await F.load('net.js')
	IT = await F.load('items.js')
	RK = await F.load('rocket.js')
	TM = await F.load('track-math.js')
	P = await F.load('physics.js')
	R = await F.load('drive-rules.js')
	IP = await F.load('item-play.js')
})

const room = () => TM.prepareTrack(F.roomTrack())
const car = (x, y, z, more = {}) => ({ ...P.createCar({ x, y, z, yaw: 0 }), ...more })

describe('WO-1074 v2 protocol §2.4 (exact shapes)', () => {
	it('client → server: box, use, hit (hazard), hit (pulse)', () => {
		assert.deepEqual(PR.boxMsg(4), { t: 'box', id: 4 })
		const u = PR.useMsg('slick', [1.23456, 0.5, -2.0004], 1.23456)
		assert.deepEqual(u, { t: 'use', item: 'slick', p: [1.235, 0.5, -2], yaw: 1.235 })
		assert.deepEqual(Object.keys(u), ['t', 'item', 'p', 'yaw'])
		assert.deepEqual(PR.hitHazMsg(17), { t: 'hit', hid: 17 })
		assert.deepEqual(PR.hitByMsg(3, 'pulse'), { t: 'hit', by: 3, item: 'pulse' })
		assert.equal(PR.encode(PR.boxMsg(4)), '{"t":"box","id":4}')
	})

	it('server → client: box, item, haz, hazgone, fx; welcome / state boxes + hazards', () => {
		assert.deepEqual(PR.decode('{"t":"box","id":4,"by":3,"until":9000}'), { t: 'box', id: 4, by: 3, until: 9000 })
		assert.deepEqual(PR.decode('{"t":"item","item":"rocket"}'), { t: 'item', item: 'rocket' })
		const h = { t: 'haz', hid: 17, kind: 'slick', by: 3, p: [1, 0, 2], yaw: 1.2, ts: 5000, until: 35000 }
		assert.deepEqual(PR.decode(JSON.stringify(h)), h)
		assert.deepEqual(PR.decode('{"t":"hazgone","hid":17,"hit":5}'), { t: 'hazgone', hid: 17, hit: 5 })
		assert.deepEqual(PR.decode('{"t":"hazgone","hid":17,"hit":null}'), { t: 'hazgone', hid: 17, hit: null })
		assert.deepEqual(PR.decode('{"t":"fx","id":3,"k":"pulse","p":[1,2,3],"ts":7}'), {
			t: 'fx',
			id: 3,
			k: 'pulse',
			p: [1, 2, 3],
			ts: 7,
		})
		const st = {
			phase: 'race',
			boxes: [[0, 9000], ['bad'], [1, 'x']],
			hazards: [h, { hid: 2, kind: 'banana', p: [0, 0, 0], ts: 1 }],
		}
		const w = PR.decode(JSON.stringify({ t: 'welcome', id: 3, state: st }))
		assert.deepEqual(PR.decodeBoxes(w.state.boxes), [[0, 9000]])
		const items = new IT.ItemState()
		items.setBoxes(w.state.boxes)
		items.setHazards(w.state.hazards)
		assert.equal(items.boxTaken(0, 8999), true)
		assert.equal(items.boxTaken(0, 9000), false)
		assert.deepEqual([...items.hazards.keys()], [17], 'unknown hazard kinds dropped')
	})

	it('unknown message types and malformed v2 messages are ignored', () => {
		for (const bad of [
			'{"t":"confetti","x":1}',
			'{"t":"box","id":4}',
			'{"t":"item","item":"mushroom"}',
			'{"t":"haz","hid":1,"kind":"slick","p":[0,0],"ts":1}',
			'{"t":"haz","hid":1,"kind":"slick","p":[0,0,0]}',
			'{"t":"hazgone"}',
			'{"t":"fx","id":1,"k":"lightning"}',
		]) {
			assert.equal(PR.decode(bad), null, bad)
		}
	})
})

describe('WO-1074 v2 box → roulette → held → use (fake socket)', () => {
	it('drives through a box, claims it once, rolls 1 s, holds, uses; server limits respected', () => {
		const T = room()
		const e = F.fakeNetEnv(NET)
		const items = new IT.ItemState()
		const ME = 3
		let landed = null
		/* the session glue in the browser does exactly this per message */
		e.net.env.onMessage = (m) => {
			if (m.t === 'welcome') items.setBoxes(m.state.boxes)
			else if (m.t === 'box') items.onBox(m, ME, e.t)
			else if (m.t === 'item') items.onItem(m, e.t)
		}
		e.net.connect('Ola', '#ff5533')
		const ws = e.sockets[0]
		ws.open()
		assert.equal(e.net.sendEvent(PR.boxMsg(0)), false, 'not before welcome')
		ws.recv({ t: 'welcome', id: ME, state: { phase: 'race', boxes: [[2, 99999]] } })
		ws.sent.length = 0

		const c = car(14, 0, 6)
		assert.equal(items.pickup(T, car(14, 0, 9), e.t), null, 'out of reach')
		const claim = items.pickup(T, c, e.t)
		assert.deepEqual(claim, { t: 'box', id: 1 }, 'the nearest box in reach (taken box 2 skipped)')
		assert.equal(e.net.sendEvent(claim), true)
		assert.equal(items.pickup(T, c, e.t + 50), null, 'never claimed twice while the claim is pending')
		assert.deepEqual(ws.sent, [{ t: 'box', id: 1 }])

		/* another player's claim of box 0: gone for me, no roulette */
		ws.recv({ t: 'box', id: 0, by: 9, until: e.t + 6000 })
		assert.equal(items.rolling, false)
		ws.recv({ t: 'box', id: 1, by: ME, until: e.t + 6000 })
		assert.equal(items.rolling, true, 'my claim won → roulette')
		assert.equal(items.pickup(T, c, e.t + 100), null, 'no claims while rolling')
		e.advance(200)
		ws.recv({ t: 'item', item: 'rocket' })
		for (let k = 0; k < 10; k++) {
			e.advance(100)
			const got = items.tick(e.t)
			if (got) landed = { item: got, at: e.t }
		}
		assert.deepEqual(landed, { item: 'rocket', at: 1000 }, 'lands 1 s after the roulette started')
		assert.equal(items.held, 'rocket')
		assert.equal(items.pickup(T, c, e.t), null, 'no claims while holding')

		const u = items.use({ ...c, yaw: 0 })
		assert.equal(u.item, 'rocket')
		assert.deepEqual(u.msg, { t: 'use', item: 'rocket', p: [14, 0, 6 - IT.ROCKET_AHEAD], yaw: 0 })
		assert.equal(items.held, null)
		assert.equal(items.use(c), null, 'nothing left')
		assert.equal(e.net.sendEvent(u.msg), true)

		/* rate limits: ≤ 10 box / s, ≤ 5 use / s */
		ws.sent.length = 0
		for (let k = 0; k < 100; k++) {
			e.net.sendEvent(PR.boxMsg(k))
			e.net.sendEvent(PR.useMsg('turbo', [0, 0, 0], 0))
			e.advance(10)
		}
		assert.ok(ws.sent.filter((m) => m.t === 'box').length <= 10)
		assert.ok(ws.sent.filter((m) => m.t === 'use').length <= 5)
		assert.ok(ws.sent.filter((m) => m.t === 'box').length >= 8, 'but not starved')
	})

	it('an unanswered claim is retried after 1.5 s; a roulette with no item gives up; slick drops behind', () => {
		const T = room()
		const items = new IT.ItemState()
		const c = car(14, 0, 6)
		assert.deepEqual(items.pickup(T, c, 0), { t: 'box', id: 1 })
		assert.equal(items.pickup(T, c, 1000), null, 'one claim in flight at a time (not box 0 beside it either)')
		assert.ok(items.pickup(T, c, 1600), 'retry')
		items.onBox({ id: 1, by: 3, until: 9000 }, 3, 2000)
		assert.equal(items.tick(5900), null)
		assert.equal(items.rolling, true)
		items.tick(6100)
		assert.equal(items.rolling, false, 'gave up after 4 s without an item')
		items.onItem({ item: 'slick' }, 7000)
		assert.equal(items.tick(8000), 'slick')
		const u = items.use({ ...c, yaw: Math.PI / 2 }) // facing −X → behind is +X
		assert.deepEqual(u.msg.p, [14 + IT.SLICK_BACK, 0, 6])
	})
})

describe('WO-1074 v2 rocket path (closed form, every client agrees)', () => {
	const hz = (p, yaw, ts = 10000, more = {}) => ({ hid: 1, kind: 'rocket', by: 9, p, yaw, ts, until: null, ...more })

	it('two clients with different frame timing agree at the same server time', () => {
		const T = room()
		const h = hz([-3, 0, 7.2], 0)
		const a = new IT.ItemState()
		const b = new IT.ItemState()
		a.addHaz(PR.decodeHaz(h))
		/* client A sees it live and draws at ~60 Hz with jitter; client B joins late (state.hazards) at 23 Hz */
		let t = 10000
		const seenA = new Map()
		while (t < 15200) {
			t += 16.7 + ((t * 7) % 5)
			const r = a.rocketOf(T, a.hazards.get(1), t)
			seenA.set(Math.round(t), r)
		}
		b.setHazards([h])
		for (let t2 = 11000; t2 < 15000; t2 += 43.5) b.rocketOf(T, b.hazards.get(1), t2)
		for (const [ms, ra] of seenA) {
			const rb = b.rocketOf(T, b.hazards.get(1), ms)
			const rc = RK.rocketPose(T, h, ms)
			if (!ra) {
				assert.equal(rb, null)
				continue
			}
			const ra2 = a.rocketOf(T, a.hazards.get(1), ms)
			assert.deepEqual(rb, ra2, `agree at ${ms}`)
			assert.deepEqual(rc, ra2, 'cached path = fresh path')
		}
	})

	it('follows the centre line: up the ramp, across the stage, down the drop; offsets fade in 0.5 s; gone at 5 s', () => {
		const T = room()
		const h = hz([-2.5, 0.2, 7.2], 0)
		const path = RK.rocketPath(T, h)
		assert.equal(path.dir, 1)
		assert.ok(Math.abs(path.lat + 0.5) < 0.05 || Math.abs(path.lat - 0.5) < 0.05)
		const at = (sec) => RK.rocketPose(T, h, 10000 + sec * 1000, path)
		const p0 = at(0)
		assert.ok(Math.abs(p0.x - -2.5) < 0.02 && Math.abs(p0.y - (0.2 + RK.ROCKET_HOVER)) < 0.02, 'starts at p (+ hover)')
		/* t 0.3 s: 7.8 m on → z ≈ −0.6, on the ramp: y = 1.4 · 2.6 / 6; the lateral/height offsets are at 40 % */
		const r = at(0.3)
		const want = (1.4 * (2 - r.z)) / 6
		assert.ok(Math.abs(r.y - (want + 0.2 * 0.4 + RK.ROCKET_HOVER)) < 0.03, `on the ramp: ${r.y} vs ${want}`)
		assert.ok(Math.abs(r.x - (-3 + 0.5 * 0.4)) < 0.03, `lateral offset fading (${r.x})`)
		assert.ok(Math.abs(r.yaw) < 1e-6, 'yaw along −Z')
		const s = at(0.5) // 13 m on: z ≈ −5.8, on the stage before the turn; offsets faded out
		assert.ok(
			Math.abs(s.x - -3) < 0.02 && Math.abs(s.y - (1.4 + RK.ROCKET_HOVER)) < 0.02,
			'on the centre line of the stage'
		)
		/* the drop: after the ledge the rocket is back at hall height */
		const ledgeS = T.cumS[T.drops[0].at]
		const landS = T.cumS[T.drops[0].land]
		const tAt = (sArc) => (sArc - path.s0) / RK.ROCKET_SPEED
		assert.ok(Math.abs(at(tAt(ledgeS) - 0.01).y - (1.4 + RK.ROCKET_HOVER)) < 0.05, 'stage height up to the ledge')
		assert.ok(Math.abs(at(tAt(landS)).y - RK.ROCKET_HOVER) < 0.02, 'hall height after the drop')
		assert.ok(at(4.99) && at(5.01) === null, 'ends at 5 s')
		assert.equal(RK.rocketPose(T, { ...h, until: 12000 }, 12000), null, 'or at until')
		assert.ok(RK.rocketPose(T, h, 9000), 'before ts: at the start (clock skew)')
	})

	it('fired backwards it flies backwards; on an open track it ends at the line end', () => {
		const T = room()
		const back = RK.rocketPath(T, hz([-3, 0, 6], Math.PI))
		assert.equal(back.dir, -1)
		const S = TM.prepareTrack(F.straightTrack(50))
		const h = hz([0, 0, -45], 0)
		assert.ok(RK.rocketPose(S, h, 10000 + 150))
		assert.equal(RK.rocketPose(S, h, 10000 + 300), null, 'past the end (5 m left at 26 m/s)')
	})
})

describe('WO-1074 v2 hazard + pulse hit tests', () => {
	it('slick: grounded, ≤ 1 m in plan, same height; reported once; own fresh puddle safe; spinning / immune skipped', () => {
		const T = room()
		const items = new IT.ItemState()
		items.addHaz(PR.decodeHaz({ hid: 5, kind: 'slick', by: 9, p: [14, 0, 0], yaw: 0, ts: 1000, until: 31000 }))
		assert.equal(items.hazardHit(T, car(14, 0, 1.2), 3, 2000), null, '1.2 m away')
		assert.equal(items.hazardHit(T, car(14, 0, 0.9, { grounded: false }), 3, 2000), null, 'jumping over')
		assert.equal(items.hazardHit(T, car(14, 1.4, 0.9), 3, 2000), null, 'a floor above')
		assert.equal(items.hazardHit(T, car(14, 0, 0.9, { immune: 1 }), 3, 2000), null, 'immune')
		assert.equal(items.hazardHit(T, car(14, 0, 0.9), 3, 2000), 5)
		assert.equal(items.hazardHit(T, car(14, 0, 0.9), 3, 2100), null, 'reported once')
		const own = new IT.ItemState()
		own.addHaz(PR.decodeHaz({ hid: 6, kind: 'slick', by: 3, p: [14, 0, 0], yaw: 0, ts: 1000 }))
		assert.equal(own.hazardHit(T, car(14, 0, 0), 3, 1500), null, 'own puddle: safe for 1 s')
		assert.equal(own.hazardHit(T, car(14, 0, 0), 3, 2100), 6)
		const old = new IT.ItemState()
		old.addHaz(PR.decodeHaz({ hid: 7, kind: 'slick', by: 9, p: [14, 0, 0], yaw: 0, ts: 1000, until: 5000 }))
		assert.equal(old.hazardHit(T, car(14, 0, 0), 3, 5000), null, 'expired at until')
	})

	it('rocket: within 1.2 m of its pose at the server time; own rocket safe for 0.5 s', () => {
		const T = room()
		const h = { hid: 8, kind: 'rocket', by: 9, p: [-3, 0, 7], yaw: 0, ts: 1000, until: 6000 }
		const items = new IT.ItemState()
		items.addHaz(PR.decodeHaz(h))
		const r = RK.rocketPose(T, h, 1200)
		assert.equal(items.hazardHit(T, car(r.x + 3, 0, r.z), 3, 1200), null, 'beside it')
		assert.equal(items.hazardHit(T, car(r.x, r.y - 0.2 - 0.35, r.z - 0.5), 3, 1200), 8)
		const own = new IT.ItemState()
		own.addHaz(PR.decodeHaz({ ...h, by: 3 }))
		const r0 = RK.rocketPose(T, h, 1100)
		assert.equal(own.hazardHit(T, car(r0.x, 0, r0.z), 3, 1100), null, 'own rocket at launch')
	})

	it('pulse: 7 m 3D radius, never own, not while immune', () => {
		const items = new IT.ItemState()
		const fx = { t: 'fx', id: 9, k: 'pulse', p: [0, 0, 0], ts: 1 }
		assert.equal(items.pulseHits(fx, car(6.9, 0, 0), 3), true)
		assert.equal(items.pulseHits(fx, car(6, 4, 0), 3), false, '3D distance')
		assert.equal(items.pulseHits({ ...fx, id: 3 }, car(1, 0, 0), 3), false, 'own')
		assert.equal(items.pulseHits(fx, car(1, 0, 0, { immune: 1 }), 3), false)
		assert.equal(items.pulseHits({ ...fx, p: null }, car(1, 0, 0), 3), false)
	})

	it('turbo and shield apply at once; a shield absorbs one hit; spin-out → immunity', () => {
		const c = car(0, 0, 0)
		assert.equal(IT.applyOwnUse(c, 'turbo'), true)
		assert.ok(c.boost >= P.PHYS.TURBO - 1e-9 && c.boostKind === 'turbo')
		assert.equal(R.fxFlags(c) & R.FX.BOOST, R.FX.BOOST)
		IT.applyOwnUse(c, 'shield')
		assert.equal(R.fxFlags(c) & R.FX.SHIELD, R.FX.SHIELD)
		assert.equal(R.spinOut(c), 'shield')
		assert.equal(c.shield, 0)
		assert.equal(R.spinOut(c), 'immune', 'brief immunity after the shield pops')
		const d = car(0, 0, 0)
		assert.equal(R.spinOut(d), 'spin')
		assert.equal(R.fxFlags(d) & R.FX.SPIN, R.FX.SPIN)
		assert.equal(IT.applyOwnUse(d, 'rocket'), false, 'rocket / slick / pulse come back from the server')
	})
})

describe('WO-1074 v2 item-play glue (the browser session code, with a fake socket)', () => {
	function session() {
		const e = F.fakeNetEnv(NET)
		const T = room()
		const G = {
			T,
			items: new IT.ItemState(),
			net: e.net,
			meId: 3,
			car: P.createCar({ x: 14, y: 0, z: 6, yaw: 0 }),
			phase: 'race',
		}
		const pops = []
		const sfx = []
		G.hud = { x: { pop: (w) => pops.push(w), banner: (w) => pops.push(w) } }
		G.audio = { sfx: (k) => sfx.push(k) }
		e.net.env.onMessage = (m) => IP.onItemMessage(G, m, e.t)
		e.net.connect('Ola', '#ff5533')
		const ws = e.sockets[0]
		ws.open()
		ws.recv({ t: 'welcome', id: 3, state: { phase: 'race', boxes: [], hazards: [] } })
		ws.sent.length = 0
		return { e, G, ws, pops, sfx }
	}

	it('drive through a box → box sent once → roulette → item → Use sends use and fires a turbo', () => {
		const { e, G, ws, sfx } = session()
		IP.ownCarItems(G, { use: false }, e.t)
		IP.ownCarItems(G, { use: false }, e.t + 16)
		assert.deepEqual(ws.sent, [{ t: 'box', id: 1 }])
		ws.recv({ t: 'box', id: 1, by: 3, until: e.t + 6000 })
		ws.recv({ t: 'item', item: 'turbo' })
		assert.ok(sfx.includes('pickup'))
		IP.ownCarItems(G, { use: true }, e.t + 500)
		assert.equal(ws.sent.length, 1, 'nothing to use while rolling')
		IP.ownCarItems(G, { use: false }, e.t + 1000)
		assert.equal(G.items.held, 'turbo')
		IP.ownCarItems(G, { use: true }, e.t + 1100)
		assert.deepEqual(ws.sent[1], { t: 'use', item: 'turbo', p: [14, 0, 6], yaw: 0 })
		assert.ok(G.car.boost > 0, 'turbo at once')
		assert.equal(G.items.held, null)
	})

	it('a slick under the car → hit {hid} + spin-out; a pulse nearby → hit {by, item} + ZAP; shield blocks', () => {
		const { e, G, ws, pops } = session()
		G.car.x = 0
		G.car.z = 20 // away from the boxes
		ws.recv({ t: 'haz', hid: 17, kind: 'slick', by: 9, p: [0, 0, 20], yaw: 0, ts: e.t, until: e.t + 30000 })
		IP.ownCarItems(G, { use: false }, e.t + 10)
		assert.deepEqual(ws.sent, [{ t: 'hit', hid: 17 }])
		assert.ok(G.car.spin > 0 && pops.includes('BLOOP!'))
		ws.recv({ t: 'hazgone', hid: 17, hit: 3 })
		assert.equal(G.items.hazards.size, 0)
		const c2 = session()
		c2.G.car.x = 0
		c2.G.car.z = 20
		c2.ws.recv({ t: 'fx', id: 9, k: 'pulse', p: [3, 0, 20], ts: 1 })
		assert.deepEqual(c2.ws.sent, [{ t: 'hit', by: 9, item: 'pulse' }])
		assert.ok(c2.G.car.spin > 0 && c2.pops.includes('ZAP!'))
		const c3 = session()
		c3.G.car.x = 0
		c3.G.car.z = 20
		R.giveShield(c3.G.car)
		c3.ws.recv({ t: 'fx', id: 9, k: 'pulse', p: [3, 0, 20], ts: 1 })
		assert.deepEqual(c3.ws.sent, [], 'a blocked pulse is not a hit')
		assert.ok(c3.pops.includes('BLOCKED') && c3.G.car.spin === 0)
		c3.ws.recv({ t: 'fx', id: 9, k: 'teleport', p: [3, 0, 20], ts: 1 })
		c3.ws.recv({ t: 'mystery', x: 1 })
		assert.deepEqual(c3.ws.sent, [], 'unknown types / effects ignored')
	})

	it('start launch: gas in the last 0.35 s → boost; earlier → stall; late or none → nothing', () => {
		const run = (pressAt) => {
			const G = { car: P.createCar({ x: 0, y: 0, z: 0, yaw: 0 }), startAt: 10000 }
			for (let t = 7000; t < 10000; t += 16) IP.launchTick(G, pressAt !== null && t >= pressAt ? 1 : 0, t, true)
			return IP.launchTick(G, 1, 10005, false)
		}
		assert.equal(run(9800), 'boost')
		assert.equal(run(9000), 'stall')
		assert.equal(run(null), 'none')
		const G = { car: P.createCar({ x: 0, y: 0, z: 0, yaw: 0 }), startAt: 10000 }
		IP.launchTick(G, 1, 9900, true)
		assert.equal(IP.launchTick(G, 1, 10005, false), 'boost')
		assert.ok(G.car.boost > 0)
		assert.equal(IP.launchTick(G, 1, 10100, false), null, 'once per start')
	})

	it('catch-up only while racing and never for the leader', () => {
		const G = { car: P.createCar({ x: 0, y: 0, z: 0, yaw: 0 }), phase: 'race' }
		IP.updateCatchup(G, 1, 6)
		assert.equal(G.car.catchup, 0)
		IP.updateCatchup(G, 6, 6)
		assert.ok(Math.abs(G.car.catchup - P.PHYS.CATCHUP_MAX) < 1e-9)
		G.phase = 'lobby'
		IP.updateCatchup(G, 6, 6)
		assert.equal(G.car.catchup, 0)
	})
})
