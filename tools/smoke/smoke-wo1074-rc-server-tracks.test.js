'use strict'

/**
 * WO-1074 v2 — RC game tracks (src/game/rc-tracks.js, rc-track-check*.js, rc-ground.js; contract §2.1): 3D tracks
 * generated on synthetic scenes (hall + stage, stage only, tiny floor, many obstacles, no scene, the default hall around
 * a stage) and on the live project's scene (read-only, when present). Every emitted track passes validateTrack, the
 * generation is deterministic, at least two tracks always exist, a hall + stage gives ≥ 3 room tracks (hall → ramp →
 * stage → ramp / drop → hall) and a hall-only one. Measured from the points themselves (lib/rc-track-measure.js), not
 * through the validator: ramp slope ≤ 18°, no kink > 6°, level everywhere else, drops go down and land 3–8 m on, pads /
 * boxes off ramps, drops and the 6 m around the start line, the y-aware ground model under every point and across the
 * road, and the §2.7 deck rules. The ramp surface definition is pinned on a hand-made ramp, and validateTrack rejects
 * every broken variant. §2.7 (whole-room deck tracks): a live-like furnished 27 × 61 m hall gives ≥ 2 room-long tracks
 * of different designs, decks pass between 0.75 m tables and a 4 m truss, never under a low ceiling, a figure-eight's
 * bridge stands ≥ 1.2 m over the road below, a small hall gets no deck track but keeps its short ones.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { generateTracks, validateTrack, GENERATOR_VERSION } = require('../../src/game/rc-tracks')
const Gr = require('../../src/game/rc-ground')
const { measure, span, plan, furnishedHall } = require('./lib/rc-track-measure')

/** Generate, validate, measure, check determinism. */
function check(scene, label, min = 2) {
	const r = generateTracks(scene)
	assert.ok(r.tracks.length >= min, `${label}: ${r.tracks.length} tracks (want ≥ ${min})`)
	const sc = { floors: r.floors, obstacles: scene.obstacles, heights: scene.heights }
	assert.equal(new Set(r.tracks.map((t) => t.id)).size, r.tracks.length, `${label}: unique ids`)
	for (const t of r.tracks) {
		const v = validateTrack(t, sc)
		assert.ok(v.ok, `${label} ${t.id}: ${v.errors.join(', ')}`)
		assert.ok(t.points.length >= 60 && t.points.length <= 200 && t.checkpoints[0] === 0 && t.name)
		measure(t, sc, label)
	}
	assert.deepEqual(generateTracks(scene), r, `${label}: deterministic`)
	return r
}

const STAGE = { id: 'stage', y: 1.4, rect: [-9, -10, 9, 0] }
const HALL = { id: 'hall', y: 0, rect: [-20, -14, 20, 26] }
const LEGS = [[-10, -11], [10, -11], [-15, 15], [15, 15]].map(([x, z]) => ({ min: [x - 0.3, 0, z - 0.3], max: [x + 0.3, 6, z + 0.3] }))
const ROOM = { floors: [HALL, STAGE], obstacles: LEGS, bounds: { min: [-20, 0, -14], max: [20, 8, 26] } }

test('big hall + elevated stage: ≥ 3 room tracks over ramps and drops, a hall-only and a stage-only track', () => {
	const r = check(ROOM, 'hall+stage', 5)
	const room = r.tracks.filter((t) => t.floor === 'room')
	assert.ok(room.length >= 3, room.map((t) => t.id).join())
	for (const t of room) {
		const ys = new Set(t.points.map((p) => p[1]))
		assert.ok(ys.has(0) && ys.has(1.4), `${t.id} uses both floors`)
		assert.ok(t.ramps.length >= 1 && t.ramps.length + t.drops.length >= 2, `${t.id}: up a ramp, down a ramp or a drop`)
		assert.ok(t.points.some((p) => p[1] === 1.4 && Gr.floorGround(r, p[0], p[2]) === 1.4))
	}
	assert.ok(room.some((t) => t.drops.length) && room.some((t) => !t.drops.length), 'both ramp-down and drop exits')
	assert.ok(r.tracks.some((t) => t.floor === 'hall'), 'a hall-only track')
	assert.ok(r.tracks.some((t) => t.floor === 'stage' && t.points.every((p) => p[1] === 1.4)), 'a stage-only track')
	assert.ok(r.tracks.filter((t) => t.floor === 'hall').every((t) => t.width >= 4))
	assert.ok(r.tracks.filter((t) => t.floor === 'room').every((t) => t.width >= 2.5))
	assert.equal(typeof GENERATOR_VERSION, 'number')
})

