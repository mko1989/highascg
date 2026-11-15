'use strict'

/**
 * WO-1081 Stage Skirmish — browser client, the arena's solid grid and soldier movement
 * (modules/toy-skirmish/client/grid.js, move.js; contract work/notes/skirmish-game-contract.md §3–§5):
 *  - the floor's `occ` RLE (decoded by the RC kit's occ.js) cropped to the arena rect, `blocks` rasterised by cell
 *    centre (yaw π/2 swaps w / d), everything outside the rect solid; a floor without `occ` gets a plain grid;
 *  - circle-vs-grid movement: a soldier stops at a wall, slides along it, never tunnels through a one-cell leg, passes a
 *    gap wider than itself, stays inside the arena edge;
 *  - the grid ray cast (hitscan / rockets / line of sight) stops at the first solid cell;
 *  - acceleration: 0 → 4.5 u/s in 0.12 s, at the toy scale 0.1 too.
 * The client's ES modules import the kit as `./kit/<file>` (served from modules/rc-game/client); a resolve hook maps
 * that here exactly like the server's static handler does.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const REPO = path.join(__dirname, '..', '..')
const SK = path.join(REPO, 'modules', 'toy-skirmish', 'client')
const KIT = pathToFileURL(path.join(REPO, 'modules', 'rc-game', 'client') + path.sep).href
registerHooks({
	resolve(spec, ctx, next) {
		if (spec.startsWith('./kit/') && ctx.parentURL && ctx.parentURL.includes('/toy-skirmish/client/'))
			return next(KIT + spec.slice(6), ctx)
		return next(spec, ctx)
	},
})
const load = (f) => import(pathToFileURL(path.join(SK, f)).href)

let G, M, C

/** RLE of a w × h bit list (free first). */
function rle(bits) {
	const out = []
	let cur = 0
	let run = 0
	for (const b of bits) {
		if (b === cur) run++
		else {
			out.push(run)
			cur = b
			run = 1
		}
	}
	out.push(run)
	return out
}

/** A 0.03 m floor grid (toy scale) with a set of blocked cells. */
function floorOcc(w, h, blocked, x0 = -3, z0 = -3) {
	const bits = new Array(w * h).fill(0)
	for (const [i, j] of blocked) bits[j * w + i] = 1
	return { floor: 'stage', y: 1.42, x0, z0, cell: 0.03, w, h, rle: rle(bits) }
}

