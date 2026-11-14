'use strict'

/**
 * WO-1074 §2.7 — the deck half of `validateTrack` (rc-track-check.js): elevated decks, slab ramps (a ramp joining two
 * decks), bridges, clearances against the scene's height field, and the whole-room rules of `kind: 'room-long'`.
 * Pure; called with the geometry the main check already measured.
 *
 * Rules (work/notes/rc-game-contract.md §2.7):
 *   - a deck is at least 0.6 m above the floor under it, or level with a floor (a stage-level deck joining the stage —
 *     it may reach out over the hall: the clearance below is then the whole space down to the hall floor);
 *   - a deck { from, to } is ≥ 2 segments, flat, overlaps no ramp / drop / other deck, is entered from a ramp, a floor
 *     (the stage, level with it) or a drop (a "landing deck" starts at the drop's first flight point and lies under the
 *     whole flight), and left onto a ramp, a floor or a drop (`at` = its last point);
 *   - width ≥ 4 m on a deck; turn radius ≥ 6 m on a deck (a ramp interior keeps its 8 m);
 *   - clearance: nothing of the scene within 0.6 m below a deck or 1.0 m above it (height field `scene.heights`, the
 *     footprint + the rails); the same for a slab ramp along its slope; a skirted ramp needs the space from the floor up
 *     to 1.0 m above its surface clear (its skirts reach the floor). Without a height field: the obstacle boxes only;
 *   - a plan crossing / overlap is a bridge when the two ribbons are ≥ 1.2 m apart in height there and the upper one is
 *     a deck or a slab ramp; no checkpoint sits on a bridge or under one, nor where a car past a drop flies over it;
 *   - `kind: 'room-long'`: length ≥ min(120 m, 2.2 × the hall's longer side), the centre line's extent covers ≥ 70 % of
 *     the hall rect's longer side and ≥ 50 % of its shorter side, it visits the stage (when there is one), and the
 *     14 m of centre line behind its start line (the grid) are level and straight (≤ 3° of turn in all).
 */

const G = require('./rc-track-geo')
const { GROUND_TOL, floorGround, rampIndices, slabRamp } = require('./rc-ground')
const { fieldOf } = require('./rc-scene-height')

const KINDS = ['stage-short', 'room', 'room-long', 'hall']
const DECK_MIN_WIDTH = 4
const RADIUS_DECK = 6
const BELOW = 0.6 // clear under a deck
const ABOVE = 1.0 // clear over a deck
const RAIL_W = 0.2 // the rails stand just outside the road
const BRIDGE = 1.2 // two ribbons crossing in plan are at least this far apart in height
const LONG_MIN = 120
const LONG_HALL = 2.2
const COVER_LONG = 0.7
const COVER_SHORT = 0.5
const GRID_STRAIGHT = 14 // a room-long track's grid stands on this much straight, level road
const BELOW_SLACK = 0.05 // the floor itself never counts

/**
 * Per-index deck bookkeeping → { error } or { deckSeg, deckPt, slabSeg, slabPt, deckEnd: Set }. A deck may start at a
 * drop's first flight point (a landing deck under the whole flight: the drop lands on it); otherwise it overlaps no
 * ramp, drop or other deck.
 */
function deckBook(track, n, rampSeg, dropSeg, lip = new Set()) {
	const deckSeg = new Uint8Array(n), deckPt = new Uint8Array(n), slabSeg = new Uint8Array(n), slabPt = new Uint8Array(n)
	const deckEnd = new Set()
	if (track.decks == null) return { deckSeg, deckPt, slabSeg, slabPt, deckEnd }
	if (!Array.isArray(track.decks)) return { error: 'decks must be an array' }
	for (const [k, d] of track.decks.entries()) {
		const idx = rampIndices(d, n)
		if (idx.length < 3) return { error: `deck ${k}: bad range` }
		for (let j = 0; j < idx.length; j++) {
			if (j < idx.length - 1) {
				const i = idx[j]
				const flightOk = dropSeg[i] && !lip.has(i) && lip.has((d.from - 1 + n) % n) // a landing deck's flight part
				if (deckSeg[i] || rampSeg[i] || (dropSeg[i] && !flightOk) || lip.has(i)) return { error: `deck ${k} overlaps a ramp, a drop or another deck` }
				deckSeg[idx[j]] = 1
			}
			deckPt[idx[j]] = 1
		}
		deckEnd.add(d.from).add(d.to)
	}
	for (const r of track.ramps) {
		if (!slabRamp(track, r)) continue
		const idx = rampIndices(r, n)
		for (let j = 0; j < idx.length; j++) {
			if (j < idx.length - 1) slabSeg[idx[j]] = 1
			slabPt[idx[j]] = 1
		}
	}
	return { deckSeg, deckPt, slabSeg, slabPt, deckEnd }
}

