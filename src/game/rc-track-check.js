'use strict'

/**
 * WO-1074 v2 — `validateTrack` (pure): is a 3D track drivable on the scene? The generator (rc-tracks.js) emits only
 * tracks this accepts, the smokes run it on every generated track. Rules: work/notes/rc-game-contract.md §2.1, the
 * ground model in rc-ground.js. Points are [x, y, z]; spacing, length and radii are measured in plan (x, z).
 */

const G = require('./rc-track-geo')
const { GROUND_TOL, WALL_STEP, ground, floorGround, rampIndices, obstacleHits } = require('./rc-ground')
const { checkDeco, GRID_SLOTS } = require('./rc-track-check-deco')
const DK = require('./rc-track-check-deck')
const { checkOcc } = require('./rc-track-check-occ')
const SC = require('./rc-scale')

const CAR_HEIGHT = 0.6 // the scene's obstacle boxes cover a floor's car slab (floor.y … + 0.6)
const MIN_POINTS = 60
const MAX_POINTS = 200
const MIN_WIDTH = 2.5
const MIN_HALL_WIDTH = 4
const MAX_WIDTH = 6
const RADIUS_HALL = 3
const RADIUS_STAGE = 1.8
const RADIUS_RAMP = 8
const MAX_SLOPE = (18 * Math.PI) / 180
const MAX_KINK = (6 * Math.PI) / 180
const DROP_MIN = 3
const DROP_MAX = 8
const LAND_RUN = 4 // metres past `land` that must be clear (a fast car lands long)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** Cyclic index range a → b (inclusive). */
function span(a, b, n) {
	const out = []
	for (let i = a; ; i = (i + 1) % n) {
		out.push(i)
		if (i === b || out.length > n) return out
	}
}

/**
 * Is `track` drivable on `scene` ({ floors, obstacles })? → { ok, errors[] }. `opts.maxCrossings` defaults to 1 for a
 * figure-eight (id contains "eight") and 0 otherwise. §3 toy scale: a scene with `scale` < 1 (or opts.scale) is judged
 * in the unit frame (rc-scale.js: every length ÷ scale, so each rule holds with its lengths × scale) plus the toy rules
 * (`scene.toy` of the unit scene: ≤ 2500 points, width 0.30–0.45 m, the occupancy grids — rc-track-check-occ.js).
 */
