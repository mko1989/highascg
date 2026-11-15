'use strict'

/**
 * WO-1089 — Stage Salad presenters (modules/stage-salad/server/salad-presenters.js; contract §6): the avatars come
 * from the tracking module's world persons — a real (camera-fused) person with the look of its camera person, the
 * WO-1087 test puppet with its own traits, no one → the clearly labelled stand-in at the stage's middle; the host's
 * `dummy` / `ids` modes; a person lost mid-round stays 3 s (flag lost) and leaves, the stand-in returns; PSN → Godot
 * frame on the stage floor; facing (walking direction, the audience when standing); umbrella and dodge rules.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { shared, server, venue, createClock, dice, snapOf, PUPPET } = require('./lib/salad-fixtures')

const B = shared().body
const { createPresenters, LOST_MS, DODGE } = server('salad-presenters.js')

function make(seed = 1) {
	const clk = createClock()
	const v = venue()
	const events = []
	const P = createPresenters({ now: clk.now, rng: dice(seed), venue: () => v, onEvent: (m) => events.push(m) })
	const run = (ms, snap) => {
		for (let k = 0; k < ms / 100; k++) {
			clk.advance(100)
			if (snap) P.ingest(typeof snap === 'function' ? snap() : snap)
			P.tick()
		}
	}
	return { clk, v, P, events, run }
}

const REAL = { id: 7, x: 10.5, y: -2, height: 1.82, name: 'Presenter 7' }
const CAMS = { cameras: [{ persons: [{ world: 7, traits: { top: [200, 30, 30], bottom: [20, 20, 20], skin: [180, 140, 120], hair: [40, 30, 20], hair_len: 'long' } }] }] }

test('no one tracked → the stand-in (tid 0) at the stage\'s middle, 0.6 m behind the front, facing the audience', () => {
	const { P, v, run } = make()
	run(1000, snapOf([]))
	const list = P.list()
	assert.equal(list.length, 1)
	assert.deepEqual([list[0].tid, list[0].dummy, list[0].name, list[0].look], [0, true, 'Stand-in', null])
	const pose = P.pose(0)
	assert.deepEqual([pose.x, pose.y, pose.z].map((x) => Math.round(x * 1000) / 1000), [10.15, 0.639, 3.5])
	assert.ok(Math.abs(pose.yaw - Math.atan2(v.front.f[0], v.front.f[1])) < 1e-6, 'faces the room')
	assert.equal(P.wire()[0][6] & 4, 4, 'stand-in flag on the wire')
})

test('the puppet and a real person: PSN → Godot (x, stage floor, −y), own traits / camera traits, height clamped', () => {
	const { P, run } = make()
	run(1500, snapOf([{ ...PUPPET, x: 11, y: -3 }, { ...REAL, height: 2.6 }]))
	const pz = P.pose(PUPPET.id)
	assert.deepEqual([pz.x, pz.y, pz.z].map((x) => Math.round(x * 100) / 100), [11, 0.64, 3])
	const list = Object.fromEntries(P.list().map((a) => [a.tid, a]))
	assert.equal(list[0], undefined, 'the stand-in leaves when someone is tracked')
	assert.equal(list[PUPPET.id].puppet, true)
	assert.deepEqual(list[PUPPET.id].look.top, PUPPET.traits.top)
	assert.equal(list[7].height, 2.2, 'clamped to 2.2 m')
	assert.equal(list[7].look, null, 'no traits anywhere → the neutral clay')
	const { P: P2, run: run2 } = make()
	run2(500, { ...snapOf([REAL]), ...CAMS })
	assert.deepEqual(P2.list()[0].look.top, [200, 30, 30], 'a real person takes its camera person\'s look')
	assert.deepEqual(B.lookFrom(P2.list()[0].look).hair_len, 'long')
	assert.equal(B.lookFrom(null).known, false)
	const offStage = make()
	offStage.run(1500, snapOf([{ ...REAL, x: 0, y: -3 }]))
	assert.equal(Math.round(offStage.P.pose(7).y * 1000) / 1000, 0.241, 'off the stage: the hall floor')
})

test('host modes: auto = ≤ 3 nearest the stage centre; ids = those; dummy = the stand-in only', () => {
	const { P, run } = make()
	const crowd = [1, 2, 3, 4, 5].map((id) => ({ id, x: 11, y: -3.5 + (id - 3) * 3 }))
	run(500, snapOf(crowd))
	assert.deepEqual(P.list().map((a) => a.tid), [2, 3, 4], 'the three nearest the middle')
	assert.ok(P.setMode('ids', [5, 1, -2, 'x']))
	run(500, snapOf(crowd))
	assert.deepEqual(P.list().map((a) => a.tid), [1, 5])
	assert.ok(P.setMode('dummy'))
	run(500, snapOf(crowd))
	assert.deepEqual(P.list().map((a) => a.tid), [0])
	assert.equal(P.setMode('everyone'), false)
})

test('lost mid-round: stays 3 s where last seen (lost flag), then leaves; the stand-in returns; back again → avatar again', () => {
	const { P, run, clk } = make()
	P.setRound(true, clk.now())
	run(2000, snapOf([{ ...PUPPET, x: 11, y: -3 }]))
	run(LOST_MS - 300, snapOf([]))
	assert.deepEqual(P.list().map((a) => [a.tid, a.lost]), [[PUPPET.id, true]])
	assert.equal(P.wire()[0][6] & 2, 2, 'lost flag on the wire')
	assert.ok(Math.abs(P.pose(PUPPET.id).z - 3) < 0.01, 'where last seen')
	run(600, snapOf([]))
	assert.deepEqual(P.list().map((a) => a.tid), [0], 'gone; the stand-in is back')
	run(500, snapOf([{ ...PUPPET, x: 11, y: -5 }]))
	assert.deepEqual(P.list().map((a) => [a.tid, a.lost]), [[PUPPET.id, false]])
})

test('facing: the walking direction while walking, the audience after standing 0.8 s', () => {
	const { P, run, v } = make()
	let y = -1
	run(3000, () => snapOf([{ ...PUPPET, x: 11, y: (y -= 0.1) }])) // 1 m/s upstage → Godot +z
	const walk = P.pose(PUPPET.id)
	assert.ok(Math.abs(Math.atan2(Math.sin(walk.yaw), Math.cos(walk.yaw))) < 0.2, `walking +z → yaw ≈ 0 (${walk.yaw})`)
	assert.equal(P.wire()[0][6] & 1, 1, 'walk flag')
	run(3000, snapOf([{ ...PUPPET, x: 11, y }]))
	const aud = Math.atan2(v.front.f[0], v.front.f[1])
	const d = Math.atan2(Math.sin(P.pose(PUPPET.id).yaw - aud), Math.cos(P.pose(PUPPET.id).yaw - aud))
	assert.ok(Math.abs(d) < 0.05, `turned to the audience (${d})`)
})

test('umbrella: only in a round, every 25–40 s for 4 s; always up while presenter-safe', () => {
	const { P, run, clk, events } = make(3)
	run(60000, snapOf([{ ...PUPPET, x: 11, y: -3 }]))
	assert.equal(events.filter((e) => e.t === 'umbrella').length, 0, 'none in the lobby')
	P.setRound(true, clk.now())
	run(120000, snapOf([{ ...PUPPET, x: 11, y: -3 }]))
	const um = events.filter((e) => e.t === 'umbrella')
	assert.ok(um.length >= 3 && um.length <= 5, `${um.length} umbrellas in 2 min`)
	for (const e of um) assert.equal(e.until - e.from, 4000)
	for (let i = 1; i < um.length; i++) assert.ok(um[i].from - um[i - 1].until >= 25000 - 100 && um[i].from - um[i - 1].until <= 40000 + 100)
	P.setSafe(true)
	assert.equal(P.partsAt(clk.now())[0].parts[0].part, 'umbrella')
})

test('dodge: only far enough ahead, ≈ 18 % of predicted hits, ≥ 2.5 s apart, duck for the head, a side step otherwise', () => {
	const { P, run, clk, events } = make(9)
	run(1000, snapOf([{ ...PUPPET, x: 11, y: -3 }]))
	assert.equal(P.planDodge(PUPPET.id, 'body', clk.now() + DODGE.leadMs - 1, [10.8, 1.5, 3]), null, 'too late to react')
	let tries = 0
	let got = 0
	for (let k = 0; k < 400; k++) {
		run(3000, snapOf([{ ...PUPPET, x: 11, y: -3 }]))
		tries++
		const d = P.planDodge(PUPPET.id, k % 2 ? 'head' : 'body', clk.now() + 800, [10.8, 1.5, 3.2])
		if (d) {
			got++
			assert.equal(d.kind, k % 2 ? 'duck' : 'step')
			if (d.kind === 'step') assert.ok(Math.abs(Math.hypot(...d.dx) - B.STEP_DX) < 1e-3)
		}
	}
	assert.ok(got / tries > 0.1 && got / tries < 0.27, `${got}/${tries}`)
	assert.equal(events.filter((e) => e.t === 'dodge').length, got)
	run(1000, snapOf([{ ...PUPPET, x: 11, y: -3 }]))
	let first = null
	for (let k = 0; k < 200 && !first; k++) first = P.planDodge(PUPPET.id, 'body', clk.now() + 800, [10.8, 1.5, 3.2])
	assert.equal(P.planDodge(PUPPET.id, 'body', clk.now() + 800, [10.8, 1.5, 3.2]), null, 'one at a time')
})
