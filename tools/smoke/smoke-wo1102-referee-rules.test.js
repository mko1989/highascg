'use strict'

/**
 * WO-1102 — the Game World referee, rule by rule (work/notes/game-world-contract.md §6): for R1–R9 the trigger, a near
 * miss that does not trigger, `soft` (visual only, no bonus), `off` (never a target) and presenter `safe` (nothing).
 * The referee is pure: clock and seed injected (modules/game-world/server/world-referee.js + world-referee-tick.js).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createReferee } = require('../../modules/game-world/server/world-referee')

const PH = { rc: 'race', sk: 'match', salad: 'round' }
function mk(seed = 1, extra = {}) {
	const clock = { t: 100000 }
	const ref = createReferee({ seed, now: () => clock.t })
	ref.setWorld({ phase: PH, ...extra })
	return { ref, clock }
}
const car = (o = {}) => ({ g: 'rc', k: 'car', id: 1, p: [0, 0, 0], yaw: 0, n: 'Kuba', c: '#ff0000', f: 0, ...o })
const soldier = (o = {}) => ({ g: 'sk', k: 'soldier', id: 2, p: [0, 0, 0], yaw: 0, n: 'Ola', c: '#00ff00', f: 0, ...o })
const av = (o = {}) => ({ g: 'salad', k: 'av', id: 'a1', p: [0, 0, 0], yaw: 0, n: 'Host', c: '#ffffff', f: 0, ...o })
const tomato = (o = {}) => ({ g: 'salad', pid: 5, name: 'Ola', veg: 'tomato', p: [0, 0.03, 0], v: [1, -1, 0], tag: 'car', ...o })

/* ---------------- R1 splat-hop ---------------- */
test('R1: a splat vegetable on a car → hop 0.6 s, splat decal, +bonus to the thrower; ends the flight', () => {
	const { ref } = mk()
	const out = ref.contact(tomato(), car())
	assert.equal(out.end, true)
	assert.equal(out.effects.length, 1)
	const e = out.effects[0]
	assert.deepEqual([e.k, e.g, e.id, e.dur, e.soft, e.c], ['hop', 'rc', 1, 0.6, false, '#d8352a'])
	assert.deepEqual(e.by, { g: 'salad', name: 'Ola' })
	assert.deepEqual(out.bonuses, [{ g: 'salad', pid: 5, kind: 'hop' }])
	assert.equal(out.events[0].k, 'R1')
	assert.deepEqual(out.events[0].to, { g: 'rc', name: 'Kuba' })
	assert.deepEqual(out.fx.map((f) => f.kind), ['splat', 'hop'])
	assert.equal(out.fx[0].ms, 4000)
})
test('R1: no target / tag mismatch → no effect (the flight still ends for a splat vegetable)', () => {
	const { ref } = mk()
	assert.deepEqual(ref.contact(tomato(), null).effects, [])
	assert.equal(ref.contact(tomato(), null).end, true)
	assert.deepEqual(ref.contact(tomato({ tag: 'soldier' }), car()).effects, [])
	assert.deepEqual(ref.contact(tomato({ g: 'rc' }), car()).effects, [], 'never its own game')
})
test('R1: soft → visual only, no bonus; off → nothing; safe → nothing; frozen phase → nothing', () => {
	let { ref } = mk(1, { affect: { rc: 'soft' } })
	let out = ref.contact(tomato(), car())
	assert.equal(out.effects[0].soft, true)
	assert.deepEqual(out.bonuses, [])
	;({ ref } = mk(1, { affect: { rc: 'off' } }))
	out = ref.contact(tomato(), car())
	assert.deepEqual([out.effects, out.bonuses, out.events, out.end], [[], [], [], true])
	;({ ref } = mk(1, { safe: true }))
	assert.deepEqual(ref.contact(tomato(), car()).effects, [])
	for (const ph of ['countdown', 'results', 'paused']) {
		;({ ref } = mk(1, { phase: { ...PH, rc: ph } }))
		assert.deepEqual(ref.contact(tomato(), car()).effects, [], ph)
	}
})

