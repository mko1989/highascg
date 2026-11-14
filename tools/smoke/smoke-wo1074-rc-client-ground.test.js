'use strict'

/**
 * WO-1074 v2 — RC client: the ground model (modules/rc-game/client/ground.js, contract §2.1 "Ground model"), 3D track maths and the
 * 3D physics on a synthetic room track (hall + stage + a ramp up + a drop off the stage edge, built in
 * tools/smoke/lib/rc-client-fixtures.js): ground(x, z) everywhere, up the ramp onto the stage, off the ledge (lands on
 * the hall, never tunnels, never NaN), the stage side is a wall from below, obstacles only where heights overlap,
 * auto-unstick, a bot that laps the room track and a flat oval through the real physics + checkpoint logic, v1 tracks.
 * §2.7 on the server generator's furnished-hall tracks: height-aware ground / ceiling / nearest ribbon at a bridge, the
 * deck rails at full boost, bot laps under and over the bridge and round a long deck loop.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')

let P, TM, GR, ST, R

before(async () => {
	P = await F.load('physics.js')
	TM = await F.load('track-math.js')
	GR = await F.load('ground.js')
	ST = await F.load('standings.js')
	R = await F.load('drive-rules.js')
})

const room = () => {
	const T = TM.prepareTrack(F.roomTrack())
	return { T, G: GR.createGround(F.ROOM_FLOORS, T), env: P.createEnv(T, F.ROOM_FLOORS, []) }
}

describe('WO-1074 v2 ground model', () => {
	it('hall, stage, outside every floor', () => {
		const { G } = room()
		assert.equal(GR.groundAt(G, 10, 10), 0, 'hall')
		assert.equal(GR.groundAt(G, 0, -8), 1.4, 'stage (the highest floor wins)')
		assert.equal(GR.groundAt(G, 6, -12), 1.4, 'stage rect edges included')
		assert.equal(GR.groundAt(G, 25, 0), null, 'outside the hall: no ground (a wall)')
		assert.equal(GR.groundAt(G, 0, -15.01), null)
	})

	it('on the ramp: the centre-line height at the nearest point, across the whole ribbon width', () => {
		const { G } = room()
		for (const [z, want] of [
			[1, (1.4 * 1) / 6],
			[-1, (1.4 * 3) / 6],
			[-3.5, (1.4 * 5.5) / 6],
		]) {
			for (const dx of [0, 1.2, -1.4]) {
				const y = GR.groundAt(G, -3 + dx, z)
				assert.ok(Math.abs(y - want) < 0.03, `ramp at z ${z}, x offset ${dx}: ${y} vs ${want}`)
			}
		}
		const R0 = G.ramps[0]
		assert.equal(GR.rampSurfaceY(R0, -3, 4), null, 'before the ramp start: not on it')
		/* regression (headless run): just before the foot, a LATER segment's clamped start (within the half-width)
		 * must not win over the first segment's end — that made a ~5 cm step that launched cars at the foot */
		const foot = R0.segs[0].az // §2.7: within END_TOL (5 cm) of the foot still carries
		for (const d of [0.06, 0.4, 0.9, 1.4]) {
			for (const dx of [0, 1]) {
				assert.equal(GR.rampSurfaceY(R0, -3 + dx, foot + d), null, `${d} m before the foot, x offset ${dx}`)
				assert.equal(GR.groundAt(G, -3 + dx, foot + d), 0)
			}
		}
		assert.equal(GR.rampSurfaceY(R0, -3 + 1.6, -1), null, 'beside its footprint (half-width 1.5): not on it')
	})

	it('beside / under a ramp: the hall beside it, the ramp (a solid wedge) inside its footprint', () => {
		const { G } = room()
		assert.equal(GR.groundAt(G, -3 + 1.7, -2), 0, 'beside the ramp: hall floor')
		const under = GR.groundAt(G, -3, -2)
		assert.ok(under > 0.8, 'inside the footprint the ground is the ramp surface')
		assert.ok(GR.blockedAt(G, -3, -2, 0), 'so a car at hall height there meets a wall (the skirt)')
		assert.ok(!GR.blockedAt(G, -3, 1.5, 0), 'the low end of the ramp is drivable from the hall')
		assert.equal(GR.floorOnlyAt(G, -3, -2), 0, 'the skirt goes down to the hall floor')
		/* no other track's ramps: a different active track has no ramp there */
		const flat = GR.createGround(F.ROOM_FLOORS, TM.prepareTrack(F.ovalTrack()))
		assert.equal(GR.groundAt(flat, -3, -2), 0)
	})

	it('v1 tracks ([x, z] + track.y) are converted on load; missing pads / boxes / ramps / drops = none', () => {
		const T = TM.prepareTrack(F.ovalTrackV1())
		assert.equal(T.ys.length, T.n)
		assert.ok(T.ys.every((y) => y === 1.42))
		assert.deepEqual([T.ramps, T.drops, T.pads, T.boxes], [[], [], [], []])
		assert.equal(TM.gridPose(T, 0).y, 1.42)
		assert.equal(TM.respawnPose(T, 2).y, 1.42)
		const odd = TM.normalizeTrack({
			points: [
				[0, 0, 0],
				[1, 0, 0],
				[2, 0, 0],
			],
			ramps: [{ from: 0, to: 99 }, 'x'],
			boxes: [{ x: 1 }],
		})
		assert.deepEqual([odd.ramps, odd.boxes], [[], []], 'malformed entries dropped')
	})

	it('nearest point is 3D-aware: the hall part is not the stage part above it; pads / boxes / grid get heights', () => {
		const { T } = room()
		/* the ramp top at (−3, −4) is close in plan to stage point (−3, −4.6); a hall car right beside the stage
		 * front never matches the stage ribbon with its height */
		const hi = TM.nearestOnTrack(T, -3, -4.3, -1, 6, 1.4)
		assert.ok(hi.py > 1.2)
		const lo = TM.nearestOnTrack(T, 7, -9.5, -1, 6, 0)
		assert.ok(
			lo.vmiss === 0 && lo.py === 0 && lo.seg >= T.drops[0].at && lo.seg < T.drops[0].land,
			'past the ledge: the landing zone'
		)
		assert.equal(TM.isOnTrack(T, 0, -9.5, -1, 1.4), true)
		assert.equal(TM.isOnTrack(T, 0, -9.5, -1, 3.5), false, 'far above the ribbon: not on it')
		assert.equal(T.pads[0].y, 0)
		assert.ok(T.boxes.every((b) => b.y === 0.5))
		const g = TM.gridPose(T, 0)
		assert.ok(Math.abs(g.y) < 1e-9)
		assert.equal(T.segStep[T.drops[0].at], 1, 'the ledge segment is a step')
	})

	it('an overpass (figure-eight with one lobe raised 1.4 m): height picks the right part where the plan overlaps', () => {
		const raw = F.eightTrack(8, 160)
		raw.points = raw.points.map(([x, , z], i) => [x, 0.7 + 0.7 * Math.cos(((i - 40) / 160) * 2 * Math.PI), z])
		const T = TM.prepareTrack(raw)
		const up = TM.nearestOnTrack(T, 0, 0, -1, 6, 1.4)
		const dn = TM.nearestOnTrack(T, 0, 0, -1, 6, 0)
		assert.ok(Math.abs(up.seg - 40) <= 1 && up.vmiss === 0, `on the bridge: seg ${up.seg}`)
		assert.ok(Math.abs(dn.seg - 120) <= 1 && dn.vmiss === 0, `under it: seg ${dn.seg}`)
		/* gates: the bridge gate (k = 1, point 40) is not crossed by a car driving underneath */
		const g = TM.gateOf(T, 1)
		assert.equal(g.y > 1.3, true)
		const [ax, az, bx, bz] = [g.x - g.tx * 0.3, g.z - g.tz * 0.3, g.x + g.tx * 0.3, g.z + g.tz * 0.3]
		assert.equal(TM.gateCrossing(T, 1, ax, az, bx, bz, 1.4, 1.4), 1, 'on the bridge: counts')
		assert.equal(TM.gateCrossing(T, 1, ax, az, bx, bz, 0, 0), 0, 'underneath: does not')
	})
})