test('stage only, tiny floor (→ arena), many obstacles, no stage (→ a bridge), the default hall around a stage', () => {
	check({ floors: [{ id: 'stage', y: 1, rect: [0, 0, 14, 9] }], obstacles: [], bounds: { min: [0, 0, 0], max: [14, 5, 9] } }, 'stage only', 2)
	const tiny = check({ floors: [{ id: 'stage', y: 1, rect: [0, 0, 3, 2] }], obstacles: [], bounds: { min: [0, 0, 0], max: [3, 2, 2] } }, 'tiny', 2)
	assert.ok(tiny.floors.some((f) => f.id === 'arena') && tiny.tracks.every((t) => t.floor === 'arena'))
	let seed = 7
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
	const obstacles = Array.from({ length: 150 }, () => {
		const x = -18 + rnd() * 36, z = -12 + rnd() * 24
		return { min: [x, 0, z], max: [x + 0.6, 1, z + 0.6] }
	})
	const hall = { id: 'hall', y: 0, rect: [-20, -14, 20, 14] }
	check({ floors: [hall], obstacles, bounds: { min: [-20, 0, -14], max: [20, 5, 14] } }, 'many obstacles', 2)
	const flat = check({ floors: [{ id: 'hall', y: 0, rect: [-15, -10, 15, 10] }], obstacles: [], bounds: null }, 'no stage', 3)
	const bridge = flat.tracks.find((t) => t.id === 'hall-bridge')
	assert.ok(bridge && bridge.ramps.length === 1 && Math.max(...bridge.points.map((p) => p[1])) >= 0.4, 'a table-top bridge')
	const full = check({ floors: [hall], obstacles: [{ min: [-20, 0, -14], max: [20, 1, 14] }], bounds: { min: [-20, 0, -14], max: [20, 5, 14] } }, 'blocked', 2)
	const arena = full.floors.find((f) => f.id === 'arena')
	assert.ok(arena && (arena.rect[0] >= 20 || arena.rect[2] <= -20))
	// a scene with only a stage: the default hall (stage + 18 m all round) leaves room for room tracks
	const { hallFloor } = require('../../src/game/rc-scene-geom')
	const st = { id: 'stage', y: 1, rect: [-6, -8, 6, -2] }
	const r = check({ floors: [hallFloor([], null, st), st], obstacles: [], bounds: null }, 'default hall', 4)
	assert.ok(r.tracks.filter((t) => t.floor === 'room').length >= 3)
})

