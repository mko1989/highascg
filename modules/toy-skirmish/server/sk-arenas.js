'use strict'

/**
 * WO-1081 — Stage Skirmish: the arenas of a scene (contract §4), generated from the RC bake's floors and occupancy
 * grids, deterministic per scene `rev` (every random draw comes from mulberry32(hash(rev))). 3–8 arenas: one on the
 * stage when the scene has a stage floor, the others on the hall floor, each a rectangle of 25–80 u per side snapped to
 * the floor's grid, chosen where the room already gives 8–40 % solid cells (tables, chairs, truss bases) and topped up
 * with generated toy building blocks where it gives none (an empty stage, the default hall of a scene without an MVR).
 *
 * Steps per arena: candidate rects (summed-area table over the floor grid, stride 4 u, sizes 26–80 u, never over a
 * higher floor) scored by their native solid share → blocks placed in open space (≥ 1.2 u of free floor around each,
 * ≥ 2 u from the edge; 0.9–2.4 u thick so they still stop a shot through the §5 one-cell tolerance) → spawns by
 * farthest-point sampling per team half → pickups (surge near the centre, the rest spread) → validateArena. A failed
 * arena is left out. Names: "The Stage", "Under the Tables" (the hall arena with the most furniture), "Front of House"
 * (nearest the stage), "The Aisle" (the longest), then the rest of the list.
 *
 *   generateArenas(scene, { rev })              → arenas (sync; smokes, tools)
 *   generateArenasAsync(scene, { rev }, pause)  → Promise<arenas> (the service: yields between arenas)
 */

const R = require('./sk-rules')
const G = require('./sk-grid')
const { validateArena, floorOcc, sceneScaleOf } = require('./sk-arena-check')
const { kit } = require('./sk-kit')

const SIZES = [[80, 60], [80, 40], [70, 50], [64, 64], [60, 40], [56, 56], [50, 50], [50, 32], [44, 44], [40, 30], [36, 36], [30, 30], [80, 28], [64, 26]]
const STRIDE_U = 4
const MAX_BUILDS = 28
const HALL_NAMES = [['tables', 'Under the Tables'], ['foh', 'Front of House'], ['aisle', 'The Aisle'], ['backrow', 'The Back Row'],
	['banquet', 'The Banquet'], ['sidehall', 'Side Hall'], ['crossroads', 'Crossroads'], ['frontrow', 'The Front Row']]
const BLOCK_W = [1.8, 2.4, 3.0, 3.6, 4.8, 6.0] // u (long side)
const BLOCK_D = [0.9, 1.2, 1.8, 2.4] // u (≥ 3 cells: the shrunk grid of §5 still sees a core)
const BLOCK_H = [0.6, 0.9, 1.2, 1.8]
const BLOCK_GAP = 1.2 // u of free floor around a new block
const BLOCK_EDGE = 2 // u from the arena edge
const MAX_BLOCKS = 160

const r6 = (v) => Math.round(v * 1e6) / 1e6 + 0
const r4 = (v) => Math.round(v * 1e4) / 1e4 + 0
const r3 = (v) => Math.round(v * 1e3) / 1e3 + 0

/** Summed-area table of a floor grid's solid cells. */
function sat(F) {
	const W = F.w + 1
	const S = new Int32Array(W * (F.h + 1))
	for (let k = 0; k < F.h; k++) {
		let row = 0
		for (let i = 0; i < F.w; i++) {
			row += F.bits[k * F.w + i]
			S[(k + 1) * W + i + 1] = S[k * W + i + 1] + row
		}
	}
	return (i0, k0, i1, k1) => S[k1 * W + i1] - S[k0 * W + i1] - S[k1 * W + i0] + S[k0 * W + i0] // cells [i0, i1) × [k0, k1)
}

/** How much a native solid share is worth (the band the arenas want is 8–40 % after blocks). */
function quality(f) {
	if (f > 0.32) return 0
	if (f > 0.25) return 0.6
	if (f >= 0.08) return 1
	return f < 0.02 ? 0.35 : 0.5 + 5 * f
}

