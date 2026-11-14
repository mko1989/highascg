'use strict'

/**
 * WO-1074 v2 — RC car game: race tracks generated from the scene's floors and obstacles (pure, deterministic for a given
 * input; contract work/notes/rc-game-contract.md §2.1). Every emitted track passes `validateTrack`.
 *   - whole-room tracks (rc-track-sky.js, §2.7, kind 'room-long'): stage → ramp → elevated decks over the furnished
 *     hall (bridges, slab ramps, drops) → stage, when a stage stands above a hall big enough for them;
 *   - room tracks (rc-track-room.js): hall → ramp → stage → ramp / drop → hall, when a stage stands above the hall;
 *   - single-floor tracks (this file): shape families (ring around the stage, loop, GP, slalom, figure-eight) fitted
 *     into the floor's free regions by a fixed search; on the hall the first one gets a kicker (ramp + lip + drop), and
 *     with no stage a table-top (a generated bridge: up, across, down) — so ramps exist on every scene that has room;
 *   - fewer than two tracks → a 30 × 20 m arena floor (beside the scene when its middle is blocked).
 * The search is a generator that yields between tries so the bake can keep the event loop free.
 */

const { validateTrack } = require('./rc-track-check')
const { buildTrack } = require('./rc-track-build')
const PL = require('./rc-track-plan')
const { freeRegions } = require('./rc-track-space')
const { roomJobs, RS, RH } = require('./rc-track-room')
const { skyJobs } = require('./rc-track-sky')
const { toyJobs } = require('./rc-toy-tracks')
const { sceneScale } = require('./rc-scale')

const GENERATOR_VERSION = 6 // part of the scene rev: bump when the tracks change for the same scene
const EDGE = 0.25 // extra margin between the road edge and the floor edge
const DEFAULT_ARENA = { w: 30, d: 20 }
const KICKER_H = 0.45
const TABLETOP_H = 0.5
const STAGE_WIDTHS = [3.5, 3, 2.5]
const HALL_WIDTHS = [4.5, 4]

const JUMP = [{ kicker: KICKER_H, as: 'jump' }, { kicker: KICKER_H, run: 1, as: 'jump' }] // longest straight, else the next
const BRIDGE = [{ tabletop: TABLETOP_H, as: 'bridge' }, { tabletop: TABLETOP_H, run: 1, as: 'bridge' }]
const PLAIN = [{}]

/**
 * Families per floor kind: [shape family, feature variants in order]. A variant with `as` names the track after its
 * feature ("Hall jump", "Hall bridge"), a plain one after the family ("Hall GP"); an id already taken is skipped.
 */
function familiesFor(floor, hasStage) {
	if (floor.id === 'stage') return [['oval', PLAIN], ['gp', PLAIN], ['slalom', PLAIN]]
	if (hasStage) return [['ring', PLAIN], ['loop', JUMP], ['gp', [...JUMP, {}]], ['slalom', PLAIN]]
	return [['loop', [...BRIDGE, {}]], ['gp', [...JUMP, {}]], ['slalom', PLAIN], ['figure-eight', PLAIN]]
}

const FAMILY_NAMES = { oval: 'oval', loop: 'loop', gp: 'GP', slalom: 'slalom', 'figure-eight': 'figure-eight', ring: 'ring' }

function naming(floor, family, features) {
	const label = String(floor.id).charAt(0).toUpperCase() + String(floor.id).slice(1)
	if (family === 'ring') return { id: `${floor.id}-ring`, name: 'Stage ring' }
	const suffix = features.as || family
	return { id: `${floor.id}-${suffix}`, name: `${label} ${features.as || FAMILY_NAMES[family]}` }
}