test('ground model: the ramp surface (square ends, earliest segment on a tie, linear height), floors, obstacles', () => {
	const ramp = { width: 2, points: [[0, 0, 0], [0, 0.2, -1], [0, 0.6, -2], [0, 1, -3], [5, 1, -3]], ramps: [{ from: 0, to: 3 }] }
	const h = (x, z) => Gr.rampHeight(ramp, ramp.ramps[0], x, z)
	assert.ok(Math.abs(h(0, -0.5) - 0.1) < 1e-9)
	assert.ok(Math.abs(h(0.9, -1.5) - 0.4) < 1e-9, 'inside half the width')
	assert.equal(h(1.1, -1.5), null, 'beyond half the width')
	assert.equal(h(0.5, 0), 0, 'exactly at the start')
	assert.equal(h(0, 0.1), null, 'before the first point: cut square')
	assert.equal(h(0.9, 0.06), null, 'END_TOL: 5 cm')
	assert.equal(h(0.9, 0.04), 0, 'within END_TOL of the end')
	assert.equal(h(0, -3.1), null, 'past the last point: cut square')
	assert.equal(h(0, -1), 0.2, 'a tie between two segments → the earlier one (same height at the shared point)')
	assert.deepEqual(Gr.rampIndices({ from: 3, to: 1 }, 5), [3, 4, 0, 1])
	assert.deepEqual(Gr.rampIndices({ from: 1, to: 1 }, 5), [])
	const scene = { floors: [{ id: 'hall', y: 0, rect: [-10, -10, 10, 10] }, { id: 'stage', y: 0.5, rect: [-10, -10, 10, -1.5] }] }
	assert.equal(Gr.floorGround(scene, 0, -1.5), 0.5, 'rect edges inclusive, highest floor wins')
	assert.equal(Gr.floorGround(scene, 11, 0), null)
	assert.equal(Gr.ground(scene, ramp, 0, -1.5), 0.5, 'the floor is higher than the ramp here (0.4)')
	assert.ok(Math.abs(Gr.ground(scene, ramp, 0, -2.5) - 0.8) < 1e-9, 'the ramp is higher than the floor here')
	assert.ok(Math.abs(Gr.ground(scene, ramp, 0, -0.5) - 0.1) < 1e-9)
	assert.equal(Gr.ground(scene, null, 0, -0.5), 0)
	const box = { min: [0, 0.6, 0], max: [1, 1, 1] }
	assert.equal(Gr.obstacleHits(box, 0), false, 'a car at y 0 reaches 0.5')
	assert.equal(Gr.obstacleHits(box, 0.2), true)
	assert.equal(Gr.obstacleHits(box, 0, 0.2), true, 'a ramp segment climbing into it')
	assert.equal(Gr.obstacleHits({ min: [0, -1, 0], max: [1, 0.01, 1] }, 0), false, 'floor slabs do not count')
	assert.equal(Gr.CAR_TOP, 0.5)
})