/** Candidate rects (cell ranges) on one floor, best first. */
function candidates(F, floor, scene, u) {
	const sum = sat(F)
	const c = F.cell
	const stride = Math.max(1, Math.round((STRIDE_U * u) / c))
	const higher = scene.floors.filter((f) => f !== floor && f.y > floor.y + 0.05 * u && Array.isArray(f.rect))
	const out = []
	for (const [a, b] of SIZES) {
		for (const [wu, du] of a === b ? [[a, b]] : [[a, b], [b, a]]) {
			const nw = Math.floor((wu * u) / c + 1e-9), nh = Math.floor((du * u) / c + 1e-9)
			if (nw > F.w || nh > F.h) continue
			for (let k0 = 0; k0 + nh <= F.h; k0 += stride) {
				for (let i0 = 0; i0 + nw <= F.w; i0 += stride) {
					const rect = [F.x0 + i0 * c, F.z0 + k0 * c, F.x0 + (i0 + nw) * c, F.z0 + (k0 + nh) * c]
					if (higher.some((f) => rect[0] < f.rect[2] + 0.5 * u && f.rect[0] - 0.5 * u < rect[2] && rect[1] < f.rect[3] + 0.5 * u && f.rect[1] - 0.5 * u < rect[3])) continue
					const native = sum(i0, k0, i0 + nw, k0 + nh) / (nw * nh)
					const q = quality(native)
					if (q > 0) out.push({ rect, native, score: Math.sqrt(nw * nh) * c * q, n: out.length })
				}
			}
		}
	}
	return out.sort((x, y) => y.score - x.score || x.n - y.n)
}

/** Is every cell of the (cell-range) window free? */
function windowFree(g, i0, k0, i1, k1) {
	if (i0 < 0 || k0 < 0 || i1 > g.w || k1 > g.h) return false
	for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) if (g.bits[k * g.w + i]) return false
	return true
}

/** Toy blocks in open space until the solid share reaches `target`. → blocks (world JSON); g.bits updated. */
function placeBlocks(g, target, rnd, u) {
	const c = g.cell
	const total = g.w * g.h
	let solidN = 0
	for (let q = 0; q < total; q++) solidN += g.bits[q]
	const gap = Math.ceil((BLOCK_GAP * u) / c - 1e-9), edge = Math.ceil((BLOCK_EDGE * u) / c - 1e-9)
	const pick = (list) => list[Math.floor(rnd() * list.length)]
	const blocks = []
	for (let tries = 0; tries < 4000 && solidN / total < target && blocks.length < MAX_BLOCKS; tries++) {
		const turned = rnd() < 0.5
		const lw = Math.max(1, Math.round((pick(BLOCK_W) * u) / c)), ld = Math.max(3, Math.round((pick(BLOCK_D) * u) / c))
		const cw = turned ? ld : lw, ch = turned ? lw : ld // cells along X / Z
		const i0 = edge + Math.floor(rnd() * Math.max(1, g.w - 2 * edge - cw)), k0 = edge + Math.floor(rnd() * Math.max(1, g.h - 2 * edge - ch))
		if (i0 + cw > g.w - edge || k0 + ch > g.h - edge) continue
		if (!windowFree(g, i0 - gap, k0 - gap, i0 + cw + gap, k0 + ch + gap)) continue
		for (let k = k0; k < k0 + ch; k++) g.bits.fill(1, k * g.w + i0, k * g.w + i0 + cw)
		solidN += cw * ch
		blocks.push({ x: r6(g.x0 + (i0 + cw / 2) * c), z: r6(g.z0 + (k0 + ch / 2) * c), w: r6(lw * c), d: r6(ld * c), h: r6(pick(BLOCK_H) * u),
			yaw: turned ? r6(Math.PI / 2) : 0, c: Math.floor(rnd() * R.ARENA.colours) })
	}
	return blocks
}

/** Cell centres of the main region that pass `ok`, every `step` cells. */
function cellsWhere(g, step, ok) {
	const out = []
	for (let k = 0; k < g.h; k += step) for (let i = 0; i < g.w; i += step) if (ok(k * g.w + i)) out.push([g.x0 + (i + 0.5) * g.cell, g.z0 + (k + 0.5) * g.cell])
	return out
}

/** Spawns: farthest-point sampling, alternating the two halves along the longer side. */
function placeSpawns(g, rect, cand, u) {
	const longX = rect[2] - rect[0] >= rect[3] - rect[1]
	const mid = longX ? (rect[0] + rect[2]) / 2 : (rect[1] + rect[3]) / 2
	const cx = (rect[0] + rect[2]) / 2, cz = (rect[1] + rect[3]) / 2
	const team = cand.map((p) => ((longX ? p[0] : p[1]) < mid ? 0 : 1))
	const dmin = cand.map((p) => 1e9 + Math.hypot(p[0] - cx, p[1] - cz) * 1e-6) // first pick: farthest from the centre
	const used = new Uint8Array(cand.length)
	const spawns = []
	const stuck = [false, false]
	for (let j = 0; spawns.length < 16 && !(stuck[0] && stuck[1]); j++) {
		const t = stuck[j % 2] ? 1 - (j % 2) : j % 2
		let best = -1
		for (let n = 0; n < cand.length; n++) {
			if (used[n] || team[n] !== t || dmin[n] < R.ARENA.spawnGap * u) continue
			if (best < 0 || dmin[n] > dmin[best] + 1e-12) best = n
		}
		if (best < 0) {
			stuck[t] = true
			continue
		}
		used[best] = 1
		const [x, z] = cand[best]
		if (!G.clearAt(g, x, z, R.ARENA.spawnClear * u)) continue
		spawns.push({ x: r4(x), z: r4(z), yaw: r3(R.yawTo(x, z, cx, cz)), team: t })
		for (let n = 0; n < cand.length; n++) dmin[n] = Math.min(dmin[n] > 1e8 ? Infinity : dmin[n], Math.hypot(cand[n][0] - x, cand[n][1] - z))
	}
	return spawns
}