/** Is anything of the scene in (yLo, yHi) within `r` of (x, z)? Field when present, else the obstacle boxes. */
function blockedBand(scene, field, x, z, r, yLo, yHi) {
	if (field) return field.bandHit(x, z, r, yLo, yHi)
	for (const o of scene?.obstacles || []) {
		if (!o || o.max[1] <= yLo || o.min[1] >= yHi) continue
		if (G.pointRectDist([x, z], [o.min[0], o.min[2], o.max[0], o.max[2]]) < r) return true
	}
	return false
}

/** Samples along segment i → i+1 (both ends + every ≤ 0.5 m) as [x, y, z]. */
function samples(P, Y, i, n) {
	const j = (i + 1) % n
	const k = Math.max(1, Math.ceil(G.dist(P[i], P[j]) / 0.5))
	const out = []
	for (let q = 0; q <= k; q++) out.push([P[i][0] + ((P[j][0] - P[i][0]) * q) / k, Y[i] + ((Y[j] - Y[i]) * q) / k, P[i][1] + ((P[j][1] - P[i][1]) * q) / k])
	return out
}

/**
 * The deck rules → error text or null. ctx: { P, Y, n, half, width, rampSeg, rampPt, dropSeg, lip, landAt, book }.
 */
function checkDecks(track, scene, ctx) {
	const { P, Y, n, half, width, rampSeg, lip, landAt, book } = ctx
	const field = fieldOf(scene)
	const onFloor = (i) => {
		const g = floorGround(scene, P[i][0], P[i][1])
		return g != null && Math.abs(Y[i] - g) <= GROUND_TOL
	}
	for (const [k, d] of (track.decks || []).entries()) {
		const idx = rampIndices(d, n)
		if (width < DECK_MIN_WIDTH - 1e-9) return `deck ${k}: width ${width} < ${DECK_MIN_WIDTH} m`
		for (const i of idx) if (Math.abs(Y[i] - Y[d.from]) > GROUND_TOL) return `deck ${k} is not flat at ${i}`
		if (!(rampSeg[(d.from - 1 + n) % n] || onFloor(d.from) || landAt.has(d.from) || lip.has((d.from - 1 + n) % n))) return `deck ${k} is not entered from a ramp, a floor or a drop`
		if (!(rampSeg[d.to] || onFloor(d.to) || lip.has(d.to))) return `deck ${k} is not left onto a ramp, a floor or a drop`
		for (const i of idx.slice(0, -1)) {
			for (const [x, y, z] of samples(P, Y, i, n)) {
				const g = floorGround(scene, x, z)
				if (g == null) return `deck ${k} leaves the floor at ${i}`
				// level with a floor (a deck joining the stage, also where it reaches out over the hall) or ≥ BELOW above it
				const level = (scene?.floors || []).some((f) => Math.abs(y - f.y) <= GROUND_TOL)
				if (!level && y - g < BELOW - 1e-6) return `deck ${k} is ${(y - g).toFixed(2)} m above the floor at ${i} (< ${BELOW})`
				if (blockedBand(scene, field, x, z, half + RAIL_W, Math.max(g + BELOW_SLACK, y - BELOW), y + ABOVE)) return `deck ${k}: scene geometry within ${BELOW} m below or ${ABOVE} m above at ${i}`
			}
		}
	}
	// ramps: a slab ramp needs the deck clearances along its slope, a skirted one the space down to the floor
	for (let i = 0; i < n; i++) {
		if (!rampSeg[i]) continue
		const slab = book.slabSeg[i]
		for (const [x, y, z] of samples(P, Y, i, n)) {
			const g = floorGround(scene, x, z)
			if (g == null) continue // the main check reports it
			// a skirted ramp: nothing under its surface (the skirts reach the floor) or within 1 m above it; the foot of a
			// ramp (< 0.15 m up) is the obstacle check's
			if (!slab && y - g < 0.15) continue
			const lo = slab ? Math.max(g + BELOW_SLACK, y - BELOW) : g + BELOW_SLACK
			if (blockedBand(scene, field, x, z, slab ? half + RAIL_W : half - 0.3, lo, y + ABOVE)) return `ramp at ${i}: scene geometry ${slab ? 'within the deck clearances' : 'under it or within 1 m above it'}`
		}
	}
	return null
}

/** Pairs (i, j) of segments overlapping in plan that form a bridge (≥ 1.2 m apart, the upper one a deck / slab). */
function bridgeSkip(Y, n, book) {
	return (i, j) => {
		const i1 = (i + 1) % n, j1 = (j + 1) % n
		const sep = Math.min(...[[i, j], [i, j1], [i1, j], [i1, j1]].map(([a, b]) => Math.abs(Y[a] - Y[b])))
		if (sep < BRIDGE - 1e-6) return false
		const up = Y[i] + Y[i1] > Y[j] + Y[j1] ? i : j
		return !!(book.deckSeg[up] || book.slabSeg[up])
	}
}