/* ---------------- R2 slick patch ---------------- */
test('R2: a splat vegetable on the floor / stage leaves a slick patch for 8 s (r tomato 0.15, cabbage 0.25, peas 0.06)', () => {
	const { ref, clock } = mk()
	for (const [veg, r] of [['tomato', 150], ['cabbage', 250], ['peas', 60]]) {
		const out = ref.landed({ g: 'salad', pid: 5, veg, p: [1, 0, 2], tag: veg === 'cabbage' ? 'stage' : 'floor' })
		assert.ok(out.patch, veg)
		assert.deepEqual(out.effects, [], 'an environment, not an effect')
		assert.ok(ref.ents().some((e) => e.k === 'splat' && e.f === 1 && e.s === r), veg)
	}
	clock.t += 8001
	assert.equal(ref.ents().filter((e) => e.k === 'splat').length, 0)
	assert.equal(ref.counts().R2, 3)
})
test('R2: no patch for a non-splat vegetable, another tag, or while safe; affect does not change it (no target)', () => {
	let { ref } = mk()
	assert.equal(ref.landed({ g: 'salad', pid: 5, veg: 'potato', p: [0, 0, 0], tag: 'floor' }).patch, undefined)
	assert.equal(ref.landed({ g: 'salad', pid: 5, veg: 'tomato', p: [0, 0, 0], tag: 'avatar' }).patch, undefined)
	;({ ref } = mk(1, { safe: true }))
	assert.equal(ref.landed({ g: 'salad', pid: 5, veg: 'tomato', p: [0, 0, 0], tag: 'floor' }).patch, undefined)
	for (const mode of ['soft', 'off']) {
		;({ ref } = mk(1, { affect: { rc: mode, sk: mode, salad: mode } }))
		assert.ok(ref.landed({ g: 'salad', pid: 5, veg: 'tomato', p: [0, 0, 0], tag: 'floor' }).patch, mode)
	}
	;({ ref } = mk())
	for (let i = 0; i < 20; i++) ref.landed({ g: 'salad', pid: 5, veg: 'tomato', p: [i, 0, 0], tag: 'floor' })
	assert.equal(ref.ents().length, 12, '≤ 12 patches (newest)')
})

/* ---------------- R3 bowled over ---------------- */
test('R3: a car (≥ 0.4 m/s) sweeping through a live soldier → stun 0.8 s + knock-back along its heading, bump 0.2 s on the car, mini-boost to the driver', () => {
	// moving 0.1 m in 0.1 s along −Z = 1 m/s, yaw 0 faces −Z
	const { ref: r2, clock: c2 } = mk()
	r2.tick({ ents: [car({ p: [0, 0, 0.1] }), soldier({ p: [0, 0, -0.02] })] })
	c2.t += 100
	const o = r2.tick({ ents: [car({ p: [0, 0, 0] }), soldier({ p: [0, 0, -0.02] })] })
	const stun = o.effects.find((e) => e.k === 'stun')
	const bump = o.effects.find((e) => e.k === 'bump')
	assert.deepEqual([stun.g, stun.id, stun.dur, stun.soft, stun.dir], ['sk', 2, 0.8, false, [0, -1]])
	assert.deepEqual([bump.g, bump.id, bump.dur, bump.soft], ['rc', 1, 0.2, false])
	assert.deepEqual(o.bonuses, [{ g: 'rc', pid: 1, kind: 'bowl' }])
	assert.deepEqual(o.events.map((e) => e.k), ['R3'], 'one event per collision')
})
test('R3: too slow (spd < 0.4), a dead or protected soldier, or a miss → nothing', () => {
	for (const [carO, solO] of [[{ spd: 0.3 }, {}], [{}, { f: 2 }], [{}, { f: 4 }], [{}, { p: [0.2, 0, -0.02] }]]) {
		const { ref, clock } = mk()
		ref.tick({ ents: [car({ p: [0, 0, 0.1], ...carO }), soldier({ p: [0, 0, -0.02], ...solO })] })
		clock.t += 100
		const o = ref.tick({ ents: [car({ p: [0, 0, 0], ...carO }), soldier({ p: [0, 0, -0.02], ...solO })] })
		assert.deepEqual(o.effects, [], JSON.stringify([carO, solO]))
	}
})
function bowl2(extra) {
	const { ref, clock } = mk(1, extra)
	ref.tick({ ents: [car({ p: [0, 0, 0.1] }), soldier({ p: [0, 0, -0.02] })] })
	clock.t += 100
	return ref.tick({ ents: [car({ p: [0, 0, 0] }), soldier({ p: [0, 0, -0.02] })] })
}
test('R3: soft → visual only and no boost; off → no stun; safe → nothing', () => {
	let o = bowl2({ affect: { sk: 'soft' } })
	assert.equal(o.effects.find((e) => e.k === 'stun').soft, true)
	assert.deepEqual(o.bonuses, [])
	o = bowl2({ affect: { sk: 'off' } })
	assert.equal(o.effects.find((e) => e.k === 'stun'), undefined)
	o = bowl2({ safe: true })
	assert.deepEqual(o.effects, [])
})