test('validateTrack rejects broken 3D tracks', () => {
	const r = generateTracks(ROOM)
	const sc = { floors: r.floors, obstacles: ROOM.obstacles }
	const leap = r.tracks.find((t) => t.drops.length && t.floor === 'room')
	const hall = r.tracks.find((t) => t.floor === 'hall')
	assert.ok(leap && hall)
	const bad = (t, mut, why) => {
		const c = JSON.parse(JSON.stringify(t))
		mut(c)
		const v = validateTrack(c, sc)
		assert.equal(v.ok, false, `accepted: ${why}`)
		return v.errors.join(', ')
	}
	const n = leap.points.length
	const [ra] = leap.ramps, [dr] = leap.drops
	assert.match(bad(leap, (c) => (c.points = c.points.map((p) => [p[0], p[2]])), '2D points'), /\[x, y, z\]/)
	assert.match(bad(leap, (c) => c.points.push([...c.points[0]]), 'repeated closing point'), /repeats|spacing|length/)
	assert.match(bad(leap, (c) => (c.points = c.points.slice(0, 50)), 'too few points'), /points/)
	assert.match(bad(leap, (c) => (c.width = 2.4), 'width 2.4'), /width/)
	assert.match(bad(hall, (c) => (c.width = 3.5), 'a hall track under 4 m'), /width/)
	assert.match(bad(leap, (c) => (c.closed = false), 'open'), /closed/)
	// a ramp twice as steep: the surface follows the points, so only the slope rule catches it
	const base = leap.points[ra.from][1]
	assert.match(bad(leap, (c) => {
		for (const i of span(ra.from, ra.to, n).slice(1, -1)) c.points[i][1] = Math.min(base + (c.points[i][1] - base) * 2.2, 1.4)
	}, 'steep ramp'), /slope|kink/)
	assert.match(bad(leap, (c) => (c.points[(ra.from + 2) % n][1] += 0.05), 'a bump on the ramp'), /kink/)
	assert.match(bad(leap, (c) => (c.ramps = []), 'a step with no ramp'), /ground|step/)
	assert.match(bad(leap, (c) => (c.drops[0].land = (dr.at + 22) % n), 'a 10 m drop'), /beyond at/)
	assert.match(bad(leap, (c) => (c.drops[0].land = (dr.at + 2) % n), 'a 1 m drop'), /beyond at/)
	assert.match(bad(leap, (c) => (c.drops = []), 'a drop that is not declared'), /step|ground/)
	// an obstacle beside the landing: clear of the road (> width / 2) but within a track width
	const L = leap.points[(dr.land + 1) % n], A = leap.points[dr.land]
	const dl = plan(A, L), nx = -(L[2] - A[2]) / dl, nz = (L[0] - A[0]) / dl
	const ox = A[0] + nx * leap.width * 0.8, oz = A[2] + nz * leap.width * 0.8
	const landing = { ...sc, obstacles: [...sc.obstacles, { min: [ox - 0.1, A[1], oz - 0.1], max: [ox + 0.1, A[1] + 1, oz + 0.1] }] }
	assert.ok(!validateTrack(leap, landing).ok && /landing/.test(validateTrack(leap, landing).errors[0]), 'landing not clear by a width')
	const mid = leap.points[ra.from + 3]
	assert.match(bad(leap, (c) => Object.assign(c.boxes[0], { x: mid[0], y: mid[1] + 0.5, z: mid[2] }), 'a box on a ramp'), /box 0/)
	const p2 = leap.points[2]
	assert.match(bad(leap, (c) => Object.assign(c.boxes[0], { x: p2[0], y: p2[1] + 0.5, z: p2[2] }), 'a box at the start line'), /box 0 on \/ near/)
	assert.match(bad(leap, (c) => Object.assign(c.pads[0], { x: p2[0], z: p2[2], y: p2[1] }), 'a pad at the start line'), /pad 0/)
	assert.match(bad(leap, (c) => (c.pads = c.pads.slice(0, 1)), 'one pad'), /pads/)
	assert.match(bad(leap, (c) => (c.boxes = c.boxes.slice(0, 3)), 'one row of boxes'), /rows/)
	assert.match(bad(leap, (c) => (c.boxes[1].id = c.boxes[0].id), 'duplicate box ids'), /unique/)
	assert.match(bad(leap, (c) => (c.grid = c.grid.slice(0, 9)), 'grid of 9'), /grid/)
	assert.match(bad(leap, (c) => (c.grid[0].yaw += Math.PI), 'grid backwards'), /grid 0/)
	assert.match(bad(leap, (c) => (c.checkpoints = [3, 10, 20]), 'checkpoints not from 0'), /checkpoints/)
	assert.match(bad(leap, (c) => (c.length *= 2), 'wrong length'), /length/)
	assert.match(bad(hall, (c) => (c.floor = 'nowhere'), 'unknown floor'), /floor/)
	// obstacles: on the line fails, above the car (≥ y + 0.5) does not matter
	const q = hall.points[hall.points.length >> 1]
	const at = (y0, y1) => ({ ...sc, obstacles: [{ min: [q[0] - 0.2, y0, q[2] - 0.2], max: [q[0] + 0.2, y1, q[2] + 0.2] }] })
	assert.equal(validateTrack(hall, at(q[1], q[1] + 0.5)).ok, false, 'an obstacle on the line')
	assert.ok(validateTrack(hall, at(q[1] + 0.6, q[1] + 2)).ok, 'an obstacle above the car')
})