/** Pickups: surge near the centre, every other kind as far as possible from those already placed. → list or null. */
function placePickups(rect, cand, spawns, rnd, u) {
	const wU = (rect[2] - rect[0]) / u, dU = (rect[3] - rect[1]) / u
	const area = wU * dU
	const kinds = []
	if (Math.min(wU, dU) >= R.PICKUPS.surge.minSide) kinds.push('surge')
	kinds.push('thumper', 'longshot', 'scatter', 'rattler')
	for (let n = area >= 2500 ? 2 : 1; n > 0; n--) kinds.push('armour')
	for (let n = Math.min(R.ARENA.health[1], 2 + Math.floor(area / 2000)); n > 0; n--) kinds.push('health')
	const cx = (rect[0] + rect[2]) / 2, cz = (rect[1] + rect[3]) / 2
	const free = cand.filter((p) => spawns.every((s) => Math.hypot(p[0] - s.x, p[1] - s.z) >= R.ARENA.pickupSpawnGap * u + 1e-6))
	// a seeded shuffle breaks ties differently per rev without leaving the rules
	for (let n = free.length - 1; n > 0; n--) {
		const m = Math.floor(rnd() * (n + 1))
		;[free[n], free[m]] = [free[m], free[n]]
	}
	const out = []
	for (const kind of kinds) {
		let best = null, bestScore = -Infinity
		for (const p of free) {
			let d = Infinity
			for (const q of out) d = Math.min(d, Math.hypot(p[0] - q.x, p[1] - q.z))
			if (d < R.ARENA.pickupGap * u + 1e-6) continue
			const score = kind === 'surge' ? -Math.hypot(p[0] - cx, p[1] - cz) : Math.min(d, 12 * u) - 0.02 * Math.hypot(p[0] - cx, p[1] - cz)
			if (score > bestScore) (best = p), (bestScore = score)
		}
		if (!best) return null
		out.push({ id: out.length, kind, x: r4(best[0]), z: r4(best[1]) })
	}
	return out
}

/** One arena on a candidate rect, or null. */
function buildArena(scene, floor, occ, rect, rnd, u) {
	const proto = { id: 'x', name: 'x', floor: floor.id, y: floor.y, rect: rect.map(r6), blocks: [] }
	const g = G.arenaGrid(proto, occ, u, { noBlocks: true })
	let solidN = 0
	for (let q = 0; q < g.bits.length; q++) solidN += g.bits[q]
	const native = solidN / g.bits.length
	const target = native < R.ARENA.blocked[0] ? 0.1 + rnd() * 0.06 : Math.min(0.36, native + 0.02 + rnd() * 0.03)
	proto.blocks = placeBlocks(g, target, rnd, u)
	const mask = G.passable(g, R.SOLDIER.radius * u)
	const { label, sizes } = G.components(mask, g.w, g.h)
	if (!sizes.length) return null
	const main = sizes.indexOf(Math.max(...sizes))
	const edt = kit().distanceTransform(g.bits, g.w, g.h, g.cell)
	const half = 0.71 * g.cell
	const ex = g.x0 + g.w * g.cell, ez = g.z0 + g.h * g.cell
	const roomy = (q, r) => {
		if (label[q] !== main || edt[q] < r + half) return false
		const i = q % g.w, k = (q - i) / g.w
		const x = g.x0 + (i + 0.5) * g.cell, z = g.z0 + (k + 0.5) * g.cell
		return x - g.x0 >= r && ex - x >= r && z - g.z0 >= r && ez - z >= r
	}
	const step = Math.max(1, Math.round((0.6 * u) / g.cell))
	const spawns = placeSpawns(g, rect, cellsWhere(g, step, (q) => roomy(q, R.ARENA.spawnClear * u)), u)
	if (spawns.length < R.ARENA.minSpawns) return null
	const pickups = placePickups(rect, cellsWhere(g, step, (q) => roomy(q, R.ARENA.pickupClear * u)), spawns, rnd, u)
	if (!pickups) return null
	return { arena: { ...proto, spawns, pickups }, grid: g, native }
}