/** Points on a bridge or under one: within `width` (plan) of a part of the track ≥ 1.2 m above / below → Uint8Array. */
function bridgePoints(P, Y, n, width) {
	const out = new Uint8Array(n)
	const win = Math.max(3, Math.ceil((Math.PI * width) / (G.polyLength(P) / n)))
	for (let c = 0; c < n; c++) {
		for (let j = 0; j < n && !out[c]; j++) {
			const sep = Math.min(Math.abs(j - c), n - Math.abs(j - c))
			if (sep > win && Math.abs(Y[j] - Y[c]) >= BRIDGE - 1e-6 && G.dist(P[c], P[j]) < width) out[c] = 1
		}
	}
	return out
}

/** No checkpoint on a bridge or under one (`bridgePoints`). */
function checkpointsOffBridges(track, P, Y, n, width) {
	const on = bridgePoints(P, Y, n, width)
	for (const [k, c] of (track.checkpoints || []).entries()) if (on[c]) return `checkpoint ${k} is on or under a bridge`
	return null
}

/*
 * A checkpoint is a gate the client counts only for a car between 1.0 m under and GATE_ABOVE over the centre line there
 * (game/rc/track-math.js). Past a high drop's lip a fast car is still higher than that — so no checkpoint from the lip
 * until a car at AIR_V (the hard speed cap) has come down to GATE_ABOVE − AIR_MARGIN over the road (client gravity).
 */
const GATE_ABOVE = 1.3, AIR_MARGIN = 0.2, AIR_V = 24, AIR_G = 20

/** Points a car may still fly over too high for a gate: each drop's lip + 1 … land − 1, and on until reach. */
function airPoints(track, P, Y, n) {
	const out = new Uint8Array(n)
	for (const d of track.drops || []) {
		const h = Y[d.at] - Y[d.land]
		const reach = AIR_V * Math.sqrt(Math.max(0, (2 * (h - GATE_ABOVE + AIR_MARGIN)) / AIR_G))
		const air = (d.land - d.at + n) % n
		let along = 0
		for (let j = 1; j < n; j++) {
			const i = (d.at + j) % n
			along += G.dist(P[(i - 1 + n) % n], P[i])
			if (j >= air && along >= reach) break
			out[i] = 1
		}
	}
	return out
}

/** No checkpoint where a car may fly over it too high to count (`airPoints`). */
function checkpointsLanded(track, P, Y, n) {
	const air = airPoints(track, P, Y, n)
	for (const [k, c] of (track.checkpoints || []).entries()) if (air[c]) return `checkpoint ${k} is in the air past a drop (a car flies over it)`
	return null
}

/** Whole-room rules for kind 'room-long' → error text or null. */
function checkLong(track, scene, P, Y, L) {
	const floors = scene?.floors || []
	const hall = floors.find((f) => f.id === 'hall')
	if (!hall) return 'a room-long track needs a hall'
	const r = hall.rect
	const w = r[2] - r[0], d = r[3] - r[1]
	const need = Math.min(LONG_MIN, LONG_HALL * Math.max(w, d))
	if (L < need - 1e-6) return `room-long: ${L.toFixed(1)} m < ${need.toFixed(1)} m`
	const b = G.bbox(P)
	const ex = b[2] - b[0], ez = b[3] - b[1]
	const [eLong, eShort] = w >= d ? [ex, ez] : [ez, ex]
	if (eLong < COVER_LONG * Math.max(w, d) - 1e-6) return `room-long: covers ${eLong.toFixed(1)} m of the hall's ${Math.max(w, d).toFixed(1)} m (< 70 %)`
	if (eShort < COVER_SHORT * Math.min(w, d) - 1e-6) return `room-long: covers ${eShort.toFixed(1)} m of the hall's ${Math.min(w, d).toFixed(1)} m (< 50 %)`
	const stage = floors.find((f) => f.id === 'stage')
	if (stage && !P.some((p, i) => G.inRect(p[0], p[1], stage.rect) && Math.abs(Y[i] - stage.y) <= GROUND_TOL)) return 'room-long: does not visit the stage'
	// the 10-slot grid stands on a straight: the GRID_STRAIGHT m of centre line behind the start line turn ≤ 3° and stay level
	const n = P.length
	let back = 0, bend = 0
	for (let i = n - 1; back < GRID_STRAIGHT && i > 0; i--) {
		const a = P[i - 1], b = P[i], c = P[(i + 1) % n]
		back += G.dist(a, b)
		bend += Math.abs(G.angleDiff(Math.atan2(c[1] - b[1], c[0] - b[0]), Math.atan2(b[1] - a[1], b[0] - a[0])))
		if (Math.abs(Y[i - 1] - Y[0]) > GROUND_TOL) return `room-long: the grid's ${GRID_STRAIGHT} m behind the start line is not level`
	}
	if (bend > (3 * Math.PI) / 180) return `room-long: the grid's ${GRID_STRAIGHT} m behind the start line is not straight`
	return null
}

module.exports = { KINDS, RADIUS_DECK, BRIDGE, BELOW, ABOVE, RAIL_W, LONG_MIN, LONG_HALL, COVER_LONG, COVER_SHORT, GRID_STRAIGHT, deckBook, checkDecks, bridgeSkip, bridgePoints, checkpointsOffBridges, airPoints, checkpointsLanded, checkLong }