function validateTrack(track, scene, opts = {}) {
	const errors = []
	const fail = (m) => (errors.push(m), { ok: false, errors })
	if (!track || typeof track !== 'object') return fail('no track')
	const scl = SC.sceneScale(scene, opts)
	if (scl !== 1 && !scene?.toy) return validateTrack(SC.scaleTrack(track, 1 / scl), SC.toUnitScene(scene, scl), { ...opts, scale: 1 })
	const toy = scene?.toy || null
	if (typeof track.id !== 'string' || !track.id) return fail('no id')
	if (track.laps != null && !(Number.isInteger(track.laps) && track.laps >= 1 && track.laps <= 20)) return fail(`laps ${track.laps} (1–20)`)
	const pts = track.points
	const maxPts = toy ? toy.maxPoints : MAX_POINTS
	if (!Array.isArray(pts) || pts.length < MIN_POINTS || pts.length > maxPts) return fail(`points: ${pts?.length} (60–${maxPts})`)
	if (!pts.every((p) => Array.isArray(p) && p.length === 3 && p.every(finite))) return fail('points must be finite [x, y, z]')
	if (track.closed !== true) return fail('not closed')
	const n = pts.length
	const P = G.plan(pts)
	const Y = pts.map((p) => p[1])
	if (G.dist(P[0], P[n - 1]) < 1e-6) return fail('last point repeats the first')
	const width = track.width
	const floors = (scene?.floors || []).filter((f) => f && Array.isArray(f.rect))
	const stage = floors.find((f) => f.id === 'stage')
	const own = floors.find((f) => f.id === track.floor)
	if (track.floor !== 'room' && !own) return fail(`no floor "${track.floor}"`)
	if (track.kind != null && !DK.KINDS.includes(track.kind)) return fail(`kind "${track.kind}" (${DK.KINDS.join(' | ')})`)
	const minW = track.floor === 'room' || track.floor === 'stage' ? MIN_WIDTH : MIN_HALL_WIDTH
	if (!finite(width) || width < minW - 1e-9 || width > MAX_WIDTH) return fail(`width ${width} (${minW}–${MAX_WIDTH} for "${track.floor}")`)
	if (toy && (width < toy.minWidth - 1e-6 || width > toy.maxWidth + 1e-6)) return fail(`toy: width ${(width * toy.s).toFixed(3)} m (${SC.TOY_WIDTH.join('–')})`)
	const { s, total: L } = G.arcLengths(P)
	if (!finite(track.length) || Math.abs(track.length - L) > Math.max(0.05, L * 0.01)) return fail(`length ${track.length} ≠ ${L.toFixed(2)} (plan)`)
	const mean = L / n
	for (let i = 0; i < n; i++) {
		const d = G.dist(P[i], P[(i + 1) % n])
		if (d < mean * 0.9 || d > mean * 1.1) return fail(`uneven spacing at ${i}`)
	}
	const along = (a, b) => (s[b] - s[a] + L) % L // plan distance a → b in driving order
	const half = width / 2

	// --- ramps and drops: index bookkeeping
	if (!Array.isArray(track.ramps) || !Array.isArray(track.drops)) return fail('ramps and drops must be arrays')
	const rampSeg = new Uint8Array(n) // segment i → i+1 is on a ramp
	const rampPt = new Uint8Array(n) // point on a ramp (ends included)
	const rampIn = new Uint8Array(n) // interior point of a ramp
	const flight = new Uint8Array(n) // a drop's airborne stretch (at+1 … land−1): no ribbon drawn there
	const dropSeg = new Uint8Array(n) // segments at … land−1
	const lip = new Set()
	const landAt = new Set()
	for (const [k, r] of track.ramps.entries()) {
		const idx = rampIndices(r, n)
		if (idx.length < 4) return fail(`ramp ${k}: bad range`)
		for (let j = 0; j < idx.length; j++) {
			if (j < idx.length - 1) {
				if (rampSeg[idx[j]]) return fail(`ramp ${k} overlaps another ramp`)
				rampSeg[idx[j]] = 1
			}
			rampPt[idx[j]] = 1
			if (j && j < idx.length - 1) rampIn[idx[j]] = 1
		}
	}
	for (const [k, d] of track.drops.entries()) {
		if (!d || !Number.isInteger(d.at) || !Number.isInteger(d.land) || d.at < 0 || d.land < 0 || d.at >= n || d.land >= n) return fail(`drop ${k}: bad indices`)
		const idx = span(d.at, d.land, n)
		if (idx.length < 3) return fail(`drop ${k}: land must be after at`)
		const D = along(d.at, d.land)
		if (D < DROP_MIN - 1e-6 || D > DROP_MAX + 1e-6) return fail(`drop ${k}: land ${D.toFixed(2)} m beyond at (3–8)`)
		for (let j = 0; j < idx.length - 1; j++) {
			if (dropSeg[idx[j]] || rampSeg[idx[j]]) return fail(`drop ${k} overlaps a ramp or another drop`)
			dropSeg[idx[j]] = 1
			if (j) flight[idx[j]] = 1
		}
		if (rampIn[d.land]) return fail(`drop ${k} lands on a ramp`)
		lip.add(d.at)
		landAt.add(d.land)
	}
	const book = DK.deckBook(track, n, rampSeg, dropSeg, lip)
	if (book.error) return fail(book.error)

	// --- every point lies on the ground model (flight points on the floor below them)
	for (let i = 0; i < n; i++) {
		const g = ground(scene, track, P[i][0], P[i][1], Y[i])
		if (g == null) return fail(`point ${i} has no ground under it`)
		if (Math.abs(Y[i] - g) > GROUND_TOL) return fail(`point ${i} is not on the ground (y ${Y[i]}, ground ${g.toFixed(3)})`)
	}
	for (const [k, r] of track.ramps.entries()) {
		const idx = rampIndices(r, n)
		let peak = 0
		for (const [j, i] of idx.entries()) {
			const g0 = floorGround(scene, P[i][0], P[i][1])
			if (g0 == null) return fail(`ramp ${k} point ${i} is over no floor`)
			const end = (j === 0 || (j === idx.length - 1 && !lip.has(i))) && !book.deckEnd.has(i)
			if (end && Math.abs(Y[i] - g0) > GROUND_TOL) return fail(`ramp ${k} does not meet the floor at ${i}`)
			if (Y[i] < g0 - GROUND_TOL) return fail(`ramp ${k} dips under the floor at ${i}`)
			peak = Math.max(peak, Y[i] - g0)
		}
		if (peak < 0.1) return fail(`ramp ${k} is flat`)
	}

	// --- level changes only on ramps (≤ 18°) and down at a drop; ramps smooth (≤ 6° between segments), radius ≥ 8 m
	const pitch = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n
		const dy = Y[j] - Y[i], d = G.dist(P[i], P[j])
		pitch[i] = Math.atan2(dy, d)
		if (rampSeg[i]) {
			if (Math.abs(pitch[i]) > MAX_SLOPE + 1e-6) return fail(`ramp slope ${((Math.abs(pitch[i]) * 180) / Math.PI).toFixed(1)}° > 18° at ${i}`)
		} else if (lip.has(i) && dropSeg[i]) {
			if (dy > -WALL_STEP) return fail(`drop at ${i} does not go down a ledge`)
		} else if (Math.abs(dy) > GROUND_TOL) return fail(`step of ${dy.toFixed(3)} m at ${i} outside a ramp or drop`)
	}
	for (const [k, r] of track.ramps.entries()) {
		const idx = rampIndices(r, n)
		const segs = [(idx[0] - 1 + n) % n, ...idx.slice(0, -1)]
		if (!lip.has(idx[idx.length - 1])) segs.push(idx[idx.length - 1])
		for (let j = 1; j < segs.length; j++) {
			if (Math.abs(pitch[segs[j]] - pitch[segs[j - 1]]) > MAX_KINK + 1e-6) return fail(`ramp ${k} kinks more than 6° at ${segs[j]}`)
		}
	}
	const onStage = (i) => stage && G.inRect(P[i][0], P[i][1], stage.rect) && Math.abs(Y[i] - stage.y) <= GROUND_TOL
	const stageLevel = (i) => stage && book.deckPt[i] && Math.abs(Y[i] - stage.y) <= GROUND_TOL // a stage-level deck: the stage's rule
	for (const k of [1, 2]) {
		for (let i = 0; i < n; i++) {
			const r = G.circumradius(P[(i - k + n) % n], P[i], P[(i + k) % n])
			const min = rampIn[i] ? RADIUS_RAMP : onStage(i) || stageLevel(i) ? RADIUS_STAGE : book.deckPt[i] ? DK.RADIUS_DECK : RADIUS_HALL
			if (r < min - 1e-6) return fail(`turn radius ${r.toFixed(2)} < ${min} m at ${i}`)
		}
	}
	for (const d of track.drops) {
		for (const i of span((d.at - 1 + n) % n, (d.land + 1) % n, n)) {
			if (G.circumradius(P[(i - 1 + n) % n], P[i], P[(i + 1) % n]) < RADIUS_RAMP) return fail(`drop at ${d.at} is not straight`)
		}
	}

	// --- the road is supported across its width (no edge over a void, a wall or a different level) and clear of walls;
	// a drop's airborne stretch too (the client draws it as ribbon: the landing zone on the floor below)
	for (let i = 0; i < n; i++) {
		const a = P[(i - 1 + n) % n], b = P[(i + 1) % n]
		const tl = G.dist(a, b) || 1
		const nx = -(b[1] - a[1]) / tl, nz = (b[0] - a[0]) / tl
		const tol = rampPt[i] ? 0.08 : 0.05
		for (const o of [-1, -0.5, 0.5, 1]) {
			const off = o * (half - 0.01)
			const g = ground(scene, track, P[i][0] + nx * off, P[i][1] + nz * off, Y[i])
			if (g == null) return fail(`the road leaves the floor at ${i}`)
			if (Math.abs(g - Y[i]) > tol) return fail(`the road is not level across its width at ${i} (${(g - Y[i]).toFixed(2)} m)`)
		}
	}
	for (let i = 0; i < n; i++) {
		if (dropSeg[i]) continue
		const j = (i + 1) % n
		const top = Math.max(Y[i], Y[j])
		for (const f of floors) {
			if (f.y > top + WALL_STEP && G.segRectDist(P[i], P[j], f.rect) < half - 1e-6) return fail(`the ${f.id} side is within width/2 at ${i}`)
		}
	}

	// --- obstacles: none touching the car within width/2; a drop's landing clear by a full width
	const bx = G.bbox(P)
	const near = (scene?.obstacles || []).filter((o) => o && Array.isArray(o.min) && Array.isArray(o.max) &&
		o.max[0] >= bx[0] - width && o.min[0] <= bx[2] + width && o.max[2] >= bx[1] - width && o.min[2] <= bx[3] + width)
	const rectOf = (o) => [o.min[0], o.min[2], o.max[0], o.max[2]]
	for (let i = 0; i < n && near.length; i++) {
		if (dropSeg[i]) continue
		const j = (i + 1) % n
		const lo = Math.min(Y[i], Y[j]), hi = Math.max(Y[i], Y[j])
		for (const o of near) if (obstacleHits(o, lo, hi) && G.segRectDist(P[i], P[j], rectOf(o)) < half - 1e-9) return fail(`obstacle within width/2 at ${i}`)
	}
	for (const [k, d] of track.drops.entries()) {
		const ledge = floors.find((f) => Math.abs(f.y - Y[d.at]) <= GROUND_TOL && G.inRect(P[d.at][0], P[d.at][1], f.rect))
		const cut = ledge ? [ledge.rect[0] - 0.3, ledge.rect[1] - 0.3, ledge.rect[2] + 0.3, ledge.rect[3] + 0.3] : null
		const land = []
		for (let i = (d.at + 1) % n; ; i = (i + 1) % n) {
			land.push(i)
			if (along(d.land, i) >= LAND_RUN && along(d.at, i) > along(d.at, d.land)) break
			if (land.length > n) break
		}
		for (let m = 0; m < land.length - 1; m++) {
			const i = land[m], j = land[m + 1]
			for (const o of near) {
				if (!obstacleHits(o, Y[j])) continue
				for (const r of cut ? G.rectMinus(rectOf(o), cut) : [rectOf(o)]) {
					if (G.segRectDist(P[i], P[j], r) < width - 1e-9) return fail(`drop ${k}: landing not clear by a track width at ${i}`)
				}
			}
		}
	}

	// --- no self-intersection (a figure-eight may cross itself once, on the level)
	const maxX = opts.maxCrossings ?? (/eight/.test(track.id) ? 1 : 0)
	const sc = G.selfContacts(P, width, maxX, DK.bridgeSkip(Y, n, book))
	if (sc.zones > maxX || sc.crossings > maxX) return fail(`self-intersection (${sc.zones} zones, ${sc.crossings} crossings)`)
	for (const [i, j] of sc.pairs) if (Math.abs(Y[i] - Y[j]) > GROUND_TOL || rampPt[i] || rampPt[j]) return fail(`the road passes over itself at ${i}/${j}`)
	if (track.floor === 'room') {
		const levels = new Set(Y.map((y) => floors.find((f) => Math.abs(f.y - y) <= GROUND_TOL)?.id).filter(Boolean))
		if (track.decks?.length) levels.add('deck')
		if (levels.size < 2) return fail('a room track must use two floors (or a floor and a deck)')
	} else {
		for (let i = 0; i < n; i++) if (!rampPt[i] && !flight[i] && Math.abs(Y[i] - own.y) > GROUND_TOL) return fail(`point ${i} is off the ${own.id} floor`)
	}

	const occErr = checkOcc(track, scene, { P, Y, n, half, width, book, along })
	if (occErr) return fail(occErr)
	const deckErr = DK.checkDecks(track, scene, { P, Y, n, half, width, rampSeg, lip, landAt, book }) ||
		DK.checkpointsOffBridges(track, P, Y, n, width) || DK.checkpointsLanded(track, P, Y, n) || (track.kind === 'room-long' ? DK.checkLong(track, scene, P, Y, L) : null)
	if (deckErr) return fail(deckErr)
	return checkDeco(track, scene, { P, Y, s, L, n, half, rampSeg, dropSeg, flight, along, near, errors })
}

module.exports = { CAR_HEIGHT, GRID_SLOTS, MIN_WIDTH, MIN_HALL_WIDTH, MIN_POINTS, RADIUS_RAMP, validateTrack }