/** The generator as steps (yield = a good moment to pause). Result in out.arenas. */
function* steps(scene, rev, out) {
	const u = sceneScaleOf(scene)
	const rnd = R.mulberry32(R.hash32(`sk-arenas|${rev}`))
	const floors = (scene?.floors || []).filter((f) => f && Array.isArray(f.rect) && Number.isFinite(f.y))
	const stage = floors.find((f) => f.id === 'stage') || null
	const hall = floors.find((f) => f.id === 'hall') || floors.find((f) => f !== stage) || null
	const chosen = []
	let builds = 0
	const tryFloor = function* (floor, want) {
		const occ = floorOcc(scene, floor.id)
		if (!occ) return
		const failed = []
		const all = candidates(occ, floor, scene, u)
		const sizeKey = (r) => `${Math.round((r[2] - r[0]) / u)}x${Math.round((r[3] - r[1]) / u)}`
		let got = 0
		while (got < want && builds < MAX_BUILDS && chosen.length < R.ARENA.maxArenas) {
			// variety: every arena of the same size already chosen halves a candidate's score
			const same = new Map()
			for (const c of chosen) same.set(sizeKey(c.arena.rect), (same.get(sizeKey(c.arena.rect)) || 0) + 1)
			let cnd = null, best = -Infinity
			for (const x of all) {
				if (x.score <= best) break // sorted: nothing later can win
				const r = x.rect
				if (chosen.some((c) => c.arena.floor === floor.id && r[0] < c.arena.rect[2] && c.arena.rect[0] < r[2] && r[1] < c.arena.rect[3] && c.arena.rect[1] < r[3])) continue
				if (failed.some((f) => Math.hypot(f[0] - (r[0] + r[2]) / 2, f[1] - (r[1] + r[3]) / 2) < 8 * u)) continue
				const s = x.score * 0.5 ** (same.get(sizeKey(r)) || 0)
				if (s > best) (best = s), (cnd = x)
			}
			if (!cnd) break
			const r = cnd.rect
			builds++
			const b = buildArena(scene, floor, occ, r, rnd, u)
			yield
			const v = b && validateArena({ ...b.arena, id: 'check', name: 'check' }, scene, { grid: b.grid })
			if (!v || !v.ok) {
				failed.push([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2])
				continue
			}
			chosen.push(b)
			got++
		}
	}
	if (stage) yield* tryFloor(stage, 1)
	if (hall) yield* tryFloor(hall, R.ARENA.maxArenas - chosen.length)
	out.arenas = name(chosen, stage)
}

/** Ids and names: the stage first, then the hall arenas by character. */
function name(chosen, stage) {
	const out = []
	const hall = chosen.filter((c) => !stage || c.arena.floor !== stage.id)
	const st = chosen.find((c) => stage && c.arena.floor === stage.id)
	if (st) out.push({ ...st.arena, id: 'stage', name: 'The Stage' })
	const left = hall.slice()
	const take = (score) => {
		if (!left.length) return null
		let best = 0
		for (let n = 1; n < left.length; n++) if (score(left[n]) > score(left[best])) best = n
		return left.splice(best, 1)[0]
	}
	const ar = (c) => c.arena.rect
	const toStage = (c) => {
		const r = ar(c)
		if (!stage) return -r[1] // no stage: the upstage end of the hall
		const s = stage.rect
		return -Math.hypot(Math.max(s[0] - r[2], 0, r[0] - s[2]), Math.max(s[1] - r[3], 0, r[1] - s[3]))
	}
	const picks = [take((c) => c.native), take(toStage), take((c) => Math.max(ar(c)[2] - ar(c)[0], ar(c)[3] - ar(c)[1]) / Math.min(ar(c)[2] - ar(c)[0], ar(c)[3] - ar(c)[1]))]
	while (left.length) picks.push(left.shift())
	let n = 0
	for (const c of picks) {
		if (!c) continue
		const [id, nm] = HALL_NAMES[n++]
		out.push({ ...c.arena, id, name: nm })
	}
	// key order of the contract's example
	return out.map((a) => ({ id: a.id, name: a.name, floor: a.floor, y: a.y, rect: a.rect, blocks: a.blocks, spawns: a.spawns, pickups: a.pickups }))
}

function generateArenas(scene, opts = {}) {
	const out = { arenas: [] }
	for (const _ of steps(scene, String(opts.rev ?? scene?.rev ?? ''), out));
	return out.arenas
}

async function generateArenasAsync(scene, opts = {}, pause = () => new Promise((r) => setImmediate(r))) {
	const out = { arenas: [] }
	for (const _ of steps(scene, String(opts.rev ?? scene?.rev ?? ''), out)) await pause()
	return out.arenas
}

module.exports = { generateArenas, generateArenasAsync }
