'use strict'
/**
 * WO-1085 — spot handover, the pure core (src/tracking/auto-handover.js): a simulated presenter walking the whole truss
 * and back, standing on a threshold with jitter, two presenters crossing, too few heads, a person lost and found, an
 * unreachable head, the grant revoked, idle home / dark, and the threshold lines (a truss along X, and one along Y like
 * the Hilton Wawer rig).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createHandover, chooseHeads, thresholds, PREAIM_S } = require('../../src/tracking/auto-handover')

const N = 3
const SETTINGS = { heads: N, margin_m: 0.5, fade_s: 1, idle: 'home' }
const DT = 25 // ms, the engine tick is 23
const EPS = 1e-9
/** 8 heads on a front truss 2 m apart, x = −7 … 7 (stage right → left), y 0. */
const truss = (n = 8, axis = 'x') =>
	Array.from({ length: n }, (_, i) => (axis === 'x' ? { id: `h${i + 1}`, x: -7 + 2 * i, y: 0 } : { id: `h${i + 1}`, x: 4.9, y: 3.5 - 2 * i }))
const lane = (id, x, y) => ({ id, x, y, mark: { x, y, z: 0, status: 1, stale: false } })

/** Run `people(t_s)` → lanes for `seconds`; calls `each(t_ms, out, lanes)` every tick. */
function run({ heads = truss(), settings = SETTINGS, people, seconds, each = () => {}, reach, usable, home = () => null }) {
	const h = createHandover()
	let out = null
	for (let t = 0; t <= seconds * 1000; t += DT) {
		const lanes = people(t / 1000)
		out = h.step({ now: t, heads, lanes, home: home(t / 1000), settings, reach, usable })
		each(t, out, lanes)
	}
	return { h, out }
}
const lit = (out) => [...out.values()].filter((d) => d.level > 0).length
const sumOf = (out, laneId) => [...out.values()].filter((d) => d.lane === laneId).reduce((a, d) => a + d.level, 0)
const activeIds = (out, laneId) =>
	[...out].filter(([, d]) => d.lane === laneId && ['preaim', 'in', 'on'].includes(d.phase)).map(([id]) => id).sort()
const settled = (out) => [...out.values()].every((d) => d.phase === 'on' || d.phase === 'rest')
const nearest = (heads, x, y, n = N) =>
	heads.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).slice(0, n).map((h) => h.id).sort()

describe('WO-1085 handover core: a lone presenter', () => {
	it('walks the full width and back: N lit at steady state, ≤ N + 1 while one cross-fade runs, no dark gap', () => {
		const heads = truss()
		const walk = (s) => (s < 15 ? -7.5 + s : 7.5 - (s - 15)) // 1 m/s, −7.5 → 7.5 → −7.5
		let swaps = 0
		let prev = ''
		const at = []
		run({
			heads,
			people: (s) => [lane(1, walk(s), 3)],
			seconds: 30,
			each: (t, out) => {
				assert.ok(lit(out) <= N + 1, `${lit(out)} lit at ${t} ms`)
				if (t >= (PREAIM_S + SETTINGS.fade_s) * 1000) {
					assert.ok(sumOf(out, 1) >= N - EPS, `light sum ${sumOf(out, 1)} at ${t} ms (dark gap)`)
					assert.ok(sumOf(out, 1) <= N + EPS, `light sum ${sumOf(out, 1)} at ${t} ms`)
				}
				if (settled(out)) assert.equal(lit(out), N, `steady state at ${t} ms`)
				const ids = activeIds(out, 1).join() // the decision (the incoming head starts pre-aiming)
				if (prev && ids !== prev) {
					swaps++
					at.push({ x: walk(t / 1000), dir: t < 15000 ? 1 : -1 })
				}
				prev = ids
			},
		})
		assert.equal(swaps, 10, 'five take-overs each way along 8 heads with 3 lit')
		// each take-over is decided just past a threshold (x = −4, −2, 0, 2, 4) in the walking direction: the margin
		// (0.5 m of distance) is ~0.37 m of walk 3 m in front of the truss — never before the line, never far after it
		for (const { x, dir } of at) {
			const past = [-4, -2, 0, 2, 4].map((th) => (x - th) * dir).filter((d) => d >= 0)
			assert.ok(past.length && Math.min(...past) > 0.2 && Math.min(...past) < 0.6, `take-over at x ${x.toFixed(2)} (${dir})`)
		}
	})

	it('the active set is always the N nearest once settled, and the incoming head pre-aims dark first', () => {
		const heads = truss()
		const phases = new Map()
		run({
			heads,
			people: (s) => [lane(1, -6 + s * 0.6, 2)],
			seconds: 20,
			each: (t, out, lanes) => {
				for (const [id, d] of out) {
					const p = phases.get(id)
					if (d.phase === 'in' && p !== 'in' && p !== 'out') assert.equal(p, 'preaim', `${id} faded in without pre-aiming`)
					if (d.phase === 'preaim') assert.equal(d.level, 0, 'dark while pre-aiming')
					if (d.phase !== 'rest') assert.ok(d.target, `${id} aims at its person while ${d.phase}`)
					phases.set(id, d.phase)
				}
				if (settled(out) && t > 3000) {
					const want = nearest(heads, lanes[0].x, lanes[0].y)
					const got = activeIds(out, 1)
					const extra = got.filter((id) => !want.includes(id))
					// inside the hysteresis band the old head may still be kept: at most one off, never a far one
					assert.ok(extra.length <= 1, `${got} vs nearest ${want}`)
				}
			},
		})
	})

	it('stands on a threshold with ±15 cm jitter for 60 s: no flicker (and without a margin it does flicker)', () => {
		let seed = 42
		const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
		const person = () => [lane(1, 0 + 0.15 * rnd(), 3 + 0.05 * rnd())] // x 0 = the h3 | h6 bisector
		const count = (settings) => {
			let changes = 0
			let prev = null
			run({
				settings,
				people: person,
				seconds: 60,
				each: (t, out) => {
					if (t < 3000) return
					const ids = activeIds(out, 1).join()
					if (prev !== null && ids !== prev) changes++
					prev = ids
				},
			})
			return changes
		}
		assert.equal(count(SETTINGS), 0, 'margin 0.5 m holds the set')
		assert.ok(count({ ...SETTINGS, margin_m: 0 }) > 10, 'margin 0 flickers (the test can see flicker)')
	})
})

