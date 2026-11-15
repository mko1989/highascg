'use strict'

/**
 * WO-1089 — Stage Salad hits (contract §6, §7): the avatar's hit parts (head sphere, body and legs capsules in the
 * previs avatar's unit frame, scaled by height, turned by yaw; a duck sinks head + body, a step shifts all; the
 * umbrella sphere comes first), the swept test along a step, and the referee end to end — a guest aiming at the head /
 * body / legs of a WALKING puppet (the server leads nothing: the guest's aim includes the lead) gets that part, the
 * points of the table, and nobody can claim a hit (the server computes every end).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { shared, makeRoom, snapOf, PUPPET } = require('./lib/salad-fixtures')

const S = shared()
const B = S.body
const VG = S.veggies.VEGGIES

test('hit parts: scaled by height, turned by yaw; duck sinks head + body (not legs); a step shifts everything', () => {
	const pose = { x: 10, y: 0.639, z: 2, yaw: 0, height: 1.53 }
	const s = 1.53 / B.UNIT_TOP
	const p = Object.fromEntries(B.worldParts(pose).map((q) => [q.part, q]))
	assert.deepEqual(Object.keys(p), ['head', 'body', 'legs'])
	assert.ok(Math.abs(p.head.c[1] - (0.639 + 0.82 * s)) < 1e-9)
	assert.ok(Math.abs(p.head.r - 0.19 * s) < 1e-9)
	assert.ok(p.head.c[1] > p.body.b[1] && p.body.a[1] > p.legs.b[1], 'head over body over legs')
	assert.ok(p.head.c[1] + p.head.r > 0.639 + 1.5 && p.head.c[1] + p.head.r < 0.639 + 1.6, 'the top of the head ≈ the height')
	const duck = Object.fromEntries(B.worldParts({ ...pose, duck: 1 }).map((q) => [q.part, q]))
	assert.ok(Math.abs(p.head.c[1] - duck.head.c[1] - B.DUCK_DROP * s) < 1e-9)
	assert.deepEqual(duck.legs, p.legs)
	const step = Object.fromEntries(B.worldParts({ ...pose, off: [0, 0.4] }).map((q) => [q.part, q]))
	assert.ok(Math.abs(step.head.c[2] - p.head.c[2] - 0.4) < 1e-9)
	const um = B.worldParts({ ...pose, umbrella: true, facing: [-1, 0] })
	assert.equal(um[0].part, 'umbrella', 'the umbrella is tested first')
	assert.ok(um[0].c[0] < pose.x, 'held towards the audience')
	assert.equal(B.dodgeAmount({ from: 1000, until: 1700 }, 1060), 0.5)
	assert.equal(B.dodgeAmount({ from: 1000, until: 1700 }, 1400), 1)
	assert.equal(B.dodgeAmount({ from: 1000, until: 1700 }, 1800), 0)
})

test('swept test: a pass at head / body / legs height finds that part; beside the avatar finds nothing', () => {
	const pose = { x: 10, y: 0.639, z: 2, yaw: 0.7, height: 1.75 }
	const parts = B.worldParts(pose)
	const s = B.scaleOf(1.75)
	for (const [part, y] of [['head', 0.82], ['body', 0.48], ['legs', 0.15]]) {
		const h = B.sweepParts(parts, [8, 0.639 + y * s, 2], [12, 0.639 + y * s, 2], 0.03)
		assert.equal(h?.part, part, `${part}: ${JSON.stringify(h)}`)
		assert.ok(h.p[0] < 10 && h.p[0] > 9.5, 'the first contact, on the near side')
	}
	assert.equal(B.sweepParts(parts, [8, 1.4, 2.6], [12, 1.4, 2.6], 0.03), null, '0.6 m to the side')
	assert.equal(B.sweepParts(parts, [8, 2.6, 2], [12, 2.6, 2], 0.03), null, 'over the head')
})

test('score table: head > body > legs, distance and streak multiply, an onion bank shot pays 1.5×', () => {
	const { points, distanceFactor, streakFactor } = require('./lib/salad-fixtures').server('salad-score.js')
	const t = { veg: VG.tomato, dist: 6, streak: 1 }
	assert.equal(points({ ...t, part: 'head' }), 100)
	assert.equal(points({ ...t, part: 'body' }), 50)
	assert.equal(points({ ...t, part: 'legs' }), 30)
	assert.equal(points({ ...t, part: 'umbrella' }), 0)
	assert.equal(distanceFactor(3), 1)
	assert.equal(distanceFactor(11), 1.5)
	assert.equal(distanceFactor(40), 2)
	assert.deepEqual([1, 2, 3, 5, 9].map(streakFactor), [1, 1.25, 1.5, 2, 2])
	assert.equal(points({ veg: VG.onion, dist: 16, streak: 1, part: 'body', bounced: true }), 150)
	assert.equal(points({ veg: VG.tomato, dist: 16, streak: 1, part: 'body', bounced: true }), 100, 'only the onion banks')
	assert.equal(points({ veg: VG.peas, dist: 6, streak: 1, part: 'head' }), 30)
})

/** A walking puppet across the stage (PSN y = −Godot z), 1.2 m/s, fed at 10 Hz like the tracking poll. */
function walkingRoom(seed) {
	const R = makeRoom({ seed })
	let y = -1
	let dir = -1
	let turned = R.clk.now()
	const feed = R.clk.timers.setInterval(() => {
		y += dir * 0.12
		if (y < -9 || y > -1) (dir = -dir), (turned = R.clk.now())
		R.room.ingestTracking(snapOf([{ ...PUPPET, x: 11, y }]))
	}, 100)
	R.room.ingestTracking(snapOf([{ ...PUPPET, x: 11, y }]))
	R.clk.advance(1500)
	/** Steady walking: ≥ 1 s since the last turn (the speed estimate settled) and ≥ 1.6 s before the next. */
	const steady = () => {
		for (let k = 0; k < 100; k++) {
			const next = (dir < 0 ? y + 9 : -1 - y) / 1.2
			if (R.clk.now() - turned >= 1000 && next >= 1.6) return
			R.clk.advance(100)
		}
	}
	return { ...R, steady, stop: () => R.clk.timers.clearInterval(feed) }
}

