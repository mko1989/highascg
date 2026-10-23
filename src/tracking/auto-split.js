'use strict'

/**
 * WO-708 / WO-709 — the pure maths of the Auto director (auto-director.js): which pool head follows which person, and
 * where the heads go home.
 *
 * splitHeads — one lane alone takes the whole pool (its count applies only once 2+ people are followed); explicit slots (heads n ≥ 1) take their n nearest heads first, counts capped in slot order by what is
 *   left; the rest is split evenly among the "share" lanes (heads 0), the remainder to the nearest. One Hungarian
 *   (hungarian.js) per stage, each lane repeated as many times as it gets heads. A head that already follows a lane
 *   costs STAY_M less to keep it (hysteresis: when the split recomputes, heads only move where they must).
 * homePoints — n points spread evenly over the grid rectangle (rows ≈ the rectangle's aspect, each row's points
 *   centred in their own cells, so a short last row still covers the width). The rectangle's meaning mirrors the Godot
 *   twin godot/client/features/previs/tracking/tracking_model.gd normalize_grid / grid_corners: centred on x_offset
 *   (± width / 2) and y_offset (± depth / 2), at z_offset.
 * homeAssign — heads → points by Hungarian on plain floor distance: a minimum-total-length matching never crosses
 *   two beams (swapping a crossing pair always shortens it).
 */

const { assign } = require('./hungarian')

const STAY_M = 0.5
const EXTRA = 1e6 // a share lane's remainder copy: used only where the pool does not divide evenly

const GRID_DEFAULT = Object.freeze({ width: 10, depth: 6, spacing: 1, x_offset: 0, y_offset: 3, z_offset: 0 })
const GRID_LIMITS = { width: [0.5, 200], depth: [0.5, 200], spacing: [0.1, 50] }

/** project.previs.tracking.grid → the Godot normalize_grid shape. */
function normalizeGrid(src) {
	const g = src && typeof src === 'object' ? src : {}
	const out = {}
	for (const k of Object.keys(GRID_DEFAULT)) {
		const v = g[k]
		out[k] = typeof v === 'number' && Number.isFinite(v) ? v : GRID_DEFAULT[k]
		if (GRID_LIMITS[k]) out[k] = Math.min(GRID_LIMITS[k][1], Math.max(GRID_LIMITS[k][0], out[k]))
	}
	return out
}

const floorOf = (fx) => [Number(fx?.pose?.x) || 0, Number(fx?.pose?.y) || 0]
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0)

/**
 * @param {{ pool: object[], lanes: { marker: number, slot: number, heads: number, pos: number[]|null }[],
 *           prev?: Map<number, number> }} o  pool: fixtures (id, pose); lanes in priority order (pinned slots in
 *           slot order, then the unpinned A1…A9); heads: the slot's count (0 = share); prev: fixture id → marker.
 * @returns {Map<number, number>} fixture id → marker id (heads left out hold / go home).
 */
function splitHeads({ pool, lanes: all, prev = new Map() }) {
	// Owner 23.10: "if there is one person on stage the person should be followed by all fronts in auto mode and only
	// split it when more people are on stage" — a lone lane takes the whole pool whatever its pinned count.
	const lanes = all.length === 1 ? [{ ...all[0], heads: 0 }] : all
	const out = new Map()
	let left = pool.slice()
	const solve = (cols, cost) => {
		if (!left.length || !cols.length) return
		const m = left.map((fx) => cols.map((c, j) => cost(fx, c, j)))
		const taken = new Set()
		for (const [i, j] of assign(m)) {
			out.set(left[i].id, cols[j].marker)
			taken.add(left[i].id)
		}
		left = left.filter((fx) => !taken.has(fx.id))
	}
	const near = (fx, lane) => dist(floorOf(fx), lane.pos) + (prev.get(fx.id) === lane.marker ? 0 : STAY_M)
	const explicit = []
	let budget = pool.length
	for (const lane of lanes) {
		if (!(lane.heads > 0)) continue
		const n = Math.min(lane.heads, budget)
		budget -= n
		for (let k = 0; k < n; k++) explicit.push(lane)
	}
	solve(explicit, near)
	const share = lanes.filter((l) => !(l.heads > 0))
	if (!share.length || !left.length) return out
	const base = Math.floor(left.length / share.length)
	const rem = left.length % share.length
	const cols = []
	for (const lane of share) {
		for (let k = 0; k < base; k++) cols.push({ marker: lane.marker, lane, extra: false })
		if (rem) cols.push({ marker: lane.marker, lane, extra: true })
	}
	solve(cols, (fx, c) => near(fx, c.lane) + (c.extra ? EXTRA : 0))
	return out
}

/** n points spread evenly over the grid rectangle, row by row from downstage: [{ x, y, z }]. */
function homePoints(grid, n) {
	const g = normalizeGrid(grid)
	if (!(n > 0)) return []
	const cols = Math.ceil(n / Math.min(n, Math.max(1, Math.round(Math.sqrt((n * g.depth) / g.width)))))
	const rows = Math.ceil(n / cols) // every row holds at least one point
	const x0 = g.x_offset - g.width / 2
	const y0 = g.y_offset - g.depth / 2
	const out = []
	for (let r = 0; r < rows; r++) {
		const k = r < rows - 1 ? cols : n - cols * (rows - 1)
		for (let i = 0; i < k; i++) {
			out.push({ x: x0 + ((i + 0.5) * g.width) / k, y: y0 + ((r + 0.5) * g.depth) / rows, z: g.z_offset })
		}
	}
	return out
}

/** Pool heads → their home point (no two beams crossing): Map fixture id → { x, y, z }. */
function homeAssign(pool, grid) {
	const pts = homePoints(grid, pool.length)
	const out = new Map()
	if (!pts.length) return out
	const m = pool.map((fx) => pts.map((p) => dist(floorOf(fx), [p.x, p.y])))
	for (const [i, j] of assign(m)) out.set(pool[i].id, pts[j])
	return out
}

module.exports = { splitHeads, homePoints, homeAssign, normalizeGrid, GRID_DEFAULT, STAY_M }
