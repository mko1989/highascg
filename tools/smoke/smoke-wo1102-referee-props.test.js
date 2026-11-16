'use strict'

/**
 * WO-1102 — Game World referee property tests (work/notes/game-world-contract.md §6 "Caps", §6.5): ≥ 200 seeded random
 * scripts of contacts, landings, shots, ticks (cars sweeping through soldiers, approaching the avatar), rain and spot
 * events, affect / safe changes, hammering a few targets from a few sources. Over every script:
 *   - no target loses more than 4 s (control-loss `dur`) in any rolling 60 s
 *   - no source → target pair has more than 3 control-loss effects in any rolling 60 s
 *   - no source earns more than 12 bonuses in any rolling 60 s
 *   - immunity holds (car 3 s, soldier 4 s, avatar 10 s after a control-loss effect: no other control loss)
 *   - nothing while safe, never an `off` target
 *   - determinism: the same seed gives the same output (JSON), a different seed a different one
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createReferee, mulberry32 } = require('../../modules/game-world/server/world-referee')

const RUNS = 220
const IMM = { rc: 3000, sk: 4000, salad: 10000 }
const VEG = ['tomato', 'potato', 'carrot', 'cabbage', 'onion', 'peas']

function script(seed) {
	const r = mulberry32(seed * 7919 + 13)
	const pick = (a) => a[Math.floor(r() * a.length)]
	const clock = { t: 1_000_000 }
	const ref = createReferee({ seed, now: () => clock.t })
	const phase = { rc: 'race', sk: 'match', salad: 'round' }
	const affect = { rc: 'on', sk: 'on', salad: 'on' }
	let safe = false
	ref.setWorld({ phase, affect })
	const cars = [1, 2, 3].map((id) => ({ g: 'rc', k: 'car', id, p: [r() * 0.4, 0, r() * 0.4], yaw: 0, n: `rc${id}`, c: '#ff0000', f: 0 }))
	const sols = [1, 2, 3].map((id) => ({ g: 'sk', k: 'soldier', id, p: [r() * 0.4, 0, r() * 0.4], yaw: 0, n: `sk${id}`, c: '#00ff00', f: 0 }))
	const avs = [{ g: 'salad', k: 'av', id: 'a', p: [0.2, 0, 0.2], yaw: 0, n: 'av', c: '#ffffff', f: 0 }]
	const log = [] // { t, kind: 'effect'|'bonus', x, src, safe, affect }
	const record = (out, src) => {
		for (const e of out.effects) log.push({ t: clock.t, kind: 'effect', x: e, src: src || `${e.by.g}:${e.by.name}`, safe, mode: affect[e.g] })
		for (const b of out.bonuses) log.push({ t: clock.t, kind: 'bonus', x: b, safe })
	}
	for (let i = 0; i < 400; i++) {
		clock.t += Math.floor(r() * r() * 1500)
		const op = r()
		if (op < 0.3) {
			const pid = 1 + Math.floor(r() * 3)
			const tg = r() < 0.5 ? pick(cars) : pick(sols)
			record(ref.contact({ g: 'salad', pid, name: `salad${pid}`, veg: pick(VEG), p: tg.p, v: [1, -1, 0], tag: tg.k }, tg), `salad:salad${pid}`)
		} else if (op < 0.4) {
			const pid = 1 + Math.floor(r() * 3)
			const s = pick(sols)
			record(ref.landed({ g: 'salad', pid, name: `salad${pid}`, veg: r() < 0.7 ? 'peas' : 'tomato', p: [s.p[0] + 0.1, 0, s.p[2]], tag: 'floor' }, sols), `salad:salad${pid}`)
		} else if (op < 0.55) {
			const s = pick(sols)
			const c = pick(cars)
			record(ref.shot({ g: 'sk', pid: s.id, name: s.n, o: [c.p[0], 0.025, c.p[2] + 1], yaw: 0, range: 3, los: () => r() < 0.8 }, cars), `sk:${s.n}`)
		} else if (op < 0.9) {
			// cars move (sometimes fast through a soldier or at the avatar), soldiers die / respawn
			for (const c of cars) {
				const aim = r() < 0.3 ? pick(sols).p : r() < 0.2 ? avs[0].p : [r() * 0.4, 0, r() * 0.4]
				c.p = [c.p[0] + (aim[0] - c.p[0]) * r(), 0, c.p[2] + (aim[2] - c.p[2]) * r()]
				c.spd = r() < 0.5 ? r() * 2 : undefined
			}
			for (const s of sols) s.f = r() < 0.1 ? 2 : r() < 0.05 ? 4 : 0
			avs[0].f = r() < 0.1 ? 16 : 0
			record(ref.tick({ ents: [...cars, ...sols, ...avs], areas: { sk: { rect: [0, 0, 0.4, 0.4], y: 0 } }, pools: { rc: [{ x: 0.2, z: 0.2, y: 0, r: 0.3 }], sk: [{ x: 0.2, z: 0.2, y: 0, r: 0.3 }] } }))
		} else if (op < 0.94) {
			if (r() < 0.5) ref.startEvent(r() < 0.5 ? 'rain' : 'spot', 5 + Math.floor(r() * 55))
			else ref.endEvent(pick(['rain', 'spot', 'none']))
		} else if (op < 0.98) {
			affect[pick(['rc', 'sk', 'salad'])] = pick(['on', 'on', 'soft', 'off'])
			ref.setWorld({ affect })
		} else {
			safe = r() < 0.3
			ref.setWorld({ safe })
		}
	}
	return log
}

const key = (e) => `${e.g}:${e.id}`
function check(log, seed) {
	const fx = log.filter((l) => l.kind === 'effect')
	const hard = fx.filter((l) => !l.x.soft)
	for (const l of fx) {
		assert.equal(l.safe, false, `seed ${seed}: an effect while safe`)
		assert.notEqual(l.mode, 'off', `seed ${seed}: an effect on an off game`)
		if (l.mode === 'soft') assert.equal(l.x.soft, true, `seed ${seed}: soft game took control loss`)
	}
	for (const l of hard) {
		const tk = key(l.x)
		const win = hard.filter((m) => key(m.x) === tk && m.t > l.t - 60000 && m.t <= l.t)
		const sum = win.reduce((s, m) => s + m.x.dur, 0)
		assert.ok(sum <= 4 + 1e-9, `seed ${seed}: target ${tk} lost ${sum} s in 60 s`)
		const pair = win.filter((m) => m.src === l.src)
		assert.ok(pair.length <= 3, `seed ${seed}: pair ${l.src}>${tk} ${pair.length} control effects in 60 s`)
		const imm = IMM[l.x.g]
		const next = hard.find((m) => m !== l && key(m.x) === tk && m.t > l.t - imm && m.t <= l.t && hard.indexOf(m) < hard.indexOf(l))
		assert.equal(next, undefined, `seed ${seed}: immunity broken on ${tk}`)
	}
	const bon = log.filter((l) => l.kind === 'bonus')
	for (const l of bon) {
		const sk = `${l.x.g}:${l.x.pid}`
		const n = bon.filter((m) => `${m.x.g}:${m.x.pid}` === sk && m.t > l.t - 60000 && m.t <= l.t).length
		assert.ok(n <= 12, `seed ${seed}: source ${sk} earned ${n} bonuses in 60 s`)
	}
	return { effects: fx.length, hard: hard.length, bonuses: bon.length }
}

test(`caps hold over ${RUNS} seeded random scripts (target ≤ 4 s / 60 s, pair ≤ 3, source ≤ 12 bonuses, immunity, safe, off)`, () => {
	const tot = { effects: 0, hard: 0, bonuses: 0, softened: 0 }
	for (let seed = 1; seed <= RUNS; seed++) {
		const c = check(script(seed), seed)
		tot.effects += c.effects
		tot.hard += c.hard
		tot.bonuses += c.bonuses
	}
	tot.softened = tot.effects - tot.hard
	// the scripts must actually exercise the caps: many effects, many degraded to visual only, many bonuses
	assert.ok(tot.hard > RUNS * 5, `control-loss effects: ${tot.hard}`)
	assert.ok(tot.softened > RUNS * 5, `visual-only (capped / soft): ${tot.softened}`)
	assert.ok(tot.bonuses > RUNS * 3, `bonuses: ${tot.bonuses}`)
})

test('the caps are reached, not just respected: one source hammering one car', () => {
	const clock = { t: 0 }
	const ref = createReferee({ seed: 1, now: () => clock.t })
	ref.setWorld({ phase: { rc: 'race' } })
	const car = { g: 'rc', k: 'car', id: 1, p: [0, 0, 0], n: 'c' }
	const hard = []
	let bonuses = 0
	for (let i = 0; i < 60; i++) {
		clock.t += 1000
		const out = ref.contact({ g: 'salad', pid: 9, veg: 'tomato', p: [0, 0, 0], v: [0, 0, 0], tag: 'car' }, car)
		if (!out.effects[0].soft) hard.push(clock.t)
		bonuses += out.bonuses.length
	}
	assert.equal(hard.length, 3, 'pair cap: 3 control-loss effects in 60 s')
	assert.deepEqual(hard.map((t, i) => (i ? t - hard[i - 1] : 0)), [0, 3000, 3000], 'spaced by the 3 s car immunity')
	assert.equal(bonuses, 3, 'no bonus for visual-only hits')
})

test('per target budget: several sources together never take more than 4 s from one soldier per minute', () => {
	const clock = { t: 0 }
	const ref = createReferee({ seed: 1, now: () => clock.t })
	ref.setWorld({ phase: { sk: 'match' } })
	const s = { g: 'sk', k: 'soldier', id: 1, p: [0, 0, 0], n: 's' }
	let lost = 0
	for (let i = 0; i < 60; i++) {
		clock.t += 1000
		for (let pid = 1; pid <= 10; pid++) {
			const out = ref.contact({ g: 'salad', pid, veg: 'onion', p: [0, 0, 0], v: [0, 0, 0], tag: 'soldier' }, s)
			for (const e of out.effects) if (!e.soft) lost += e.dur
		}
	}
	assert.ok(lost <= 4 && lost >= 3, `lost ${lost} s`)
})

test('per source: ≤ 12 bonuses in any 60 s however many targets', () => {
	const clock = { t: 0 }
	const ref = createReferee({ seed: 1, now: () => clock.t })
	ref.setWorld({ phase: { rc: 'race' } })
	let bonuses = 0
	for (let i = 0; i < 40; i++) {
		clock.t += 500
		bonuses += ref.contact({ g: 'salad', pid: 1, veg: 'tomato', p: [0, 0, 0], v: [0, 0, 0], tag: 'car' }, { g: 'rc', k: 'car', id: i, p: [0, 0, 0] }).bonuses.length
	}
	assert.equal(bonuses, 12)
})

test('determinism: the same seed → the same output; another seed → another output', () => {
	for (const seed of [1, 42, 4242]) {
		assert.equal(JSON.stringify(script(seed)), JSON.stringify(script(seed)), `seed ${seed}`)
	}
	assert.notEqual(JSON.stringify(script(5)), JSON.stringify(script(6)))
})
