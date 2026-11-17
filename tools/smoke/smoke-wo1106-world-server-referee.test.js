'use strict'

/**
 * WO-1106 A17 — the referee's per-target maps are swept from the world tick (modules/game-world/server/world-referee.js
 * + world-referee-tick.js): immunity, RC boost gaps, the 60 s logs and the presenter's step gap no longer keep one entry
 * per car / soldier / pair that was ever hit.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createReferee, WINDOW } = require('../../modules/game-world/server/world-referee')

const PH = { rc: 'race', sk: 'match', salad: 'round' }
const car = (o = {}) => ({ g: 'rc', k: 'car', id: 1, p: [0, 0, 0], yaw: 0, n: 'Kuba', c: '#ff0000', f: 0, ...o })
const soldier = (o = {}) => ({ g: 'sk', k: 'soldier', id: 2, p: [0, 0, 0], yaw: 0, n: 'Ola', c: '#00ff00', f: 0, ...o })
const av = (o = {}) => ({ g: 'salad', k: 'av', id: 'a1', p: [0, 0, 0], yaw: 0, n: 'Host', c: '#ffffff', f: 0, ...o })

test('A17: 200 cars hit once, 61 s later one tick → every per-target map is empty', () => {
	const clock = { t: 100000 }
	const ref = createReferee({ seed: 1, now: () => clock.t })
	ref.setWorld({ phase: PH })
	for (let i = 0; i < 200; i++) {
		clock.t += 10
		ref.contact({ g: 'salad', pid: i, name: 'x', veg: 'tomato', p: [0, 0.03, 0], v: [1, -1, 0], tag: 'car' }, car({ id: i }))
		ref.contact({ g: 'rc', pid: i, name: 'y', veg: 'potato', p: [0, 0.03, 0], v: [1, -1, 0], tag: 'soldier' }, soldier({ id: i }))
	}
	const s = ref.sizes()
	assert.equal(s.immUntil, 400, '200 cars + 200 soldiers immune')
	assert.equal(s.rcBoostAt, 200, 'every RC thrower had a boost')
	assert.ok(s.durLog > 0 && s.pairLog > 0 && s.bonusLog > 0)
	clock.t += WINDOW + 1000
	ref.tick({ ents: [] })
	assert.deepEqual(ref.sizes(), { immUntil: 0, rcBoostAt: 0, durLog: 0, pairLog: 0, bonusLog: 0, stepAt: 0 })
})

test('A17: RC boost gaps and the presenter step gap are swept once they passed (not before)', () => {
	let step = null
	for (let seed = 1; seed <= 40 && !step; seed++) {
		const clock = { t: 100000 }
		const ref = createReferee({ seed, now: () => clock.t })
		ref.setWorld({ phase: PH })
		ref.tick({ ents: [car({ p: [0, 0, 0.5] }), av()] })
		clock.t += 100
		if (ref.tick({ ents: [car({ p: [0, 0, 0.4] }), av()] }).effects.length) step = { ref, clock }
	}
	assert.ok(step, 'a seed where the presenter steps aside')
	const { ref, clock } = step
	// an RC driver earns a bonus (R3 bowled over: car → soldier)
	ref.tick({ ents: [car({ id: 9, p: [1, 0, 0.2] })] })
	clock.t += 100
	ref.tick({ ents: [car({ id: 9, p: [1, 0, 0] }), soldier({ p: [1, 0, 0.1] })] })
	assert.equal(ref.sizes().stepAt, 1)
	assert.equal(ref.sizes().rcBoostAt, 1)
	clock.t += 1500
	ref.tick({ ents: [] })
	assert.equal(ref.sizes().rcBoostAt, 1, 'the 3 s gap has not passed')
	clock.t += 2000
	ref.tick({ ents: [] })
	assert.equal(ref.sizes().rcBoostAt, 0)
	assert.equal(ref.sizes().stepAt, 1, 'the 10 s step gap has not passed')
	clock.t += 7000
	ref.tick({ ents: [] })
	assert.equal(ref.sizes().stepAt, 0)
})