describe('WO-1081 Skirmish client: solid grid', () => {
	before(async () => {
		G = await load('grid.js')
		M = await load('move.js')
		C = await load('sk-const.js')
	})

	it('crops the floor occ to the arena rect, aligned with its cells; outside the rect is solid', () => {
		const occ = floorOcc(200, 200, [[110, 120]])
		const arena = { floor: 'stage', y: 1.42, rect: [0, 0, 1.5, 1.2], blocks: [] }
		const g = G.buildArenaGrid(arena, [occ], 0.1)
		assert.equal(g.cell, 0.03)
		assert.ok(Math.abs(g.x0 - 0) < 1e-9 && Math.abs(g.z0 - 0) < 1e-9)
		assert.equal(g.w, 50)
		assert.equal(g.h, 40)
		/* occ cell (110, 120) = x 0.30…0.33, z 0.60…0.63 */
		assert.equal(G.solidAt(g, 0.315, 0.615), true)
		assert.equal(G.solidAt(g, 0.36, 0.615), false)
		assert.equal(G.solidAt(g, -0.01, 0.5), true, 'outside the rect')
		assert.equal(G.solidAt(g, 1.51, 0.5), true, 'outside the rect')
		assert.equal(g.count, 1)
		assert.ok(G.solidShare(g) > 0 && G.solidShare(g) < 0.01)
	})

	it('rasterises blocks by cell centre; yaw π/2 swaps w and d; a floor without occ gets a plain grid', () => {
		const arena = {
			floor: 'hall',
			y: 0.839,
			rect: [-1, -1, 1, 1],
			blocks: [
				{ x: 0, z: 0, w: 0.3, d: 0.06, h: 0.07, yaw: 0, c: 1 },
				{ x: 0.6, z: 0.6, w: 0.3, d: 0.06, h: 0.07, yaw: Math.PI / 2, c: 2 },
			],
		}
		const g = G.buildArenaGrid(arena, [], 0.1)
		assert.ok(Math.abs(g.cell - G.FALLBACK_CELL_U * 0.1) < 1e-12)
		assert.equal(G.solidAt(g, 0.12, 0.01), true)
		assert.equal(G.solidAt(g, 0.01, 0.12), false)
		assert.equal(G.solidAt(g, 0.61, 0.72), true, 'turned block runs along z')
		assert.equal(G.solidAt(g, 0.72, 0.61), false)
		assert.deepEqual(G.blockRect({ x: 1, z: 2, w: 0.4, d: 0.2, yaw: Math.PI / 2 }).map((v) => +v.toFixed(6)), [
			0.9, 1.8, 1.1, 2.2,
		])
	})

	it('ray cast stops at the first solid cell; line of sight', () => {
		const occ = floorOcc(200, 200, [[120, 110]])
		const g = G.buildArenaGrid({ floor: 'stage', y: 1.42, rect: [0, 0, 1.5, 1.5] }, [occ], 0.1)
		/* wall cell x 0.60…0.63 at z 0.30…0.33; ray from x 0.1 along +x at z 0.315 */
		const d = G.rayCast(g, 0.1, 0.315, 1, 0, 5)
		assert.ok(Math.abs(d - 0.5) < 1e-9, `hit at ${d}`)
		assert.equal(G.rayCast(g, 0.1, 0.4, 1, 0, 5) > 1.39, true, 'misses → the edge')
		assert.ok(Math.abs(G.rayCast(g, 0.1, 0.4, 1, 0, 5) - 1.4) < 0.031)
		assert.equal(G.rayCast(g, 0.1, 0.4, 1, 0, 0.3), 0.3, 'capped at max')
		assert.equal(G.lineClear(g, 0.1, 0.315, 1, 0.315), false)
		assert.equal(G.lineClear(g, 0.1, 0.5, 1, 0.5), true)
		const diag = G.rayCast(g, 0.1, 0.1, Math.SQRT1_2, Math.SQRT1_2, 5)
		assert.ok(diag > 1.9 && diag < 2.0, `diagonal to the corner ${diag}`)
	})

	it('a soldier stops at a wall, slides along it, passes a wide gap and never tunnels a one-cell leg', () => {
		const s = 0.1
		const R = C.SOLDIER.R * s
		const wall = []
		for (let j = 0; j < 200; j++) if (j !== 115 && j !== 116) wall.push([120, j]) // a wall at x 0.60…0.63, a 6 cm gap
		const g = G.buildArenaGrid({ floor: 'stage', y: 1.42, rect: [0, 0, 1.5, 1.5] }, [floorOcc(200, 200, wall)], s)
		/* straight into the wall */
		const p = G.moveCircle(g, 0.4, 0.2, 0.9, 0.2, R)
		assert.ok(Math.abs(p[0] - (0.6 - R)) < 1e-4, `stopped at ${p[0]}`)
		/* diagonal: slides along z */
		const q = G.moveCircle(g, 0.55, 0.2, 0.75, 0.4, R)
		assert.ok(q[0] <= 0.6 - R + 1e-4 && q[1] > 0.35, `slid to ${q}`)
		/* the gap at z 0.45…0.51 (6 cm > a 3.6 cm soldier) */
		const t = G.moveCircle(g, 0.5, 0.48, 0.8, 0.48, R)
		assert.ok(t[0] > 0.75, `through the gap ${t}`)
		/* a single cell leg in a long fast step */
		const leg = G.buildArenaGrid({ floor: 'stage', y: 1.42, rect: [0, 0, 1.5, 1.5] }, [floorOcc(200, 200, [[120, 110]])], s)
		const u = G.moveCircle(leg, 0.2, 0.315, 1.2, 0.315, R)
		assert.ok(u[0] < 0.6, `blocked by the leg ${u}`)
		/* the arena edge */
		const e = G.moveCircle(g, 0.1, 0.1, -1, 0.1, R)
		assert.ok(e[0] >= R - 1e-4 && e[0] < R + 0.001, `edge ${e}`)
	})

	it('movement: 0 → 4.5 u/s in 0.12 s, stops as fast, diagonal not faster, collides through stepSoldier', () => {
		for (const s of [1, 0.1]) {
			const st = M.createSoldier(0, 0, 0)
			let t = 0
			while (t < 0.12 - 1e-9) {
				M.stepSoldier(st, { mx: 1, mz: 0 }, M.STEP, null, s)
				t += M.STEP
			}
			const v = Math.hypot(st.vx, st.vz)
			assert.ok(Math.abs(v - C.SOLDIER.SPEED * s) < 1e-9, `top speed after 0.12 s at scale ${s}: ${v}`)
			M.stepSoldier(st, { mx: 1, mz: 1 }, 1, null, s)
			assert.ok(Math.hypot(st.vx, st.vz) <= C.SOLDIER.SPEED * s + 1e-9)
			for (let k = 0; k < 8; k++) M.stepSoldier(st, { mx: 0, mz: 0 }, M.STEP, null, s)
			assert.equal(Math.hypot(st.vx, st.vz), 0)
			assert.equal(M.isMoving(st, s), false)
		}
		const s = 0.1
		const g = G.buildArenaGrid({ floor: 'stage', y: 1.42, rect: [0, 0, 1, 1] }, [], s)
		const st = M.createSoldier(0.5, 0.5, 0)
		for (let k = 0; k < 600; k++) M.stepSoldier(st, { mx: 0, mz: -1 }, M.STEP, g, s)
		assert.ok(st.z >= C.SOLDIER.R * s - 1e-4 && st.z < 0.03, `held at the edge ${st.z}`)
		assert.ok(Math.abs(st.vz) < 1e-6, 'no speed kept into the wall')
	})

	it('the fixed stepper runs 60 Hz steps and never more than 8 per frame', () => {
		const stp = M.createStepper()
		let n = 0
		stp.advance(0.05, () => n++)
		assert.equal(n, 3)
		n = 0
		stp.advance(5, () => n++)
		assert.equal(n, 8)
	})
})