/* ---------------- R4 sparks ---------------- */
const shotQ = (o = {}) => ({ g: 'sk', pid: 2, name: 'Ola', o: [0, 0.03, 1], yaw: 0, range: 3, los: () => true, ...o })
test('R4: a hitscan ray passing within 0.04 m of a car → wobble 0.25 s, sparks, sk bonus', () => {
	const { ref } = mk()
	const out = ref.shot(shotQ(), [car()])
	assert.deepEqual(out.effects.map((e) => [e.k, e.g, e.id, e.dur, e.soft]), [['wobble', 'rc', 1, 0.25, false]])
	assert.deepEqual(out.bonuses, [{ g: 'sk', pid: 2, kind: 'sparks' }])
	assert.equal(out.fx[0].kind, 'sparks')
	assert.equal(out.events[0].k, 'R4')
})
test('R4: a miss, behind the muzzle, out of range, blocked line of sight or its own game → nothing', () => {
	const { ref } = mk()
	assert.deepEqual(ref.shot(shotQ(), [car({ p: [0.06, 0, 0] })]).effects, [])
	assert.deepEqual(ref.shot(shotQ({ yaw: Math.PI }), [car()]).effects, [])
	assert.deepEqual(ref.shot(shotQ({ range: 0.5 }), [car()]).effects, [])
	assert.deepEqual(ref.shot(shotQ({ los: () => false }), [car()]).effects, [])
	assert.deepEqual(ref.shot(shotQ({ los: () => 0.4 }), [car()]).effects, [])
	assert.deepEqual(ref.shot(shotQ({ g: 'rc' }), [car()]).effects, [])
})
test('R4: soft → visual only / no bonus; off → nothing; safe → nothing', () => {
	let out = mk(1, { affect: { rc: 'soft' } }).ref.shot(shotQ(), [car()])
	assert.equal(out.effects[0].soft, true)
	assert.deepEqual(out.bonuses, [])
	assert.deepEqual(mk(1, { affect: { rc: 'off' } }).ref.shot(shotQ(), [car()]).effects, [])
	assert.deepEqual(mk(1, { safe: true }).ref.shot(shotQ(), [car()]).effects, [])
})

/* ---------------- R5 pea scatter ---------------- */
const peas = (o = {}) => ({ g: 'salad', pid: 5, name: 'Ola', veg: 'peas', p: [0.2, 0, 0], tag: 'floor', ...o })
test('R5: peas landing within 0.25 m of a live soldier → scatter 0.5 s, +bonus', () => {
	const out = mk().ref.landed(peas(), [soldier()])
	assert.deepEqual(out.effects.map((e) => [e.k, e.g, e.dur, e.soft]), [['scatter', 'sk', 0.5, false]])
	assert.deepEqual(out.bonuses, [{ g: 'salad', pid: 5, kind: 'scatter' }])
	assert.equal(out.events[0].k, 'R5')
})
test('R5: farther than 0.25 m, another vegetable, a dead soldier → no scatter; soft / off / safe', () => {
	assert.deepEqual(mk().ref.landed(peas({ p: [0.3, 0, 0] }), [soldier()]).effects, [])
	assert.deepEqual(mk().ref.landed(peas({ veg: 'tomato' }), [soldier()]).effects, [])
	assert.deepEqual(mk().ref.landed(peas(), [soldier({ f: 2 })]).effects, [])
	const s = mk(1, { affect: { sk: 'soft' } }).ref.landed(peas(), [soldier()])
	assert.equal(s.effects[0].soft, true)
	assert.deepEqual(s.bonuses, [])
	assert.deepEqual(mk(1, { affect: { sk: 'off' } }).ref.landed(peas(), [soldier()]).effects, [])
	assert.deepEqual(mk(1, { safe: true }).ref.landed(peas(), [soldier()]).effects, [])
})