describe('WO-1085 handover core: several people', () => {
	it('two presenters crossing: N each at steady state, each lane always fully lit, a lit head never changes person', () => {
		const heads = truss()
		const lastLane = new Map()
		const { out } = run({
			heads,
			people: (s) => [lane(1, -6 + Math.min(12, s * 0.8), 3), lane(2, 6 - Math.min(12, s * 0.8), 2)],
			seconds: 25,
			each: (t, o) => {
				for (const [id, d] of o) {
					const was = lastLane.get(id)
					if (was !== undefined && was !== null && d.lane !== null && d.lane !== was)
						assert.fail(`${id} moved from person ${was} to ${d.lane} at ${t} ms while lit`)
					lastLane.set(id, d.lane)
				}
				if (t >= 1500) for (const l of [1, 2]) assert.ok(sumOf(o, l) >= N - EPS, `person ${l} light ${sumOf(o, l)} at ${t} ms`)
				if (settled(o)) for (const l of [1, 2]) assert.equal(activeIds(o, l).length, N)
			},
		})
		assert.deepEqual(activeIds(out, 1), nearest(heads, 6, 3), 'after crossing, person 1 has the heads nearest to it')
		assert.deepEqual(activeIds(out, 2), nearest(heads, -6, 2))
	})

	it('a contested head goes to the nearer person; too few heads are shared evenly', () => {
		const heads = truss()
		const w = chooseHeads({ heads, lanes: [lane(1, -1.2, 3), lane(2, 1.0, 3)], n: N, margin: 0.5 })
		assert.equal([...w.values()].filter((l) => l === 1).length, 3)
		assert.equal([...w.values()].filter((l) => l === 2).length, 3)
		assert.equal(w.get('h4'), 1, 'h4 (x −1) is nearer to person 1 (x −1.2)')
		assert.equal(w.get('h5'), 2, 'h5 (x 1) is nearer to person 2')
		const three = chooseHeads({ heads, lanes: [lane(1, -6, 3), lane(2, 0, 3), lane(3, 6, 3)], n: N, margin: 0.5 })
		const per = [1, 2, 3].map((l) => [...three.values()].filter((v) => v === l).length).sort()
		assert.deepEqual(per, [2, 3, 3], '8 heads for 3 people at 3 each: 3 + 3 + 2')
		const four = chooseHeads({ heads, lanes: [-6, -2, 2, 6].map((x, i) => lane(i + 1, x, 3)), n: N, margin: 0.5 })
		assert.deepEqual([1, 2, 3, 4].map((l) => [...four.values()].filter((v) => v === l).length), [2, 2, 2, 2])
	})
})