describe('WO-1081 Skirmish client: grid = the server grid', () => {
	it('builds bit-identical arena grids to the server (sk-grid.js) when that file is present', async (t) => {
		let S
		try {
			S = require(path.join(REPO, 'modules', 'toy-skirmish', 'server', 'sk-grid.js'))
		} catch {
			return t.skip('server half not installed')
		}
		const Gr = await load('grid.js')
		const { prepareOcc } = await import(KIT + 'occ.js')
		let seed = 7
		const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)
		const bits = Array.from({ length: 120 * 90 }, () => (rnd() < 0.08 ? 1 : 0))
		const raw = { floor: 'hall', y: 0.839, x0: -1.2, z0: 2.1, cell: 0.03, w: 120, h: 90, rle: rle(bits) }
		const [occ] = prepareOcc([raw])
		const blocks = [
			{ x: 0.3, z: 3.0, w: 0.48, d: 0.24, h: 0.18, yaw: 0, c: 0 },
			{ x: 0.9, z: 3.3, w: 0.3, d: 0.09, h: 0.12, yaw: Math.PI / 2, c: 2 },
			{ x: 0.315, z: 3.615, w: 0.18, d: 0.18, h: 0.09, yaw: 0, c: 4 }, // edges on cell centres (closed rect)
		]
		// a rect on cell edges, as the generator makes them
		const arena = { id: 'a', floor: 'hall', y: 0.839, rect: [-1.2 + 10 * 0.03, 2.1 + 5 * 0.03, -1.2 + 100 * 0.03, 2.1 + 80 * 0.03], blocks }
		const mine = Gr.buildArenaGrid(arena, [raw], 0.1)
		const theirs = S.arenaGrid(arena, occ, 0.1)
		assert.deepEqual([mine.w, mine.h], [theirs.w, theirs.h])
		assert.ok(Math.abs(mine.x0 - theirs.x0) < 1e-9 && Math.abs(mine.z0 - theirs.z0) < 1e-9)
		assert.deepEqual(Array.from(mine.bits), Array.from(theirs.bits))
		const empty = { id: 'b', floor: 'none', y: 9, rect: [0, 0, 4.5, 3], blocks }
		const m2 = Gr.buildArenaGrid(empty, [], 0.1)
		const t2 = S.arenaGrid(empty, null, 0.1)
		assert.deepEqual([m2.w, m2.h, m2.x0, m2.z0], [t2.w, t2.h, t2.x0, t2.z0])
		assert.deepEqual(Array.from(m2.bits), Array.from(t2.bits))
	})
})
