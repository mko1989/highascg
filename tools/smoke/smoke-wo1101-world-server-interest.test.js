'use strict'

/**
 * WO-1101 — Game World interest management (work/notes/game-world-contract.md §1.1, modules/game-world/server/
 * world-interest.js): never more than the cap, the viewer's own game never included, `av` always, radius per game,
 * near every tick / far every 3rd, ≤ 32 updates and ≤ 2560 bytes per message, unchanged entities not repeated, `gone`
 * when an entity leaves interest, and every message decodes with the clients' sanitiser to the same tuples.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const I = require('../../modules/game-world/server/world-interest')
const wire = require('../../modules/game-world/client/world-wire.js')

let W = 0
const ent = (g, k, x, z, o = {}) => ({ w: ++W, g, k, id: W, p: [x, 0, z], yaw: 0, c: '#336699', n: `${k}${W}`, f: 0, s: k === 'veg' ? 'tomato' : '', ...(k === 'veg' ? { v: [0, 0, 0] } : {}), ...o })
const vsNew = () => ({ sent: new Map(), tickN: 0 })
const build = (vs, picked, o = {}) => I.buildWv(vs, picked, { ts: 1000, tags: true, wire, ...o })

test('caps: wq 6 | 12 | 20 (else 12), viewer cap ≤ 20, the world page 80', () => {
	assert.deepEqual([6, 12, 20, 7, 0, 'x', undefined].map(I.qualityCap), [6, 12, 20, 12, 12, 12, 12])
	assert.equal(I.capFor(6), 6)
	assert.equal(I.capFor(50), 20)
	assert.equal(I.capFor(undefined), 12)
	assert.equal(I.capFor(6, true), 80)
})

test('selection: own game never, never more than the cap, closest / most important first', () => {
	const ents = []
	for (let i = 0; i < 40; i++) ents.push(ent('sk', 'soldier', i * 0.1, 0))
	for (let i = 0; i < 10; i++) ents.push(ent('rc', 'car', i * 0.1, 0))
	const p = I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, ents)
	assert.equal(p.length, 12)
	assert.ok(p.every((x) => x.e.g !== 'rc'))
	for (let i = 1; i < p.length; i++) assert.ok(p[i].pri >= p[i - 1].pri)
	assert.equal(I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 6 }, ents).length, 6)
	assert.equal(I.selectInterest({ g: null, p: null, cap: 80, center: [0, 0, 0] }, ents).length, 50, 'world page: all games, no exclusion')
})

test('radius by the viewer\'s game: rc 8 m, sk 4 m (+ airborne ≤ 6 m), salad 30 m, spectators unlimited; av always (and first)', () => {
	const far5 = ent('salad', 'sling', 5, 0)
	const far9 = ent('sk', 'soldier', 9, 0)
	const veg5 = ent('salad', 'veg', 5, 0)
	const air5 = ent('rc', 'car', 5, 0, { f: 16 })
	const av50 = ent('salad', 'av', 50, 0)
	const ws = (v) => I.selectInterest(v, [far5, far9, veg5, air5, av50]).map((x) => x.e.w)
	assert.deepEqual(ws({ g: 'rc', p: [0, 0, 0], cap: 20 }).sort(), [far5.w, veg5.w, av50.w].sort())
	assert.deepEqual(ws({ g: 'sk', p: [0, 0, 0], cap: 20 }).sort(), [veg5.w, air5.w, av50.w].sort(), 'sk: 4 m + airborne ≤ 6 m')
	assert.deepEqual(ws({ g: 'salad', p: [0, 0, 0], cap: 20 }).sort(), [far9.w, air5.w].sort(), 'salad: 30 m; its own avatar / slings / veg excluded')
	assert.equal(ws({ g: 'rc', p: null, cap: 20, center: [0, 0, 0] }).length, 4, 'spectator: unlimited radius')
	assert.equal(I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 1 }, [far5, av50])[0].e.w, av50.w, 'av first even at cap 1')
})

test('rates: near (≤ ⅓ radius or veg) every tick, the rest every 3rd tick; unchanged entities are not repeated', () => {
	const near = ent('sk', 'soldier', 1, 0)
	const far = ent('sk', 'soldier', 7, 0)
	const veg = ent('salad', 'veg', 7.5, 0, { v: [1, 0, 0] })
	const vs = vsNew()
	const counts = { [near.w]: 0, [far.w]: 0, [veg.w]: 0 }
	for (let t = 0; t < 30; t++) {
		near.p[0] += 0.001
		far.p[0] += 0.001
		veg.p[0] += 0.001
		const picked = I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, [near, far, veg])
		const m = build(vs, picked)
		for (const e of m.e || []) counts[e[0]]++
	}
	assert.equal(counts[near.w], 30)
	assert.equal(counts[veg.w], 30)
	assert.ok(counts[far.w] >= 10 && counts[far.w] <= 11, `far ${counts[far.w]}`)
	// nothing moves → nothing more to say
	const picked = I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, [near, far, veg])
	for (let i = 0; i < 3; i++) build(vs, picked)
	assert.equal(build(vs, picked), null)
})

test('add precedes the first e of a w (same message); c / n / s change re-sends the add; tags off → n ""', () => {
	const sl = ent('salad', 'sling', 1, 0, { s: 10 })
	const vs = vsNew()
	let m = build(vs, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, [sl]))
	assert.deepEqual(m.add, [[sl.w, 'sling', 'salad', '#336699', sl.n, 10]])
	assert.equal(m.e[0][0], sl.w)
	sl.s = 55
	m = build(vs, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, [sl]))
	assert.deepEqual(m.add[0][5], 55)
	const vs2 = vsNew()
	m = build(vs2, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 6 }, [sl]), { tags: false })
	assert.equal(m.add[0][4], '')
})

test('≤ 32 updates and ≤ 2560 bytes per message; the rest waits for the next tick (highest priority first)', () => {
	const ents = []
	for (let i = 0; i < 80; i++) ents.push(ent(i % 2 ? 'sk' : 'salad', i % 3 ? 'soldier' : 'veg', (i % 9) * 0.3, Math.floor(i / 9) * 0.3, { n: 'Long-name-player', v: i % 3 ? undefined : [12.345, -3.21, 7.654] }))
	const vs = vsNew()
	const picked = I.selectInterest({ g: null, p: null, cap: 80, center: [0, 0, 0] }, ents)
	let total = 0
	for (let t = 0; t < 6; t++) {
		const m = build(vs, picked)
		if (!m) break
		const bytes = JSON.stringify(m).length
		assert.ok(bytes <= I.MAX_BYTES, `bytes ${bytes}`)
		assert.ok((m.e || []).length <= I.MAX_UPDATES)
		if (t === 0) assert.deepEqual(m.e.map((x) => x[0]), picked.slice(0, m.e.length).map((x) => x.e.w), 'priority order')
		total += (m.add || []).length
	}
	assert.equal(total, 80, 'everything reached the viewer over a few ticks')
})

test('gone when an entity leaves interest (out of radius or the world); a re-entry is an add again', () => {
	const a = ent('sk', 'soldier', 1, 0)
	const b = ent('sk', 'soldier', 2, 0)
	const vs = vsNew()
	build(vs, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, [a, b]))
	b.p[0] = 20
	let m = build(vs, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, [a, b]))
	assert.deepEqual(m.gone, [b.w])
	m = build(vs, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, []))
	assert.deepEqual(m.gone, [a.w])
	assert.equal(vs.sent.size, 0)
	m = build(vs, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, [a]))
	assert.equal(m.add[0][0], a.w)
})

test('fx only for entities the viewer has', () => {
	const a = ent('sk', 'soldier', 1, 0)
	const vs = vsNew()
	const m = build(vs, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 12 }, [a]), { fx: [[a.w, 'stun', 800, '#ff0000'], [999999, 'hop', 600, '']] })
	assert.deepEqual(m.fx, [[a.w, 'stun', 800, '#ff0000']])
})

test('wire round trip: every message the builder makes decodes to exactly the same tuples', () => {
	const ents = []
	for (let i = 0; i < 30; i++) ents.push(ent(['sk', 'salad', 'world'][i % 3], ['soldier', 'veg', 'splat', 'sling', 'av'][i % 5], i * 0.123456, -i * 0.0777, { yaw: i * 0.1234567, f: i % 7, v: i % 5 === 1 ? [1.23456, -2.5, 0.0004] : undefined }))
	const vs = vsNew()
	for (let t = 0; t < 5; t++) {
		for (const e of ents) e.p[1] += 0.0101
		for (const e of ents) if (!e.v) delete e.v
		const m = build(vs, I.selectInterest({ g: 'rc', p: [0, 0, 0], cap: 20 }, ents), { fx: [[ents[0].w, 'splat', 4000, '#d8352a']] })
		const back = JSON.parse(JSON.stringify(m))
		const d = wire.decodeWv(back)
		assert.deepEqual(wire.encodeWv(d), back, `tick ${t}`)
		for (const e of d.e) {
			const kind = ents.find((x) => x.w === e[0]).k
			assert.equal(e.length, kind === 'veg' ? 9 : 6, 'velocity only for veg')
		}
	}
})