test('§2.7 ground model: a slab counts within REACH above the car, a skirted ramp at any height, 5 cm past the ends', () => {
	const sc = { floors: [{ id: 'hall', y: 0, rect: [-10, -20, 10, 10] }] }
	const deck = { width: 4, points: [[0, 2, 0], [0, 2, -5], [0, 2, -10]], ramps: [], decks: [{ from: 0, to: 2 }] }
	assert.equal(Gr.ground(sc, deck, 0, -5), 2, 'no y: every surface counts (v2)')
	assert.equal(Gr.ground(sc, deck, 0, -5, 0), 0, 'a car on the floor drives under the deck')
	assert.equal(Gr.ground(sc, deck, 0, -5, 2 - Gr.REACH), 2, 'within REACH (0.75 m) the deck is the ground')
	assert.equal(Gr.ground(sc, deck, 1.9, -5, 2), 2)
	assert.equal(Gr.ground(sc, deck, 2.1, -5, 2), 0, 'beyond half the width: off the deck')
	assert.equal(Gr.ground(sc, deck, 0, 0.04, 2), 2, 'END_TOL: 4 cm past the end still carries (no seam at a joint)')
	assert.equal(Gr.ground(sc, deck, 0, 0.1, 2), 0, '10 cm past the end: cut square')
	const skirted = { width: 4, points: [[0, 0, 0], [0, 1, -4], [0, 1, -8]], ramps: [{ from: 0, to: 1 }] }
	assert.equal(Gr.ground(sc, skirted, 0, -2, 0), 0.5, 'a skirted ramp counts at any car height')
	assert.equal(Gr.slabRamp(skirted, skirted.ramps[0]), false)
	assert.equal(Gr.slabRamp({ ...deck, decks: [{ from: 0, to: 1 }, { from: 2, to: 0 }] }, { from: 1, to: 2 }), true)
	assert.equal(Gr.REACH, Gr.CAR_TOP + Gr.DECK_SLAB)
})

const ribbonsOverlap = (t) => {
	const P = t.points, n = P.length
	let sep = Infinity
	for (let i = 0; i < n; i++) for (let j = i + 12; j < n - 12 + i && j < n; j++) if (plan(P[i], P[j]) < t.width / 2) sep = Math.min(sep, Math.abs(P[i][1] - P[j][1]))
	return sep
}