describe('WO-1085 handover core: losing people, reach and the grant', () => {
	it('a person lost and found: the lit heads hold, then carry on with no new fade', () => {
		const gone = (s) => s > 5 && s < 6.5
		let during = null
		const { out } = run({
			people: (s) => (gone(s) ? [] : [lane(7, 0.3, 3)]),
			seconds: 9,
			each: (t, o) => {
				if (gone(t / 1000)) {
					assert.equal(lit(o), N, 'idle home: the lit heads stay lit')
					for (const d of o.values()) if (d.level > 0) assert.equal(d.target, null, 'and hold their aim')
					during = during || activeIds(o, 7).join()
				}
			},
		})
		assert.equal(activeIds(out, 7).join(), during, 'the same heads after it is found')
		assert.ok(settled(out))
	})

	it("idle 'dark' fades everything out; home points light every head after pre-aiming", () => {
		let t0 = null
		const { out } = run({
			settings: { ...SETTINGS, idle: 'dark' },
			people: (s) => (s < 4 ? [lane(1, 0, 3)] : []),
			seconds: 6,
			each: (t, o) => {
				if (t >= 4000 && t0 === null) t0 = t
				if (t >= 4000 + 1000 + DT) assert.equal(lit(o), 0, `dark at ${t} ms`)
			},
		})
		assert.equal(lit(out), 0)
		const heads = truss()
		const home = new Map(heads.map((h) => [h.id, { x: h.x, y: 3, z: 0 }]))
		const r = run({ heads, people: () => [], home: () => home, seconds: 3 })
		assert.equal(lit(r.out), 8)
		for (const [id, d] of r.out) assert.deepEqual([d.target.x, d.target.y, d.target.home], [home.get(id).x, 3, true])
	})

	it('a head that cannot reach the person is skipped for the next nearest', () => {
		const { out } = run({ people: () => [lane(1, -1, 3)], reach: (id) => id !== 'h4', seconds: 3 })
		const got = activeIds(out, 1)
		assert.equal(got.length, N)
		assert.ok(!got.includes('h4'), 'h4 (x −1, right under the person) cannot reach')
		assert.ok(got.includes('h3') && got.includes('h5'), `the next nearest: ${got}`)
	})

	it('a head that may not be used (grant revoked) is released with its level frozen; given back, it fades out first', () => {
		let allowed = true
		const h = createHandover()
		const heads = truss()
		let out
		let before = null
		for (let t = 0; t <= 9000; t += DT) {
			allowed = !(t >= 3000 && t < 6000)
			out = h.step({ now: t, heads, lanes: [lane(1, 0, 3)], settings: SETTINGS, usable: () => allowed })
			if (t === 3000 - DT) before = [...out.values()].map((d) => d.level)
			if (!allowed) {
				assert.ok([...out.values()].every((d) => d.phase === 'released' && d.lane === null), 'nothing is ours')
				assert.deepEqual([...out.values()].map((d) => d.level), before, 'levels frozen (the engine fades to the console)')
			}
			if (t === 6000) assert.ok([...out.values()].every((d) => d.phase === (d.level > 0 ? 'out' : 'rest')), 'lit ones fade out first')
		}
		assert.equal(lit(out), N)
		assert.ok(settled(out))
	})
})

describe('WO-1085 thresholds', () => {
	it('a truss along X: bisectors of head k and k + N at x −4 … 4', () => {
		const th = thresholds(truss(), 3)
		assert.deepEqual(th.map((t) => t.at[0]), [-4, -2, 0, 2, 4])
		assert.deepEqual(th[0].dir, [1, 0])
		assert.deepEqual([th[0].a, th[0].b], ['h1', 'h4'])
		assert.deepEqual(thresholds(truss(3), 3), [], 'no threshold when every head is lit')
	})

	it('a truss along Y (the Hilton Wawer rig): the lines cross the stage along X', () => {
		const th = thresholds(truss(8, 'y'), 3)
		assert.equal(th.length, 5)
		for (const t of th) {
			assert.equal(Math.abs(t.dir[1]), 1)
			assert.equal(t.at[0], 4.9)
		}
		assert.deepEqual(th.map((t) => t.at[1]).sort((a, b) => a - b), [-7.5, -5.5, -3.5, -1.5, 0.5])
	})
})