describe('WO-1074 v2 3D physics', () => {
	it('drives up the ramp onto the stage, then off the drop: lands on the hall, never tunnels, never NaN', () => {
		for (const speed of [6, 13, 18]) {
			const { T, env } = room()
			const car = P.createCar({ x: -3, y: 0, z: 8, yaw: 0 })
			let hint = -1
			let onStage = false
			let flew = false
			let landed = false
			const laneY = []
			for (let i = 0; i < 60 * 12; i++) {
				const b = F.botInput(TM, P, T, car, hint)
				hint = b.near.seg
				if (speed === 18 && P.forwardSpeed(car) > 12) R.giveBoost(car, 0.1)
				b.input.throttle = P.forwardSpeed(car) < speed ? 1 : 0
				P.stepCar(car, b.input, env)
				assert.ok([car.x, car.y, car.z, car.vx, car.vy, car.vz].every(Number.isFinite), `finite at ${i}`)
				const g = P.groundOf(env, car.x, car.z)
				assert.ok(g !== null, 'always above some floor')
				assert.ok(car.y >= g - 1e-6, `never below the ground (${car.y} < ${g}) at ${i}`)
				if (car.y > 1.39 && car.z < -4.2) onStage = true
				if (onStage && !car.grounded) flew = true
				if (car.ev.some((e) => e.k === 'land') && car.x > 6) landed = true
				car.ev.length = 0
				laneY.push(car.y)
				if (landed && car.z > -6) break
			}
			assert.ok(onStage, `${speed} m/s: reached the stage`)
			assert.ok(flew && landed, `${speed} m/s: flew off the ledge and landed in the hall`)
			assert.ok(car.y < 0.05, `${speed} m/s: back on the hall floor (${car.y})`)
		}
	})

	it('the stage side is a wall from below: the car bounces back (≈ 0.4) and stays on the hall floor', () => {
		const { env } = room()
		const car = P.createCar({ x: 3, y: 0, z: 4, yaw: 0 })
		let minZ = Infinity
		let bounced = false
		for (let i = 0; i < 60 * 3; i++) {
			const vz0 = car.vz
			P.stepCar(car, { throttle: i < 90 ? 1 : 0 }, env)
			if (car.ev.some((e) => e.k === 'wall')) {
				bounced = true
				assert.ok(car.vz > 0 && car.vz < -vz0 * 0.5, `restitution ≈ 0.4 (${car.vz} after ${vz0})`)
			}
			car.ev.length = 0
			minZ = Math.min(minZ, car.z)
			assert.ok(car.y < 0.01, 'never climbs the 1.4 m step')
		}
		assert.ok(bounced, 'hit the wall')
		assert.ok(minZ > -4, `never inside the stage footprint (${minZ})`)
	})

	it('the hall edge is a wall; falling off the side of the ramp lands on the hall', () => {
		const { env } = room()
		const car = P.createCar({ x: 15, y: 0, z: 0, yaw: -Math.PI / 2 })
		for (let i = 0; i < 60 * 3; i++) P.stepCar(car, { throttle: 1 }, env)
		assert.ok(car.x <= 20 && car.x > 18, `stopped at the hall edge x=20 (${car.x})`)
		const side = P.createCar({ x: -3, y: 0.7, z: -1, yaw: -Math.PI / 2 }) // on the ramp, facing +X
		for (let i = 0; i < 60; i++) P.stepCar(side, { throttle: 1 }, env)
		assert.ok(
			side.x > -1.4 && side.y < 0.01 && side.grounded,
			`drove off the ramp side and landed (${side.x}, ${side.y})`
		)
	})

	it('obstacles collide only when their height overlaps the car (y … y + 0.5)', () => {
		const T = TM.prepareTrack(F.straightTrack(200, 4))
		const env = P.createEnv(T, F.BIG_FLOORS, [
			{ min: [-2, 0, -21], max: [2, 0.6, -20] },
			{ min: [-2, 0.9, -41], max: [2, 3, -40] },
		])
		const car = P.createCar({ x: 0, y: 0, z: 0, yaw: 0 })
		let minZ = Infinity
		let walls = 0
		for (let i = 0; i < 3 * 60; i++) {
			P.stepCar(car, { throttle: 1 }, env)
			walls += car.ev.filter((e) => e.k === 'wall').length
			car.ev.length = 0
			minZ = Math.min(minZ, car.z)
		}
		assert.ok(walls >= 1 && minZ >= -20 + P.PHYS.RADIUS - 1e-6, `bounced off the low box (min z ${minZ})`)
		const env2 = P.createEnv(T, F.BIG_FLOORS, [{ min: [-2, 0.9, -41], max: [2, 3, -40] }])
		const c2 = P.createCar({ x: 0, y: 0, z: 0, yaw: 0 })
		for (let i = 0; i < 6 * 60; i++) P.stepCar(c2, { throttle: 1 }, env2)
		assert.ok(c2.z < -50, 'a box from 0.9 m up is driven under')
		const T3 = TM.prepareTrack(F.straightTrack(200, 4, 1.4))
		const env3 = P.createEnv(
			T3,
			[{ id: 'stage', y: 1.4, rect: [-50, -300, 50, 50] }],
			[{ min: [-2, 0, -21], max: [2, 0.6, -20] }]
		)
		const c3 = P.createCar({ x: 0, y: 1.4, z: 0, yaw: 0 })
		for (let i = 0; i < 3 * 60; i++) P.stepCar(c3, { throttle: 1 }, env3)
		assert.ok(c3.z < -25, 'a hall-height box under a stage-height car is ignored')
	})

	it('auto-unstick: throttle into a wall for 1.5 s → nudged back towards the ribbon', () => {
		const { T, env } = room()
		const car = P.createCar({ x: 3, y: 0, z: -3.6, yaw: 0 }) // nose against the stage front, off the ribbon
		let unstuck = -1
		for (let i = 0; i < 60 * 3 && unstuck < 0; i++) {
			P.stepCar(car, { throttle: 1 }, env)
			if (car.ev.some((e) => e.k === 'unstick')) unstuck = i / 60
			car.ev.length = 0
		}
		assert.ok(unstuck >= 1.4 && unstuck <= 2.2, `unstuck after ${unstuck} s`)
		const n0 = TM.nearestOnTrack(T, 3, -3.6, -1, 6, 0)
		const n1 = TM.nearestOnTrack(T, car.x, car.z, -1, 6, car.y)
		assert.ok(n1.dist < n0.dist - 0.5, `closer to the ribbon (${n0.dist} → ${n1.dist})`)
		assert.ok(!GR.blockedAt(env.ground, car.x, car.z, car.y))
	})

	it('car bumps: relative closing speed, one kick per contact — a car shoving into you never stacks kicks', () => {
		const { env } = room()
		/* regression (headless run): a remote car (moved kinematically from its snapshots) pushing into a slow car
		 * added +1.4 m/s on EVERY overlapping step → launched it backwards past the reverse top speed */
		const car = P.createCar({ x: 10, y: 0, z: 6, yaw: 0 })
		const other = { x: 10, y: 0, z: 3, yaw: Math.PI, v: 8 } // facing +Z, driving into the car's nose at 8 m/s
		let maxAway = 0
		let bumps = 0
		for (let i = 0; i < 60; i++) {
			other.z += 8 / 60
			P.stepCar(car, { brake: 1 }, env, [other])
			if (car.bumped) bumps++
			maxAway = Math.max(maxAway, car.vz)
		}
		assert.ok(bumps >= 1, 'it did bump')
		assert.ok(
			maxAway < 8 * 0.75 + 1.4 + 1.5,
			`shoved at most ≈ the other car's speed (+ the kick): ${maxAway.toFixed(2)}`
		)
		/* a parked car: one bounce, then no further kicks while the gas pushes into it */
		const c2 = P.createCar({ x: 10, y: 0, z: 10.4, yaw: 0 })
		let minV = 0
		for (let i = 0; i < 120; i++) {
			P.stepCar(c2, { throttle: 1 }, env, [{ x: 10, y: 0, z: 10 }])
			minV = Math.min(minV, P.forwardSpeed(c2))
		}
		assert.ok(minV > -3, `no reverse launch off a parked car (${minV.toFixed(2)} m/s)`)
	})
})

