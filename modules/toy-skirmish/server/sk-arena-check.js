'use strict'

/**
 * WO-1081 — Stage Skirmish: `validateArena` — every rule of contract §4 checked on an arena as it is served (world
 * metres; u = the scene's scale). An arena that fails is left out by the generator (sk-arenas.js); the smokes run it on
 * every generated arena, synthetic and live.
 *   - one floor of the scene; y = that floor's y; rect inside the floor rect, 25–80 u per side, snapped to the floor's
 *     grid; a hall arena never overlaps a higher floor standing on it (the stage: a wall the hall grid does not show)
 *   - blocks: yaw 0 or π/2, colour 0–5, h ≥ 0.6 u, inside the rect
 *   - 8–40 % of the arena's cells solid (occ ∪ blocks)
 *   - ≥ 10 spawns, ≥ 6 u apart, ≥ 1 u from anything solid (exact, incl. the edge); team 0 / 1 = the two halves along the
 *     longer side; every team has spawns
 *   - every weapon ≥ 1, 2–4 health, 1–2 armour, exactly one surge unless a side is under 30 u (then none); ids 0…n−1;
 *     pickups ≥ 4 u apart, ≥ 3 u from every spawn, on a cell a soldier fits
 *   - all spawns and pickups in ONE connected region of the free cells eroded by the soldier radius
 * floorOcc(scene, id) is the grid both sides rasterise into (the floor's `occ`, or an empty 0.3 u grid over its rect).
 */

const R = require('./sk-rules')
const G = require('./sk-grid')
const { kit } = require('./sk-kit')

const EPS = 1e-6

/** The decoded occupancy grid of floor `id` (cached on the scene's occ entry), or an empty grid over the floor rect. */
function floorOcc(scene, id) {
	for (const o of Array.isArray(scene?.occ) ? scene.occ : []) {
		if (o && o.floor === id) {
			const g = kit().occFromJSON(o)
			if (g) return g
		}
	}
	const f = (scene?.floors || []).find((x) => x && x.id === id)
	if (!f) return null
	const cell = G.CELL_U * sceneScaleOf(scene)
	const w = Math.max(1, Math.ceil((f.rect[2] - f.rect[0]) / cell - 1e-9)), h = Math.max(1, Math.ceil((f.rect[3] - f.rect[1]) / cell - 1e-9))
	return { floor: id, y: f.y, x0: f.rect[0], z0: f.rect[1], cell, w, h, bits: new Uint8Array(w * h), synthetic: true }
}