test('§2.7 a furnished 27 × 61 m hall + stage: ≥ 2 room-long deck tracks of different designs, a bridge, short tracks kept', { timeout: 120000 }, () => {
	const sc = furnishedHall()
	const r = check(sc, 'furnished', 5)
	const long = r.tracks.filter((t) => t.kind === 'room-long')
	assert.ok(long.length >= 2, r.tracks.map((t) => `${t.id} ${t.kind} ${t.length}`).join(', '))
	assert.equal(new Set(long.map((t) => t.name)).size, long.length, 'different designs')
	for (const t of long) {
		assert.ok(t.length >= 120 && t.width >= 4 && t.decks.length >= 2 && t.ramps.length >= 1, `${t.id}: ${t.length} m`)
		assert.ok(t.pads.length >= 3 && t.boxes.length >= 9, `${t.id}: pads / rows scale with the length`)
		const zs = t.points.map((p) => p[2])
		assert.ok(Math.max(...zs) > 40 && Math.min(...zs) < 0.86, `${t.id}: from the stage to the far end`)
	}
	// decks pass over the tables (0.75 m) with ≥ 0.6 m to spare
	const tables = sc.obstacles.filter((o) => o.max[1] === 0.75)
	const over = long.flatMap((t) => t.points.filter((p) => tables.some((o) => p[0] > o.min[0] && p[0] < o.max[0] && p[2] > o.min[2] && p[2] < o.max[2])))
	assert.ok(over.length > 10 && over.every((p) => p[1] >= 0.75 + 0.6), 'decks over the tables')
	const eight = long.find((t) => ribbonsOverlap(t) < Infinity)
	assert.ok(eight, 'a figure-eight with a bridge')
	assert.ok(ribbonsOverlap(eight) >= 1.3, `bridge ${ribbonsOverlap(eight)} m over the road below`)
	assert.ok(r.tracks.some((t) => t.kind === 'room' && t.length < 60) && r.tracks.some((t) => t.kind === 'hall'), 'short tracks kept')
	// the validator: a deck sunk onto the tables, a too-short room-long, a checkpoint under the bridge or past a high
	// drop, a 4 m ceiling
	const t = eight
	const bad = (mut, scene = { ...sc, floors: r.floors }) => {
		const c = JSON.parse(JSON.stringify(t))
		mut(c)
		const v = validateTrack(c, scene)
		assert.equal(v.ok, false)
		return v.errors.join(', ')
	}
	const d = t.decks.find((k) => (k.to - k.from + t.points.length) % t.points.length > 20)
	const y0 = t.points[d.from][1]
	assert.ok(bad((c) => c.points.forEach((p) => p[1] === y0 && (p[1] = 1.0))))
	const short = r.tracks.find((x) => x.kind === 'room' && x.length < 60)
	assert.match(validateTrack({ ...short, kind: 'room-long' }, { ...sc, floors: r.floors }).errors.join(), /room-long: [\d.]+ m < 120/)
	const P = t.points, n = P.length
	const under = P.findIndex((p, i) => P.some((q, j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) > 12 && plan(p, q) < 1 && q[1] - p[1] >= 1.2))
	assert.ok(under > 0)
	assert.match(bad((c) => (c.checkpoints = [...new Set([...c.checkpoints, under])].sort((a, b) => a - b))), /bridge|checkpoints/)
	// a checkpoint just past a high drop's landing point: a fast car flies over it, too high for the gate
	const hi = long.find((x) => x.drops.some((q) => x.points[q.at][1] - x.points[q.land][1] > 1.5))
	assert.ok(hi, 'a deck track with a high drop')
	const dr = hi.drops.find((q) => hi.points[q.at][1] - hi.points[q.land][1] > 1.5)
	const hn = hi.points.length
	const ok = hi.checkpoints.filter((c) => (c - dr.land + hn) % hn > 12 && (dr.at - c + hn) % hn > 2)
	const mutCp = [...new Set([...ok, (dr.land + 1) % hn])].sort((a, b) => a - b)
	assert.match(validateTrack({ ...hi, checkpoints: mutCp }, { ...sc, floors: r.floors }).errors.join(), /in the air past a drop/)
	const low = furnishedHall({ truss: 4 })
	assert.match(validateTrack(t, { ...low, floors: r.floors }).errors.join(), /scene geometry/)
	assert.match(bad((c) => (c.kind = 'deck')), /kind/)
})

test('§2.7 decks pass between 0.75 m tables and a truss at 4 m; never under a low ceiling; a small hall keeps its short tracks', { timeout: 120000 }, () => {
	const truss = furnishedHall({ truss: 4 })
	const r = check(truss, 'truss', 5)
	const decked = r.tracks.filter((t) => t.decks?.length)
	assert.ok(decked.length >= 1, 'a deck track fits under the truss')
	for (const t of decked) for (const p of t.points) assert.ok(p[1] + 1 <= 4 + 1e-6, `${t.id}: ${p[1]} within 1 m of the truss`)
	const ceil = furnishedHall({ ceiling: { y: 2.5, z0: 30 } })
	const rc = check(ceil, 'ceiling', 5)
	for (const t of rc.tracks) for (const p of t.points) assert.ok(p[2] < 30 - t.width / 2 || p[1] + 1 <= 2.5, `${t.id}: a deck under the 2.5 m ceiling`)
	const lowAll = furnishedHall({ ceiling: { y: 2.2, z0: -12 } })
	const rl = check(lowAll, 'low ceiling', 5)
	assert.ok(rl.tracks.every((t) => !t.decks?.length), 'no deck under a 2.2 m ceiling')
	// a small hall: no whole-room track (the 2.2 × side rule makes nothing fit), the short tracks remain
	const small = { floors: [{ id: 'hall', y: 0, rect: [-10, -8, 10, 16] }, { id: 'stage', y: 0.6, rect: [-6, -7, 6, -1] }], obstacles: [], bounds: null }
	const rs = check(small, 'small hall', 3)
	assert.ok(rs.tracks.every((t) => t.kind !== 'room-long' && !t.decks?.length))
	const room = rs.tracks.filter((t) => t.floor === 'room').sort((a, b) => b.length - a.length)[0]
	const need = Math.min(120, 2.2 * 24)
	const v = validateTrack({ ...room, kind: 'room-long' }, { floors: rs.floors, obstacles: [] })
	if (room.length < need) assert.match(v.errors.join(), new RegExp(`< ${need.toFixed(1)} m`))
	else assert.doesNotMatch(v.errors.join(), /m < /)
})