/** Run the bot for up to `sec` seconds; returns laps, off-ribbon steps, events. */
function botRun(raw, floors, sec, laps = 1) {
	const T = TM.prepareTrack(raw)
	const env = P.createEnv(T, floors, [])
	const car = P.createCar(TM.gridPose(T, 0))
	const r = new ST.RaceTracker(T)
	r.reset(0)
	r.move('me', car.x, car.z, 0, true, car.y)
	let done = 0
	let off = 0
	let hint = -1
	const ev = {}
	for (let i = 0; i < 60 * sec && done < laps; i++) {
		const b = F.botInput(TM, P, T, car, hint)
		hint = b.near.seg
		P.stepCar(car, b.input, env)
		for (const e of car.ev) ev[e.k] = (ev[e.k] || 0) + 1
		car.ev.length = 0
		if (!car.onTrack) off++
		const e = r.move('me', car.x, car.z, (i * 1000) / 60, false, car.y)
		if (e?.type === 'lap') done = e.lap
		assert.ok([car.x, car.y, car.z].every(Number.isFinite))
	}
	return { T, done, off, ev, lap: r.cars.get('me').lap }
}

describe('WO-1074 v2 bot laps (real physics + checkpoint logic)', () => {
	it('laps the synthetic room track twice: ramp, stage, drop, pad', () => {
		const { T, done, off, ev, lap } = botRun(F.roomTrack(), F.ROOM_FLOORS, 60, 2)
		assert.equal(done, 2)
		assert.ok(off < 60, `mostly on the ribbon (${off} off-ribbon steps)`)
		assert.ok(ev.land >= 2 && ev.pad >= 2, JSON.stringify(ev))
		assert.ok(lap.bestMs > (T.total / 24) * 1000, `lap ${lap.bestMs} ms never faster than length / 24`)
	})

	it('laps a plain flat oval', () => {
		const { T, done, off, lap } = botRun(F.ovalTrack(), F.BIG_FLOORS, 30, 1)
		assert.equal(done, 1)
		assert.equal(off, 0)
		assert.ok(lap.lastMs > (T.total / 14) * 1000)
	})

	it('laps a v1 (2D) oval on a stage floor', () => {
		const { done } = botRun(F.ovalTrackV1(), [{ id: 'stage', y: 1.42, rect: [-11, -8, 11, 8] }], 30, 1)
		assert.equal(done, 1)
	})
})