function sceneScaleOf(scene) {
	const s = scene?.scale
	return typeof s === 'number' && Number.isFinite(s) && s > 0 && s <= 1 ? s : 1
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/**
 * → { ok, errors: [string], stats: { size: [wU, dU], blocked, blocks, spawns, pickups } }.
 * opts.grid: the arena grid already built (generator), else built here.
 */
function validateArena(a, scene, opts = {}) {
	const errors = []
	const bad = (m) => errors.push(m)
	const s = sceneScaleOf(scene)
	const u = s
	const out = (stats = {}) => ({ ok: errors.length === 0, errors, stats })
	if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id || typeof a.name !== 'string' || !a.name) return bad('id / name'), out()
	const floor = (scene?.floors || []).find((f) => f && f.id === a.floor)
	if (!floor) return bad(`unknown floor ${a.floor}`), out()
	if (!fin(a.y) || Math.abs(a.y - floor.y) > EPS) bad('y is not the floor y')
	const r = a.rect
	if (!Array.isArray(r) || r.length !== 4 || !r.every(fin)) return bad('rect'), out()
	const wU = (r[2] - r[0]) / u, dU = (r[3] - r[1]) / u
	if (!(wU >= R.ARENA.minSide - EPS && wU <= R.ARENA.maxSide + EPS && dU >= R.ARENA.minSide - EPS && dU <= R.ARENA.maxSide + EPS)) bad(`size ${wU.toFixed(1)} × ${dU.toFixed(1)} u`)
	const fr = floor.rect
	if (r[0] < fr[0] - EPS || r[1] < fr[1] - EPS || r[2] > fr[2] + EPS || r[3] > fr[3] + EPS) bad('rect leaves the floor')
	for (const f of scene.floors) if (f !== floor && f.y > floor.y + 0.05 * s && Array.isArray(f.rect) && overlaps(r, f.rect)) bad(`rect overlaps the ${f.id} floor`)
	const occ = floorOcc(scene, a.floor)
	const snap = (v, o) => Math.abs((v - o) / occ.cell - Math.round((v - o) / occ.cell)) < 1e-4
	if (!snap(r[0], occ.x0) || !snap(r[2], occ.x0) || !snap(r[1], occ.z0) || !snap(r[3], occ.z0)) bad('rect not on the grid')
	const blocks = Array.isArray(a.blocks) ? a.blocks : []
	for (const [n, b] of blocks.entries()) {
		if (!b || ![b.x, b.z, b.w, b.d, b.h, b.yaw].every(fin) || b.w <= 0 || b.d <= 0) {
			bad(`block ${n} malformed`)
			continue
		}
		if (Math.abs(b.yaw) > EPS && Math.abs(b.yaw - Math.PI / 2) > 1e-4) bad(`block ${n} yaw ${b.yaw}`)
		if (!Number.isInteger(b.c) || b.c < 0 || b.c >= R.ARENA.colours) bad(`block ${n} colour`)
		if (b.h < R.ARENA.blockMinH * u - EPS) bad(`block ${n} lower than ${R.ARENA.blockMinH} u`)
		const br = G.blockRect(b)
		if (br[0] < r[0] - EPS || br[1] < r[1] - EPS || br[2] > r[2] + EPS || br[3] > r[3] + EPS) bad(`block ${n} outside the rect`)
	}
	const g = opts.grid || G.arenaGrid(a, occ, s)
	let solidN = 0
	for (let q = 0; q < g.bits.length; q++) solidN += g.bits[q]
	const blocked = solidN / g.bits.length
	if (blocked < R.ARENA.blocked[0] || blocked > R.ARENA.blocked[1]) bad(`blocked ${(blocked * 100).toFixed(1)} %`)
	const mask = G.passable(g, R.SOLDIER.radius * u)
	const comp = G.components(mask, g.w, g.h)
	const regions = new Set()
	const region = (x, z, what) => {
		const q = G.cellIndex(g, x, z)
		if (q < 0 || !mask[q]) return bad(`${what} not on a free cell a soldier fits`)
		regions.add(comp.label[q])
	}
	const spawns = Array.isArray(a.spawns) ? a.spawns : []
	if (spawns.length < R.ARENA.minSpawns) bad(`${spawns.length} spawns`)
	const longX = r[2] - r[0] >= r[3] - r[1]
	const mid = longX ? (r[0] + r[2]) / 2 : (r[1] + r[3]) / 2
	const teams = [0, 0]
	for (const [n, p] of spawns.entries()) {
		if (!p || ![p.x, p.z, p.yaw].every(fin) || (p.team !== 0 && p.team !== 1)) {
			bad(`spawn ${n} malformed`)
			continue
		}
		teams[p.team]++
		if (((longX ? p.x : p.z) < mid ? 0 : 1) !== p.team) bad(`spawn ${n} team is not its half`)
		if (!G.clearAt(g, p.x, p.z, R.ARENA.spawnClear * u - EPS)) bad(`spawn ${n} closer than ${R.ARENA.spawnClear} u to something solid`)
		for (let m = 0; m < n; m++) if (Math.hypot(p.x - spawns[m].x, p.z - spawns[m].z) < R.ARENA.spawnGap * u - EPS) bad(`spawns ${m} / ${n} closer than ${R.ARENA.spawnGap} u`)
		region(p.x, p.z, `spawn ${n}`)
	}
	if (!teams[0] || !teams[1]) bad('a team without spawns')
	const pickups = Array.isArray(a.pickups) ? a.pickups : []
	const count = (k) => pickups.filter((p) => p && p.kind === k).length
	for (const w of R.WEAPON_IDS) if (w !== 'pea' && count(w) < 1) bad(`no ${w}`)
	if (count('health') < R.ARENA.health[0] || count('health') > R.ARENA.health[1]) bad(`${count('health')} health`)
	if (count('armour') < R.ARENA.armour[0] || count('armour') > R.ARENA.armour[1]) bad(`${count('armour')} armour`)
	const wantSurge = Math.min(wU, dU) >= R.PICKUPS.surge.minSide - EPS ? 1 : 0
	if (count('surge') !== wantSurge) bad(`${count('surge')} surge (want ${wantSurge})`)
	for (const [n, p] of pickups.entries()) {
		if (!p || p.id !== n || !R.PICKUP_KINDS.includes(p.kind) || ![p.x, p.z].every(fin)) {
			bad(`pickup ${n} malformed`)
			continue
		}
		for (let m = 0; m < n; m++) if (Math.hypot(p.x - pickups[m].x, p.z - pickups[m].z) < R.ARENA.pickupGap * u - EPS) bad(`pickups ${m} / ${n} closer than ${R.ARENA.pickupGap} u`)
		for (const sp of spawns) if (sp && Math.hypot(p.x - sp.x, p.z - sp.z) < R.ARENA.pickupSpawnGap * u - EPS) bad(`pickup ${n} closer than ${R.ARENA.pickupSpawnGap} u to a spawn`)
		region(p.x, p.z, `pickup ${n}`)
	}
	if (regions.size > 1) bad(`spawns / pickups in ${regions.size} separate regions`)
	return out({ size: [Math.round(wU * 10) / 10, Math.round(dU * 10) / 10], blocked: Math.round(blocked * 1000) / 1000, blocks: blocks.length,
		spawns: spawns.length, pickups: pickups.length, teams })
}

module.exports = { validateArena, floorOcc, sceneScaleOf }
