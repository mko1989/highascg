'use strict'

/**
 * WO-616 T10 — minimum-cost assignment (Hungarian) for cross-camera association and world-track matching.
 *
 * Shortest-augmenting-path Kuhn–Munkres with row/column potentials (the e-maxx formulation, O(n^3)). The rectangular
 * matrix is padded to square with a constant PAD; a padded row or column always carries the same count of PAD cells
 * in every perfect matching, so the optimum over the real cells is unchanged. Forbidden pairs (Infinity, NaN) are
 * solved as BIG so the algorithm stays finite, then dropped from the result. A pair above `gate` is forbidden the same
 * way BEFORE solving, so the result has the most in-gate pairs, and the least total cost among those (a post-solve
 * drop could trade two in-gate pairs for one in-gate + one dropped).
 */

const BIG = 1e9
const PAD = 1e9

/** Finite cost for the solver; anything not finite or above the gate is forbidden. */
const solverCost = (c, gate) => (Number.isFinite(c) && c <= gate ? c : BIG)

/**
 * Minimum-total-cost assignment of rows to columns.
 * @param {number[][]} cost n rows × m columns; Infinity marks a forbidden pair. Not mutated.
 * @param {number} [gate=Infinity] pairs whose cost is above this (or not finite) are dropped from the result.
 * @returns {Array<[number, number]>} [row, col] pairs sorted by row.
 */
function assign(cost, gate = Infinity) {
	const n = cost.length
	const m = n > 0 ? cost[0].length : 0
	if (n === 0 || m === 0) return []
	const size = Math.max(n, m)
	const a = []
	for (let i = 0; i < size; i++) {
		const row = []
		for (let j = 0; j < size; j++) row.push(i < n && j < m ? solverCost(cost[i][j], gate) : PAD)
		a.push(row)
	}
	// 1-indexed potentials and matching, as in the e-maxx formulation. p[j] = row matched to column j (0 = none).
	const u = new Array(size + 1).fill(0)
	const v = new Array(size + 1).fill(0)
	const p = new Array(size + 1).fill(0)
	const way = new Array(size + 1).fill(0)
	for (let i = 1; i <= size; i++) {
		p[0] = i
		let j0 = 0
		const minv = new Array(size + 1).fill(Infinity)
		const used = new Array(size + 1).fill(false)
		do {
			used[j0] = true
			const i0 = p[j0]
			let delta = Infinity
			let j1 = 0
			for (let j = 1; j <= size; j++) {
				if (used[j]) continue
				const cur = a[i0 - 1][j - 1] - u[i0] - v[j]
				if (cur < minv[j]) {
					minv[j] = cur
					way[j] = j0
				}
				if (minv[j] < delta) {
					delta = minv[j]
					j1 = j
				}
			}
			for (let j = 0; j <= size; j++) {
				if (used[j]) {
					u[p[j]] += delta
					v[j] -= delta
				} else {
					minv[j] -= delta
				}
			}
			j0 = j1
		} while (p[j0] !== 0)
		do {
			const j1 = way[j0]
			p[j0] = p[j1]
			j0 = j1
		} while (j0 !== 0)
	}
	const pairs = []
	for (let j = 1; j <= size; j++) {
		const i = p[j] - 1
		const jj = j - 1
		if (i >= n || jj >= m) continue
		const c = cost[i][jj]
		if (!Number.isFinite(c) || c > gate) continue
		pairs.push([i, jj])
	}
	pairs.sort((x, y) => x[0] - y[0])
	return pairs
}

module.exports = { assign }