/** The live box's newest project that shows an MVR scene, read straight from projects/ (never written). */
function liveInputs() {
	const fs = require('fs')
	const path = require('path')
	const { LIVE_PROJECTS_DIR } = require('../../src/engine/projects-root')
	const { sceneInputs } = require('../../src/game/rc-scene')
	let best = null
	for (const f of fs.existsSync(LIVE_PROJECTS_DIR) ? fs.readdirSync(LIVE_PROJECTS_DIR) : []) {
		if (!/^[\w-]+\.json$/.test(f)) continue
		try {
			const full = path.join(LIVE_PROJECTS_DIR, f)
			const inp = sceneInputs(JSON.parse(fs.readFileSync(full, 'utf8')))
			const t = fs.statSync(full).mtimeMs
			if (inp.id && fs.existsSync(path.join(LIVE_PROJECTS_DIR, '_mvr', `${inp.id}.json`)) && (!best || t > best.t)) best = { inp, t }
		} catch {
			/* not a project */
		}
	}
	return best && { inp: best.inp, dir: LIVE_PROJECTS_DIR }
}

test('the live project scene (read-only): room + hall tracks, every one valid and on the ground model, GLB budget', { timeout: 180000 }, async (t) => {
	const live = liveInputs()
	if (!live) return t.skip('no project with an MVR scene on this machine')
	const store = require('../../src/stage/mvr-store')
	// mvr-store reads projectsRoot() (a temp dir under the test runner); point it at the live dir only for each read call
	const withLive = (fn) => {
		const prev = process.env.HIGHASCG_PROJECTS_DIR
		process.env.HIGHASCG_PROJECTS_DIR = live.dir
		try {
			return fn()
		} finally {
			if (prev == null) delete process.env.HIGHASCG_PROJECTS_DIR
			else process.env.HIGHASCG_PROJECTS_DIR = prev
		}
	}
	const mvrStore = { get: (id) => withLive(() => store.get(id)), mesh: (id, key) => withLive(() => store.mesh(id, key)) }
	const { bakeScene } = require('../../src/game/rc-scene')
	const { json, glb } = await bakeScene(live.inp, 'smoke', { mvrStore })
	assert.ok(json.tracks.length >= 2, json.tracks.map((x) => x.id).join())
	for (const tr of json.tracks) {
		const v = validateTrack(tr, json)
		assert.ok(v.ok, `${tr.id}: ${v.errors.join(', ')}`)
		measure(tr, json, 'live')
	}
	if (json.floors.some((f) => f.id === 'stage') && json.floors.some((f) => f.id === 'hall')) {
		assert.ok(json.tracks.filter((x) => x.floor === 'room').length >= 3, 'live: ≥ 3 room tracks')
		assert.ok(json.tracks.some((x) => x.floor === 'hall'), 'live: a hall-only track')
		// §2.7: the live hall (27 × 61 m, banquet tables) carries ≥ 2 whole-room deck tracks, and a height field
		const H = json.floors.find((f) => f.id === 'hall').rect
		if (Math.max(H[2] - H[0], H[3] - H[1]) >= 50) assert.ok(json.tracks.filter((x) => x.kind === 'room-long').length >= 2, 'live: ≥ 2 room-long tracks')
		assert.ok(json.heights && typeof json.heights.data === 'string', 'live: heights in the scene JSON')
	}
	assert.ok(json.obstacles.length <= 300)
	assert.ok(glb.length <= 8 * 1024 * 1024 && json.stats.triangles <= 400000, `${glb.length} bytes, ${json.stats.triangles} triangles`)
})