/* §2.7: the server generator's whole-room tracks over the furnished hall (decks, a bridge) — tools/smoke/lib */
describe('WO-1074 §2.7 decks, rails, bridges (client)', () => {
	const deck = (key) => {
		const D = F.deckTracks()
		const T = TM.prepareTrack(D[key])
		return { D, T, env: P.createEnv(T, D.floors, D.obstacles) }
	}
	/** The over-and-under's bridge: an upper ribbon point over a lower one (plan < 0.5 m, ≥ 1 m apart in height). */
	const bridgeOf = (T) => {
		for (let i = 0; i < T.n; i++)
			for (let j = 0; j < T.n; j++)
				if (Math.abs(i - j) > 10 && Math.hypot(T.pts[i][0] - T.pts[j][0], T.pts[i][1] - T.pts[j][1]) < 0.5 && T.ys[i] - T.ys[j] > 1)
					return { up: i, lo: j, x: T.pts[i][0], z: T.pts[i][1] }
		return null
	}

	it('ground, ceiling and nearest ribbon at a bridge follow the car height', () => {
		const { T, env } = deck('over')
		const b = bridgeOf(T)
		assert.ok(b, 'the over-and-under has a bridge')
		const yUp = T.ys[b.up]
		const yLo = T.ys[b.lo]
		assert.ok(Math.abs(P.groundOf(env, b.x, b.z, yLo) - yLo) < 0.05, 'under the bridge: the lower deck')
		assert.ok(Math.abs(P.groundOf(env, b.x, b.z, yUp) - yUp) < 0.05, 'on the bridge: the upper deck')
		assert.ok(Math.abs(P.groundOf(env, b.x, b.z) - yUp) < 0.05, 'no height given: the old top-most surface')
		assert.ok(Math.abs(P.ceilingOf(env, b.x, b.z, yLo) - (yUp - GR.DECK_SLAB)) < 0.05, 'the ceiling under it: the slab underside')
		assert.equal(P.ceilingOf(env, b.x, b.z, yUp), Infinity, 'nothing over the upper deck')
		const near = (y) => TM.nearestOnTrack(T, b.x, b.z, -1, 6, y).seg
		assert.ok(Math.abs(near(yLo) - b.lo) <= 1, `lower ribbon at the lower height (${near(yLo)} vs ${b.lo})`)
		assert.ok(Math.abs(near(yUp) - b.up) <= 1, `upper ribbon at the upper height (${near(yUp)} vs ${b.up})`)
	})

	it('rails hold a car on a deck at full boost in a corner (scrapes along, never falls)', () => {
		for (const key of ['over', 'sky']) {
			const { D, T } = deck(key)
			const turn = (i) => {
				const a = T.tangents[i]
				const c = T.tangents[(i + 4) % T.n]
				return Math.atan2(a[0] * c[1] - a[1] * c[0], a[0] * c[0] + a[1] * c[1])
			}
			let i0 = -1
			for (let i = 0; i < T.n; i++) if (T.segDeck[i] && T.segDeck[(i + 8) % T.n] && (i0 < 0 || Math.abs(turn(i)) > Math.abs(turn(i0)))) i0 = i
			assert.ok(Math.abs(turn(i0)) > 0.3, `${key}: a deck corner (${turn(i0)})`)
			const k = (i0 - 2 + T.n) % T.n
			const run = (rails) => {
				const e = P.createEnv(T, D.floors, D.obstacles)
				if (!rails) e.ground.rails = []
				const car = P.createCar({ x: T.pts[k][0], y: T.ys[k], z: T.pts[k][1], yaw: TM.yawFromDir(...T.tangents[k]) })
				const f = P.forwardOf(car.yaw)
				car.vx = f[0] * 18
				car.vz = f[1] * 18
				let hint = k
				const out = { walls: 0, drop: 0, wide: 0, steps: 0 }
				for (let s = 0; s < 60; s++) {
					car.boost = 1
					/* half lock the wrong way round: wider than the ≥ 6 m deck radius, into the outside rail */
					P.stepCar(car, { throttle: 1, steer: Math.sign(turn(i0)) * 0.5 }, e)
					out.walls += car.ev.filter((v) => v.k === 'wall').length
					car.ev.length = 0
					const n = TM.nearestHinted(T, car.x, car.z, hint, car.y)
					hint = n.seg
					assert.ok([car.x, car.y, car.z].every(Number.isFinite))
					out.drop = Math.max(out.drop, n.py - car.y)
					out.wide = Math.max(out.wide, n.dist)
					out.steps++
				}
				return out
			}
			const r = run(true)
			assert.ok(r.walls >= 3, `${key}: the rail was hit (${r.walls})`)
			assert.ok(r.drop < 0.05 && r.wide <= T.half - P.PHYS.RADIUS + 0.02, `${key}: stays on the deck ${JSON.stringify(r)}`)
			const bare = run(false)
			assert.ok(bare.drop > 0.5 || bare.wide > T.half + 0.5, `${key}: without rails the same run leaves the deck ${JSON.stringify(bare)}`)
		}
	})

	it('the bot laps the over-and-under (under and over the bridge, every checkpoint) and the long deck loop', () => {
		for (const key of ['over', 'sky']) {
			const { T, env } = deck(key)
			const b = key === 'over' ? bridgeOf(T) : null
			const car = P.createCar(TM.gridPose(T, 0))
			const r = new ST.RaceTracker(T)
			r.reset(0)
			r.move('me', car.x, car.z, 0, true, car.y)
			const cps = []
			const seen = { lo: 0, up: 0 }
			let done = 0
			let hint = -1
			let off = 0
			for (let i = 0; i < 60 * 90 && done < 2; i++) {
				const bi = F.botInput(TM, P, T, car, hint)
				hint = bi.near.seg
				P.stepCar(car, bi.input, env)
				car.ev.length = 0
				if (!car.onTrack) off++
				assert.ok([car.x, car.y, car.z].every(Number.isFinite))
				const before = r.cars.get('me').lap.cp
				const e = r.move('me', car.x, car.z, (i * 1000) / 60, false, car.y)
				if (r.cars.get('me').lap.cp !== before) cps.push(r.cars.get('me').lap.cp)
				if (e?.type === 'lap') done = e.lap
				if (b && Math.hypot(car.x - b.x, car.z - b.z) < 1) {
					const seg = TM.nearestHinted(T, car.x, car.z, hint, car.y).seg
					const level = Math.abs(car.y - T.ys[b.lo]) < 0.1 ? 'lo' : Math.abs(car.y - T.ys[b.up]) < 0.1 ? 'up' : 'x'
					assert.notEqual(level, 'x', `at the bridge the car is on a deck (${car.y})`)
					assert.ok(Math.abs(seg - b[level]) <= 2, `${level}: nearest ribbon ${seg}, want ≈ ${b[level]}`)
					seen[level]++
				}
			}
			assert.equal(done, 2, `${key}: two laps`)
			assert.ok(off < 60, `${key}: ${off} off-ribbon steps`)
			const per = T.checkpoints.length
			const want = [...Array(per * 2)].map((_, i) => (i + 1) % per)
			assert.deepEqual(cps, want, `${key}: every checkpoint in order`)
			if (b) assert.ok(seen.lo > 0 && seen.up > 0, `under and over the bridge ${JSON.stringify(seen)}`)
		}
	})
})