test('end to end vs a walking puppet: the aimed part is hit (aim leads the walk), points match the table', () => {
	const R = walkingRoom(11)
	const c = R.join('Aimer')
	R.room.host('round', { secs: 120 })
	R.room.host('start')
	R.clk.advance(3100)
	const v = R.room.ctx.venue()
	const me = R.of(c, 'welcome')[0].you
	const origin = S.venue.pouch(v.slots[me.slot])
	let n = 0
	const tally = { aimed: 0, same: 0, dodged: 0, belly: 0 }
	for (const [part, y] of [['head', 0.82], ['body', 0.48], ['legs', 0.15], ['head', 0.82], ['body', 0.48], ['legs', 0.15]]) {
		for (const veg of [VG.tomato, VG.carrot, VG.potato]) {
			R.steady()
			const t = R.clk.now()
			const pose = R.room.presenters.pose(PUPPET.id, t)
			const vel = R.room.presenters.vel(PUPPET.id)
			const s = B.scaleOf(pose.height)
			const sol = S.aim.solveAim(veg, origin, [pose.x, pose.y + y * s, pose.z], { vel })
			assert.ok(sol, `${veg.id} → ${part} solvable`)
			const before = R.of(c).length
			const dodgesBefore = R.of(c, 'dodge').length
			R.room.handle(c, { t: 'fire', n: ++n, veg: veg.id, a: [sol.yaw, sol.pitch], p: sol.p ?? sol.power })
			const endOf = () => R.of(c).slice(before).find((m) => m.t === 'end' && m.n === n)
			R.clk.advance(Math.max(1700, Math.round(sol.t * 1000) + 300))
			for (let k = 0; k < 50 && !endOf(); k++) R.clk.advance(100) // a missed potato may roll on (≤ 4 s)
			const end = endOf()
			assert.ok(end, `shot ${n} ended`)
			tally.aimed++
			if (R.of(c, 'dodge').length > dodgesBefore || end.tag === 'umbrella') {
				tally.dodged++
				continue
			}
			assert.equal(end.k, 'hit', `${veg.id} at the ${part}: ${JSON.stringify(end)}`)
			assert.equal(end.tid, PUPPET.id)
			if (end.part === part) tally.same++
			else if (part === 'legs' && end.part === 'body' && veg.pitch >= 20) tally.belly++ // a lob drops onto the wider torso first
			else assert.fail(`aimed at the ${part} with a ${veg.id}, got ${JSON.stringify(end)}`)
			const dist = Math.hypot(end.p[0] - origin[0], end.p[2] - origin[2])
			const { points } = require('./lib/salad-fixtures').server('salad-score.js')
			const exp = points({ part: end.part, veg, dist, streak: end.streak, bounced: false })
			assert.ok(Math.abs(end.pts - exp) <= 1, `points ${end.pts} vs ${exp} (rounding of the end point)`)
		}
	}
	assert.ok(tally.same >= tally.aimed - tally.dodged - tally.belly && tally.same >= 10, JSON.stringify(tally))
	const st = R.room.snapshot().players[0]
	assert.equal(st.shots, tally.aimed)
	assert.ok(st.best >= 3, 'a streak built up')
	R.stop()
	R.room.dispose()
})

test('nobody can report a hit: a client `hit` / `end` / `score` message changes nothing', () => {
	const R = walkingRoom(3)
	const c = R.join('Cheat')
	R.room.host('start')
	R.clk.advance(3100)
	for (const m of [{ t: 'hit', tid: PUPPET.id, part: 'head' }, { t: 'end', k: 'hit', pts: 9999 }, { t: 'score', score: 1e6 }, { t: 'me', score: 5 }])
		R.room.handle(c, m)
	R.clk.advance(500)
	assert.equal(R.room.snapshot().players[0].score, 0)
	assert.equal(R.of(c, 'end').length, 0)
	R.stop()
	R.room.dispose()
})
