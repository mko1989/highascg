'use strict'

/**
 * WO-1089 — Stage Salad room (modules/stage-salad/server/salad-room.js, salad-shots.js, salad-sanitize.js; contract
 * §8, §9): lobby → countdown 3 s → round → results 12 s → lobby on the manual clock; scores reset at a start and
 * count only in a round; streaks; team mode (slots by side, team totals, team winner); 20 players with bots giving way
 * to guests; spectators; the referee's anti-cheat (n, reload, rate, yaw / pitch / power ranges, phase, presenter-safe,
 * malformed input); housekeeping of silent sockets; host validation; dispose leaves no timer.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { shared, server, makeRoom, snapOf, PUPPET } = require('./lib/salad-fixtures')

const S = shared()
const DEG = Math.PI / 180
const { parseMessage, cleanFire, cleanAim } = server('salad-sanitize.js')
const { LIMITS } = server('salad-shots.js')

test('phases: lobby → countdown → round → results → lobby; scores reset at a start; results order + winner', () => {
	const R = makeRoom()
	const a = R.join('Ann')
	const b = R.join('Bob')
	assert.equal(R.room.snapshot().phase, 'lobby')
	assert.equal(R.room.host('round', { secs: 30 }).ok, true)
	assert.equal(R.room.host('round', { secs: 29 }).status, 400)
	assert.equal(R.room.host('start').ok, true)
	assert.equal(R.room.snapshot().phase, 'countdown')
	assert.equal(R.of(a, 'countdown').length, 1)
	assert.equal(R.room.host('start').status, 409, 'no second start')
	assert.equal(R.room.host('teams', { on: true }).status, 409, 'no team switch mid-round')
	R.clk.advance(3000)
	assert.equal(R.room.snapshot().phase, 'round')
	R.room.ctx.players.get(R.of(b, 'welcome')[0].id).score = 77 // as if scored
	R.clk.advance(30000)
	const st = R.room.snapshot()
	assert.equal(st.phase, 'results')
	const res = R.of(a, 'results')[0]
	assert.equal(res.order[0].name, 'Bob')
	assert.deepEqual(res.winner, { id: R.of(b, 'welcome')[0].id })
	R.clk.advance(12000)
	assert.equal(R.room.snapshot().phase, 'lobby')
	R.room.host('start')
	assert.equal(R.room.snapshot().players.find((p) => p.name === 'Bob').score, 0, 'reset at the start')
	assert.equal(R.room.host('stop').ok, true)
	assert.equal(R.room.snapshot().phase, 'lobby')
	R.room.dispose()
	a.stop(), b.stop() // the guests' own pingers
	assert.deepEqual(R.room.timers(), { phase: false, house: false, tick: false })
	assert.equal(R.clk.pending(), 0, 'dispose leaves no timer')
})

test('sanitize: only known types, finite numbers, known vegetables; aim power clamped, fire never clamped', () => {
	assert.equal(parseMessage('{"t":"hit"}'), null)
	assert.equal(parseMessage('[1]'), null)
	assert.equal(parseMessage(Buffer.from('{"t":"fire"}'), true), null, 'no binary')
	assert.equal(parseMessage('x'.repeat(5000)), null, 'size cap')
	assert.deepEqual(parseMessage('{"t":"ping","c":1}'), { t: 'ping', c: 1 })
	assert.equal(cleanFire({ n: 1, veg: 'pumpkin', a: [0, 0.3], p: 0.5 }), null)
	assert.equal(cleanFire({ n: 1.5, veg: 'tomato', a: [0, 0.3], p: 0.5 }), null)
	assert.equal(cleanFire({ n: 1, veg: 'tomato', a: [0, NaN], p: 0.5 }), null)
	assert.equal(cleanFire({ n: 1, veg: 'tomato', a: [0, 0.3], p: '0.5' }), null)
	assert.equal(cleanFire({ n: 1, veg: 'tomato', a: [0, 0.3], p: 7 }).p, 7, 'range checks are the referee\'s, not clamped')
	assert.deepEqual(cleanAim({ a: [0.1, 0.2], p: 3 }), { a: [0.1, 0.2], p: 1 })
})

test('anti-cheat: n, reload, rate, yaw / pitch / power ranges, phase, presenter-safe — refused, never clamped', () => {
	const R = makeRoom()
	R.room.ingestTracking(snapOf([{ ...PUPPET, x: 11, y: -3 }]))
	const c = R.join('Eve')
	const p = R.room.ctx.players.get(R.of(c, 'welcome')[0].id)
	const yaw = R.room.ctx.venue().slots[p.slot].yaw
	const fire = (m, t) => R.room.shots.fire(p, { veg: 'tomato', a: [yaw, 20 * DEG], p: 0.6, ...m }, t)
	assert.equal(fire({ n: 1 }).ok, true)
	assert.equal(fire({ n: 1 }).why, 'n', 'n must grow')
	assert.equal(fire({ n: 2 }).why, 'reload', 'tomato reload 0.8 s')
	R.clk.advance(800 - LIMITS.slackMs)
	assert.equal(fire({ n: 2 }).ok, true, 'reload with 60 ms slack')
	R.clk.advance(800)
	assert.equal(fire({ n: 3, a: [yaw + 56 * DEG, 0.3] }).why, 'yaw')
	assert.equal(fire({ n: 4, a: [yaw, 71 * DEG] }).why, 'pitch')
	assert.equal(fire({ n: 5, a: [yaw, -11 * DEG] }).why, 'pitch')
	assert.equal(fire({ n: 6, p: 0.1 }).why, 'power')
	assert.equal(fire({ n: 7, p: 1.01 }).why, 'power')
	assert.equal(fire({ n: 8, veg: 'melon' }).why, 'veg')
	// rate: three fires in a second at most, even with reloads ignored by a cheat (forged readyAt)
	R.clk.advance(2000)
	for (let k = 0; k < 3; k++) (p.readyAt = 0), assert.equal(fire({ n: 10 + k }).ok, true)
	p.readyAt = 0
	assert.equal(fire({ n: 20 }).why, 'rate')
	R.clk.advance(2000)
	R.room.host('safe', { on: true })
	assert.equal(fire({ n: 30 }).why, 'safe', 'presenter safe: nothing flies')
	R.room.host('safe', { on: false })
	R.room.host('start')
	assert.equal(fire({ n: 31 }).why, 'phase', 'not during the countdown')
	R.clk.advance(3000)
	assert.equal(fire({ n: 32 }).ok, true)
	// the wire path: a malformed fire is dropped before the referee
	R.clk.advance(1000)
	const shots = R.of(c, 'shot').length
	R.room.handle(c, { t: 'fire', n: 40, veg: 'tomato', a: [yaw], p: 0.5 })
	R.room.handle(c, { t: 'fire', n: 41, veg: 'tomato', a: [yaw, 0.3], p: 0.5, o: [11, 1.5, 3] }) // an origin is ignored
	const last = R.of(c, 'shot').slice(shots)
	assert.equal(last.length, 1)
	assert.deepEqual(last[0].o, S.venue.pouch(R.room.ctx.venue().slots[p.slot]).map((v) => Math.round(v * 1000) / 1000))
	R.room.dispose()
})

test('streaks: consecutive scored hits grow the streak, a miss resets it; lobby shots score nothing', () => {
	const R = makeRoom({ seed: 5 })
	R.room.ingestTracking(snapOf([{ ...PUPPET, x: 11, y: -3 }]))
	R.clk.advance(2000)
	const c = R.join('Sam')
	const p = R.room.ctx.players.get(R.of(c, 'welcome')[0].id)
	const v = R.room.ctx.venue()
	const o = S.venue.pouch(v.slots[p.slot])
	const at = (dy, dz = 0) => {
		const ps = R.room.presenters.pose(PUPPET.id, R.clk.now())
		return S.aim.solveAim(S.veggies.VEGGIES.carrot, o, [ps.x, ps.y + dy, ps.z + dz])
	}
	let n = 0
	const shoot = (sol) => {
		R.room.handle(c, { t: 'fire', n: ++n, veg: 'carrot', a: [sol.yaw, sol.pitch], p: sol.power })
		R.clk.advance(3500)
	}
	shoot(at(0.75))
	assert.equal(p.score, 0, 'lobby: practice')
	assert.equal(R.of(c, 'end').at(-1).k, 'hit')
	R.room.host('start')
	R.clk.advance(3000)
	const streaks = []
	for (const s of [at(0.75), at(0.75), at(0.75), at(0.75, 3), at(0.75)]) {
		shoot(s)
		streaks.push(p.streak)
	}
	const dodged = R.of(c, 'dodge').length
	if (!dodged) assert.deepEqual(streaks, [1, 2, 3, 0, 1])
	assert.ok(p.score > 0 && p.hits >= 3 && p.shots === 5, JSON.stringify({ score: p.score, hits: p.hits, shots: p.shots, dodged }))
	assert.equal(p.best, Math.max(...streaks))
	R.room.dispose()
})

test('teams: slots on their side, balanced joins, team totals and a team winner', () => {
	const R = makeRoom()
	R.room.host('teams', { on: true })
	const cs = ['A', 'B', 'C', 'D', 'E'].map((n) => R.join(n))
	const st = R.room.snapshot()
	const v = R.room.ctx.venue()
	for (const pl of st.players) assert.equal(v.slots[pl.slot].team, pl.team, `${pl.name} sits on its team's side`)
	const n0 = st.players.filter((pl) => pl.team === 0).length
	assert.ok(Math.abs(n0 - (5 - n0)) <= 1, 'balanced')
	R.room.host('start')
	R.clk.advance(3000)
	for (const pl of R.room.ctx.players.values()) pl.score = pl.team === 1 ? 50 : 10
	R.room.host('stop')
	R.room.host('start')
	R.clk.advance(3000)
	for (const pl of R.room.ctx.players.values()) pl.score = pl.team === 1 ? 50 : 10
	R.clk.advance(90000)
	const res = R.of(cs[0], 'results')[0]
	assert.deepEqual(res.teams, [10 * n0, 50 * (5 - n0)])
	assert.deepEqual(res.winner, { team: 1 })
	R.room.dispose()
})

test('capacity: 20 players, a guest takes a bot\'s place, spectators apart, a full room says full', () => {
	const R = makeRoom()
	R.room.host('bots', { n: 8 })
	const humans = Array.from({ length: 12 }, (_, i) => R.join(`H${i}`))
	assert.equal(R.room.snapshot().players.length, 20)
	const late = R.join('Late')
	assert.equal(R.of(late, 'welcome').length, 1, 'a bot made room')
	assert.equal(R.room.snapshot().players.filter((p) => p.bot).length, 7)
	assert.equal(R.room.snapshot().bots, 8, 'the host\'s wish is kept')
	const slots = R.room.snapshot().players.map((p) => p.slot)
	assert.equal(new Set(slots).size, 20, 'every player its own sling')
	for (let k = 0; k < 7; k++) R.join(`X${k}`)
	assert.equal(R.room.snapshot().players.filter((p) => p.bot).length, 0)
	const full = R.join('TooMany')
	assert.deepEqual(R.of(full, 'full'), [{ t: 'full' }])
	const spec = R.join('Watcher', { spectator: true })
	assert.equal(R.of(spec, 'welcome')[0].you.spectator, true)
	assert.equal(R.room.snapshot().spectators, 1)
	R.room.disconnect(humans[0])
	assert.equal(R.room.snapshot().players.filter((p) => p.bot).length, 1, 'a bot comes back when a guest leaves')
	R.room.dispose()
})

test('housekeeping: silent players and never-joined sockets are closed; host input is validated', () => {
	const R = makeRoom()
	const quiet = R.join('Quiet', {}, { silent: true })
	const chatty = R.join('Chatty', {}, { silent: true })
	const lurk = { name: 'lurk' }
	R.room.connect(lurk)
	for (let k = 0; k < 16; k++) (R.clk.advance(1000), R.room.handle(chatty, { t: 'ping', c: k }))
	assert.equal(quiet.closed, 4408)
	assert.equal(lurk.closed, 4408)
	assert.equal(chatty.closed, undefined)
	assert.equal(R.room.snapshot().players.length, 1)
	for (const [a, b] of [['bots', { n: 9 }], ['bots', { n: -1 }], ['botlevel', { level: 'god' }], ['teams', { on: 'yes' }], ['target', { mode: 'all' }],
		['target', { mode: 'ids', ids: [] }], ['safe', {}], ['kick', { id: 999 }], ['explode', {}]])
		assert.ok(!R.room.host(a, b).ok, `${a} ${JSON.stringify(b)} refused`)
	assert.equal(R.room.host('kick', { id: R.of(chatty, 'welcome')[0].id }).ok, true)
	assert.equal(chatty.closed, 4409)
	R.room.dispose()
})