/** Candidate placements: the region at shrinking sizes, centred then shifted, long axis first along the long side. */
function* placements(avail, family, caps = null) {
	const aw = avail[2] - avail[0], ad = avail[3] - avail[1]
	if (aw <= 0 || ad <= 0) return
	const cap = caps?.[family] ?? (family === 'loop' ? 60 : 34)
	for (const s of [1, 0.8, 0.6]) {
		for (const turned of [false, true]) {
			const W = turned ? ad : aw, D = turned ? aw : ad
			const w = Math.min(W * s, cap), d = Math.min(D * s, cap)
			const sx = turned ? d : w, sz = turned ? w : d
			const seen = new Set()
			for (const [fx, fz] of [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) {
				const ox = fx * (aw - sx), oz = fz * (ad - sz)
				const key = `${ox.toFixed(2)},${oz.toFixed(2)}`
				if (seen.has(key)) continue
				seen.add(key)
				yield { w, d, turned, cx: (avail[0] + avail[2]) / 2 + ox, cz: (avail[1] + avail[3]) / 2 + oz }
			}
			if (Math.abs(aw - ad) < 1e-6) break
		}
	}
}

/** A hall loop around a stage standing on this floor (gap = road edge ↔ stage edge). */
function* ringPlans(scene, floor, width) {
	const st = (scene.floors || []).find((f) => f.id === 'stage')
	if (!st || st.y < floor.y + 0.1) return
	const sr = st.rect
	for (const gap of [0.4, 1.5, 3]) {
		const m = width / 2 + gap
		const r = [sr[0] - m, sr[1] - m, sr[2] + m, sr[3] + m]
		const f = PL.filletPolygon([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], Math.max(m, RH))
		if (f) yield f.pts
	}
}

/**
 * One family on one floor → generator of null between tries, the track last (or nothing). `taken`: ids in use.
 * opts (§3 toy scale, unit frame): { widths: [allowed], caps: { family: max size }, meta: extra buildTrack meta }.
 */
function* searchFamily(scene, floor, fam, taken, opts = {}) {
	const [family, variants] = fam
	const stageLike = floor.id === 'stage'
	const rMin = stageLike ? RS : RH
	const short = Math.min(floor.rect[2] - floor.rect[0], floor.rect[3] - floor.rect[1])
	const widths = (opts.widths || (stageLike ? STAGE_WIDTHS : HALL_WIDTHS)).filter((w) => w <= short / 1.6)
	for (const features of variants) {
		const { id, name } = naming(floor, family, features)
		if (taken.has(id)) continue
		for (const width of widths) {
			const meta = { id, name, floor: floor.id, y: floor.y, width, features, ...opts.meta }
			const ok = (dense) => {
				const t = dense && buildTrack(dense, meta, scene)
				return t && validateTrack(t, scene).ok ? t : null
			}
			if (family === 'ring') {
				for (const dense of ringPlans(scene, floor, width)) {
					const t = ok(dense)
					if (t) return yield t
					yield null
				}
				continue
			}
			const m = width / 2 + EDGE
			const avail = [floor.rect[0] + m, floor.rect[1] + m, floor.rect[2] - m, floor.rect[3] - m]
			const regions = freeRegions(floor, scene.obstacles, width, 4, scene.floors)
			if (avail[2] > avail[0] && avail[3] > avail[1] && !regions.some((r) => r.every((v, i) => Math.abs(v - avail[i]) < 1e-6))) regions.push(avail)
			for (const region of regions) {
				for (const shapeVariant of family === 'gp' ? [0, 1, 2] : [0]) {
					for (const at of placements(region, family, opts.caps)) {
						const shape = PL.shapeOf(family, at.w, at.d, shapeVariant, rMin)
						const t = shape && ok(PL.place(shape, at))
						if (t) return yield t
						yield null
					}
				}
			}
		}
	}
}

/**
 * Generator over the whole scene: yields null between tries and { done, tracks, floors, bounds } last. A scene (or
 * opts.scale) at a toy scale (§3, < 1) gets the toy track set (rc-toy-tracks.js) instead.
 */
function* trackJobs(scene, opts = {}) {
	const scale = sceneScale(scene, opts)
	if (scale !== 1) return yield* toyJobs(scene, scale, { searchFamily })
	const floors = (scene?.floors || []).filter((f) => f && Array.isArray(f.rect))
	const tracks = []
	const sc = { floors: [...floors], obstacles: scene?.obstacles || [], bounds: scene?.bounds, field: scene?.field || null }
	const hasStage = floors.some((f) => f.id === 'stage') && floors.some((f) => f.id === 'hall')
	for (const jobs of [skyJobs(sc), roomJobs(sc)]) {
		for (const t of jobs) {
			if (t) tracks.push(t)
			else yield null
		}
	}
	const runFloor = function* (floor, max) {
		let got = 0
		for (const fam of familiesFor(floor, hasStage && floor.id !== 'arena')) {
			if (got >= max) return
			for (const t of searchFamily(sc, floor, fam, new Set(tracks.map((x) => x.id)))) {
				if (t) tracks.push(t), got++
				else yield null
			}
		}
	}
	const order = [...floors].sort((a, b) => (a.id === 'stage' ? 1 : b.id === 'stage' ? -1 : 0))
	for (const f of order) yield* runFloor(f, f.id === 'stage' ? 1 : hasStage ? 2 : 4)
	const bounds = scene?.bounds ? { min: [...scene.bounds.min], max: [...scene.bounds.max] } : null
	if (tracks.length < 2) {
		const hall = floors.find((f) => f.id === 'hall')
		const y = hall ? hall.y : 0
		const b = bounds || { min: [-15, y, -10], max: [15, y + 5, 10] }
		const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2
		const { w, d } = DEFAULT_ARENA
		for (const x0 of [cx - w / 2, b.max[0] + 2, b.min[0] - 2 - w]) {
			const arena = { id: 'arena', y, rect: [x0, cz - d / 2, x0 + w, cz + d / 2] }
			sc.floors = [...floors, arena]
			const before = tracks.length
			yield* runFloor(arena, 4)
			if (tracks.length >= 2) {
				floors.push(arena)
				if (tracks.length > before && bounds) {
					bounds.min[0] = Math.min(bounds.min[0], arena.rect[0]); bounds.max[0] = Math.max(bounds.max[0], arena.rect[2])
					bounds.min[2] = Math.min(bounds.min[2], arena.rect[1]); bounds.max[2] = Math.max(bounds.max[2], arena.rect[3])
				}
				break
			}
			tracks.splice(before)
		}
	}
	yield { done: true, tracks, floors, bounds }
}

/** Tracks for `scene` ({ floors, obstacles, bounds[, scale, occ, field] }) → { tracks, floors (+ an arena when needed), bounds }. */
function generateTracks(scene, opts = {}) {
	for (const r of trackJobs(scene, opts)) if (r && r.done) return r
	return { tracks: [], floors: [], bounds: null }
}

/** Same as generateTracks, awaiting `pause()` every `every` tries (the bake keeps the event loop free). */
async function generateTracksAsync(scene, pause, every = 4, opts = {}) {
	let k = 0
	for (const r of trackJobs(scene, opts)) {
		if (r && r.done) return r
		if (++k % every === 0) await pause()
	}
	return { tracks: [], floors: [], bounds: null }
}

module.exports = { generateTracks, generateTracksAsync, validateTrack, GENERATOR_VERSION }