/* ---------------- R6 bounce ---------------- */
test('R6: a bouncing vegetable on a car → hop (flight goes on); on a soldier → stun 0.5 s; a splat vegetable ends on a soldier', () => {
	let out = mk().ref.contact(tomato({ veg: 'potato' }), car())
	assert.equal(out.end, false)
	assert.deepEqual(out.effects.map((e) => [e.k, e.dur]), [['hop', 0.6]])
	assert.deepEqual(out.bonuses, [{ g: 'salad', pid: 5, kind: 'bounce' }])
	assert.equal(out.events[0].k, 'R6')
	out = mk().ref.contact(tomato({ veg: 'onion', tag: 'soldier' }), soldier())
	assert.equal(out.end, false)
	assert.deepEqual(out.effects.map((e) => [e.k, e.g, e.dur]), [['stun', 'sk', 0.5]])
	out = mk().ref.contact(tomato({ tag: 'soldier' }), soldier())
	assert.equal(out.end, true)
	assert.deepEqual(out.fx.map((f) => f.kind), ['splat', 'stun'])
})
test('R6: a protected soldier → nothing; soft / off / safe', () => {
	assert.deepEqual(mk().ref.contact(tomato({ veg: 'onion', tag: 'soldier' }), soldier({ f: 4 })).effects, [])
	const s = mk(1, { affect: { sk: 'soft' } }).ref.contact(tomato({ veg: 'onion', tag: 'soldier' }), soldier())
	assert.equal(s.effects[0].soft, true)
	assert.deepEqual(s.bonuses, [])
	assert.deepEqual(mk(1, { affect: { sk: 'off' } }).ref.contact(tomato({ veg: 'onion', tag: 'soldier' }), soldier()).effects, [])
	assert.deepEqual(mk(1, { safe: true }).ref.contact(tomato({ veg: 'onion', tag: 'soldier' }), soldier()).effects, [])
})

/* ---------------- R7 make way ---------------- */
function approach(seed, extra = {}, avO = {}, from = [0, 0, 0.5], to = [0, 0, 0.4]) {
	const { ref, clock } = mk(seed, extra)
	ref.tick({ ents: [car({ p: from }), av(avO)] })
	clock.t += 100
	return { out: ref.tick({ ents: [car({ p: to }), av(avO)] }), ref, clock }
}
test('R7: a car ≥ 0.3 m/s towards the avatar within 0.6 m → chance 0.5 (seeded) of a friendly sideways step', () => {
	const results = []
	for (let seed = 1; seed <= 40; seed++) results.push(approach(seed).out.effects.length)
	const steps = results.filter((n) => n === 1).length
	assert.ok(steps > 8 && steps < 32, `about half step: ${steps}/40`)
	const seed = results.indexOf(1) + 1
	const { out } = approach(seed)
	const e = out.effects[0]
	assert.deepEqual([e.k, e.g, e.id, e.dur, e.soft], ['step', 'salad', 'a1', 0.7, false])
	assert.equal(Math.abs(e.dir[0]), 1, 'sideways to the car (which moves along Z)')
	assert.deepEqual(out.bonuses, [], 'no points either way')
	assert.deepEqual(approach(seed).out, out, 'deterministic per seed')
})
test('R7: moving away, too far, the avatar already ducking → nothing; one step per 10 s', () => {
	const seed = [...Array(40).keys()].map((i) => i + 1).find((s) => approach(s).out.effects.length === 1)
	assert.deepEqual(approach(seed, {}, {}, [0, 0, 0.4], [0, 0, 0.5]).out.effects, [])
	assert.deepEqual(approach(seed, {}, {}, [0, 0, 0.8], [0, 0, 0.7]).out.effects, [])
	assert.deepEqual(approach(seed, {}, { f: 16 }).out.effects, [])
	const { ref, clock } = approach(seed)
	let more = 0
	for (let i = 0; i < 90; i++) {
		clock.t += 100
		const z = 0.5 - (i % 2) * 0.1
		more += ref.tick({ ents: [car({ p: [0, 0, z] }), av()] }).effects.length
	}
	assert.equal(more, 0, 'no second step within 10 s')
})
test('R7: soft → no step at all (a step is physics); off → nothing; safe → nothing', () => {
	for (const extra of [{ affect: { salad: 'soft' } }, { affect: { salad: 'off' } }, { safe: true }]) {
		for (let seed = 1; seed <= 10; seed++) assert.deepEqual(approach(seed, extra).out.effects, [], JSON.stringify(extra))
	}
})

