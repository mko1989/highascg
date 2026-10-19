'use strict'

/**
 * WO-616 T10 — minimum-cost assignment (src/tracking/hungarian.js): empty inputs, a known 3×3 optimum, rectangular
 * shapes against a brute-force permutation search, the gate, forbidden (Infinity) pairs, and a seeded randomized
 * comparison with brute force over 200 matrices up to 6×6.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { assign } = require('../../src/tracking/hungarian')

/** Brute force: minimum total cost over all injections of the smaller side into the larger side (finite cells only). */
function bruteForce(cost) {
	const n = cost.length
	const m = n > 0 ? cost[0].length : 0
	if (n === 0 || m === 0) return 0
	const transposed = n > m
	const c = transposed ? cost[0].map((_, j) => cost.map((r) => r[j])) : cost
	const rows = Math.min(n, m)
	const cols = Math.max(n, m)
	let best = Infinity
	const used = new Array(cols).fill(false)
	const rec = (i, acc) => {
		if (acc >= best) return
		if (i === rows) {
			best = acc
			return
		}
		for (let j = 0; j < cols; j++) {
			if (used[j] || !Number.isFinite(c[i][j])) continue
			used[j] = true
			rec(i + 1, acc + c[i][j])
			used[j] = false
		}
	}
	rec(0, 0)
	return best
}

const totalOf = (cost, pairs) => pairs.reduce((s, [i, j]) => s + cost[i][j], 0)

/** Seeded LCG so the randomized test is reproducible (no Math.random). */
function lcg(seed) {
	let s = seed
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296
		return s / 4294967296
	}
}

describe('WO-616 T10 hungarian assignment', () => {
	it('empty inputs return no pairs', () => {
		assert.deepEqual(assign([]), [])
		assert.deepEqual(assign([[]]), [])
	})

	it('3×3 known matrix: optimum is 5 via [[0,1],[1,0],[2,2]]', () => {
		const cost = [
			[4, 1, 3],
			[2, 0, 5],
			[3, 2, 2],
		]
		const pairs = assign(cost)
		assert.deepEqual(pairs, [
			[0, 1],
			[1, 0],
			[2, 2],
		])
		assert.equal(totalOf(cost, pairs), 5)
	})

	it('rectangular 2×3 and 3×2 match the brute-force optimum', () => {
		const wide = [
			[1, 2, 3],
			[3, 2, 1],
		]
		const pw = assign(wide)
		assert.equal(pw.length, 2)
		assert.equal(totalOf(wide, pw), bruteForce(wide))
		assert.equal(totalOf(wide, pw), 2)

		const tall = [
			[5, 1],
			[2, 6],
			[4, 4],
		]
		const pt = assign(tall)
		assert.equal(pt.length, 2)
		assert.equal(totalOf(tall, pt), bruteForce(tall))
		assert.equal(totalOf(tall, pt), 3)
	})

	it('gate drops a pair whose cost exceeds it but keeps the others', () => {
		const cost = [
			[1, 20],
			[20, 8],
		]
		assert.deepEqual(assign(cost, 5), [[0, 0]])
		assert.deepEqual(assign(cost, 8), [
			[0, 0],
			[1, 1],
		])
		assert.deepEqual(assign(cost), [
			[0, 0],
			[1, 1],
		])
	})

	it('Infinity entries are never returned', () => {
		const cost = [
			[Infinity, Infinity],
			[1, 2],
		]
		assert.deepEqual(assign(cost), [[1, 0]])
		const diag = [
			[Infinity, 1],
			[2, Infinity],
		]
		assert.deepEqual(assign(diag), [
			[0, 1],
			[1, 0],
		])
	})

	it('randomized: 200 matrices up to 6×6 match brute force and are not mutated', () => {
		const rand = lcg(20260616)
		for (let k = 0; k < 200; k++) {
			const n = Math.floor(rand() * 7)
			const m = Math.floor(rand() * 7)
			const cost = []
			for (let i = 0; i < n; i++) {
				const row = []
				for (let j = 0; j < m; j++) row.push(Math.floor(rand() * 100))
				cost.push(row)
			}
			const before = JSON.parse(JSON.stringify(cost))
			const pairs = assign(cost)
			assert.deepEqual(cost, before, `matrix ${k} mutated`)
			assert.equal(pairs.length, Math.min(n, m), `matrix ${k} pair count`)
			assert.equal(new Set(pairs.map((p) => p[0])).size, pairs.length, `matrix ${k} repeated row`)
			assert.equal(new Set(pairs.map((p) => p[1])).size, pairs.length, `matrix ${k} repeated col`)
			assert.equal(totalOf(cost, pairs), bruteForce(cost), `matrix ${k} total`)
		}
	})

	it('gate is applied before solving: most in-gate pairs, then least cost', () => {
		// unconstrained optimum 0.1 + 1.5 would leave one pair after the gate; two in-gate pairs win
		const pairs = assign(
			[
				[0.1, 0.9],
				[0.9, 1.5],
			],
			1
		)
		assert.deepEqual(pairs, [
			[0, 1],
			[1, 0],
		])
	})
})