/* ---------------- R8 vegetable rain ---------------- */
function rainRun(extra = {}, secs = 10, ms = 8000, ents) {
	const { ref, clock } = mk(7, extra)
	const grid = []
	for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) grid.push(soldier({ id: `s${i}${j}`, p: [i * 0.05, 0, j * 0.05] }))
	const list = ents || grid
	ref.startEvent('rain', secs)
	const all = { effects: [], events: [], drops: 0 }
	for (let t = 0; t < ms; t += 100) {
		clock.t += 100
		const o = ref.tick({ ents: list, areas: { sk: { rect: [-0.2, -0.2, 0.2, 0.2], y: 0 } } })
		all.effects.push(...o.effects)
		all.events.push(...o.events)
		all.drops = Math.max(all.drops, ref.ents().filter((e) => e.k === 'veg').length)
	}
	return { ...all, ref }
}
test('R8: rain drops world vegetables over the play area (1.5 / s) that stun soldiers (by world, no bonus) and leave slick patches', () => {
	const r = rainRun()
	assert.ok(r.drops > 0, 'vegetables in flight')
	const vs = r.ref.ents().filter((e) => e.k === 'veg')
	for (const v of vs) assert.equal(v.f, 1)
	assert.ok(r.effects.length > 0, 'something hit')
	for (const e of r.effects) {
		assert.equal(e.by.g, 'world')
		assert.ok(e.k === 'stun' && e.dur === 0.5)
	}
	assert.ok(r.events.every((e) => e.k === 'R8'))
	const n = r.ref.counts().R8 || 0
	assert.ok(n >= 1 && n <= 14, `hits ${n} (≤ 1.5/s × 8 s)`)
})
test('R8: no rain in a frozen phase, over an off game, or while safe; soft → visual only; ends after its secs', () => {
	assert.equal(rainRun({ phase: { ...PH, sk: 'countdown' } }).drops, 0)
	assert.equal(rainRun({ affect: { sk: 'off' } }).drops, 0)
	assert.equal(rainRun({ safe: true }).drops, 0)
	const soft = rainRun({ affect: { sk: 'soft' } })
	assert.ok(soft.effects.length > 0 && soft.effects.every((e) => e.soft))
	const short = rainRun({}, 5, 9000, [])
	assert.equal(short.ref.events(), null, 'event over')
	assert.equal(short.ref.ents().filter((e) => e.k === 'veg').length, 0, 'all landed')
	assert.ok((short.ref.counts().R2 || 0) > 0, 'splat vegetables left slick patches')
})

/* ---------------- R9 spotlight ---------------- */
function spotRun(extra = {}, entsList = [soldier()], pools = { sk: [{ x: 0, z: 0, y: 0, r: 0.5 }] }, ms = 30000) {
	const { ref, clock } = mk(3, extra)
	ref.startEvent('spot', 30)
	const bonuses = []
	const events = []
	for (let t = 0; t < ms; t += 100) {
		clock.t += 100
		const o = ref.tick({ ents: entsList, pools })
		bonuses.push(...o.bonuses)
		events.push(...o.events)
	}
	return { bonuses, events, ref }
}
test('R9: every 2 s a player in its own game\'s light pool earns that game\'s bonus, ≤ 5 per player per event', () => {
	const r = spotRun()
	assert.equal(r.bonuses.length, 5)
	assert.ok(r.bonuses.every((b) => b.g === 'sk' && b.pid === 2 && b.kind === 'spot'))
	assert.ok(r.events.every((e) => e.k === 'R9'))
	const two = spotRun({}, [soldier(), soldier({ id: 3 })])
	assert.equal(two.bonuses.length, 10)
})
test('R9: outside the pool, another game\'s pool, a dead soldier, an off game, safe → nothing; soft still pays (no target)', () => {
	assert.equal(spotRun({}, [soldier({ p: [0.6, 0, 0] })]).bonuses.length, 0)
	assert.equal(spotRun({}, [soldier()], { rc: [{ x: 0, z: 0, y: 0, r: 0.5 }] }).bonuses.length, 0)
	assert.equal(spotRun({}, [soldier({ f: 2 })]).bonuses.length, 0)
	assert.equal(spotRun({ affect: { sk: 'off' } }).bonuses.length, 0)
	assert.equal(spotRun({ safe: true }).bonuses.length, 0)
	assert.equal(spotRun({ affect: { sk: 'soft' } }).bonuses.length, 5)
	const rc = spotRun({}, [car()], { rc: [{ x: 0, z: 0, y: 0, r: 0.5 }] }, 12000)
	const times = rc.bonuses.length
	assert.ok(times >= 3 && times <= 4, `rc boost at most once per 3 s (${times} in 12 s)`)
})

test('events: safe ends rain and spot; event state reports what runs', () => {
	const { ref } = mk()
	ref.startEvent('rain', 10)
	ref.startEvent('spot', 30)
	assert.deepEqual(ref.events(), { rain: { secs: 10, left: 10 }, spot: { secs: 30, left: 30 } })
	ref.setWorld({ safe: true })
	assert.equal(ref.events(), null)
	ref.setWorld({ safe: false })
	ref.startEvent('spot', 5)
	ref.endEvent('spot')
	assert.equal(ref.events(), null)
})
