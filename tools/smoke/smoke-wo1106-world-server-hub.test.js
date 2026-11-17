'use strict'

/**
 * WO-1106 — Game World hub fixes (modules/game-world/server/world-hub.js), fake games after the §0.2 room adapter:
 *   A5   a game send that returns a strict `false` (skipped for backpressure) is not committed: the next tick re-sends
 *        the `wst`, the `add` and the `gone`; `undefined` / `true` stay "delivered" (older games)
 *   A8   the 2 Hz `board` carries `house` / `scene` (from the service's provider) and `paused` per game
 *   A16  the `wq` map holds only live viewers (swept each tick, nothing kept while the tick does not run)
 *   A18  the last game detached → every world page gets `{ t: 'off' }` + its close, and the tick stops
 *   A25  an effect the target game's apply() refused sends no event (xev) and pays no bonus
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHub, BOARD_EVERY } = require('../../modules/game-world/server/world-hub')

function fakeTimers() {
	const live = new Map()
	let n = 0
	return { live, setInterval: (fn, ms) => (live.set(++n, { fn, ms }), n), clearInterval: (id) => live.delete(id) }
}
function fakeRoom(id, o = {}) {
	const a = {
		id,
		ents: o.ents || [],
		vs: o.viewers || [],
		phase: o.phase || 'lobby',
		sent: [],
		refuse: 0, // the next n sends return false (skipped for backpressure)
		applied: [],
		bonuses: [],
		applyOk: true,
		entities: () => a.ents,
		viewers: () => a.vs,
		send(key, msg) {
			if (a.refuse > 0) return (a.refuse--, false)
			a.sent.push([key, JSON.parse(JSON.stringify(msg))])
		},
		board: () => ({ phase: a.phase, endsAt: null, top: [], players: a.vs.length, bots: 0 }),
		apply: (e) => (a.applied.push(e), a.applyOk),
		bonus: (pid, kind) => (a.bonuses.push([pid, kind]), true),
		area: () => null,
	}
	return a
}
function setup(opts = {}) {
	const clock = { t: 1_000_000 }
	const timers = fakeTimers()
	const reg = { v: 1, games: new Map(), hub: null }
	for (const [id, models] of [['rc', { car: '/game/rc/car-model.js' }], ['sk', { soldier: '/game/sk/soldier-model.js' }], ['salad', {}]]) {
		reg.games.set(id, { id, title: id.toUpperCase(), order: 1, models, scale: 0.1, room: () => null, host: () => ({ status: 200, body: { ok: true } }), state: () => ({}) })
	}
	const hub = createHub({ now: () => clock.t, timers, registry: reg, seed: 5, defer: (fn) => fn(), ...opts })
	const step = (n = 1) => {
		for (let i = 0; i < n; i++) {
			clock.t += 100
			hub.tick()
		}
	}
	return { hub, clock, timers, reg, step }
}
const car = (id, x, z, o = {}) => ({ k: 'car', id, p: [x, 0, z], yaw: 0, c: '#ff0000', n: `driver-${id}`, f: 0, ...o })
const soldier = (id, x, z, o = {}) => ({ k: 'soldier', id, p: [x, 0, z], yaw: 0, c: '#00ff00', n: `soldier-${id}`, f: 0, s: 'rifle', ...o })
const msgs = (room, key, t) => room.sent.filter(([k, m]) => k === key && (!t || m.t === t)).map(([, m]) => m)

test('A5: a skipped wst is sent again next tick; no wv before it', () => {
	const { hub, step } = setup()
	const rc = fakeRoom('rc', { viewers: [{ key: 'p1', kind: 'player', p: [0, 0, 0] }] })
	const sk = fakeRoom('sk', { ents: [soldier(1, 0.5, 0)] })
	hub.attach(rc)
	hub.attach(sk)
	rc.refuse = 1
	step(1)
	assert.equal(msgs(rc, 'p1').length, 0, 'the wst was skipped and nothing else went out')
	step(1)
	assert.equal(msgs(rc, 'p1', 'wst').length, 1, 'the wst again')
	assert.equal(msgs(rc, 'p1', 'wv')[0].add[0][1], 'soldier')
	hub.dispose()
})

test('A5: a skipped wv is re-sent (its add next tick, its gone next tick); undefined counts as delivered', () => {
	const { hub, step } = setup()
	const rc = fakeRoom('rc', { viewers: [{ key: 'p1', kind: 'player', p: [0, 0, 0] }] })
	const sk = fakeRoom('sk', { ents: [soldier(1, 0.5, 0)] })
	hub.attach(rc)
	hub.attach(sk)
	step(1)
	assert.equal(msgs(rc, 'p1', 'wv').length, 1, 'send() returning undefined = delivered (older games)')
	sk.ents.push(soldier(2, 0.6, 0))
	rc.refuse = 1
	step(1)
	assert.equal(msgs(rc, 'p1', 'wv').length, 1, 'the add of soldier 2 was skipped')
	step(1)
	const wv = msgs(rc, 'p1', 'wv')
	assert.equal(wv.length, 2)
	assert.ok(wv[1].add.some((a) => a[1] === 'soldier'), 'soldier 2 added again (the client never had it)')
	const w2 = wv[1].add[0][0]
	sk.ents = sk.ents.filter((e) => e.id !== 2)
	rc.refuse = 1
	step(1)
	assert.equal(msgs(rc, 'p1', 'wv').length, 2, 'the gone was skipped')
	step(1)
	assert.deepEqual(msgs(rc, 'p1', 'wv').at(-1).gone, [w2], 'the gone again')
	hub.dispose()
})

test('A5: a world page send that returns false re-sends too', () => {
	const { hub, step } = setup()
	const got = []
	let refuse = 0
	hub.openWorld((m) => (refuse > 0 ? (refuse--, false) : void got.push(m)))
	const rc = fakeRoom('rc', { ents: [car(1, 0, 0)] })
	hub.attach(rc)
	step(1)
	assert.equal(got.filter((m) => m.t === 'wv').length, 1)
	rc.ents.push(car(2, 0.2, 0))
	refuse = 1
	step(1)
	step(1)
	const adds = got.filter((m) => m.t === 'wv').flatMap((m) => m.add || [])
	assert.equal(adds.length, 2, 'car 2 reached the page on the retry')
	hub.dispose()
})

test('A16: the wq map keeps only live viewers (5000 sockets that came and went leave nothing)', () => {
	const { hub, step } = setup()
	const rc = fakeRoom('rc', { viewers: [{ key: 'live', kind: 'player', p: [0, 0, 0] }] })
	assert.equal(hub.quality('rc', 'early', 6), false, 'no world tick yet: nothing kept (viewers() cap covers it)')
	hub.attach(rc)
	assert.equal(hub.quality('rc', 'one-room', 6), false, 'one room: no tick, nothing kept')
	hub.attach(fakeRoom('sk', { ents: [soldier(1, 0.5, 0)] }))
	assert.equal(hub.quality('nope', 'x', 6), false, 'a game that is not attached')
	for (let i = 0; i < 5000; i++) hub.quality('rc', { sock: i }, 6)
	hub.quality('rc', 'live', 6)
	assert.equal(hub.stats().wq, 5001)
	step(1)
	assert.equal(hub.stats().wq, 1, 'swept to the live viewer')
	assert.equal(msgs(rc, 'live', 'wv')[0].add[0][4], '', 'and its wq 6 still applies (Low: no tags)')
	hub.detach('sk')
	assert.equal(hub.stats().wq, 0, 'the tick stopped: cleared')
	hub.dispose()
})

test('A25: an effect the target game refused sends no xev and pays no bonus; a taken one does both', () => {
	const { hub, step, clock } = setup()
	const page = []
	hub.openWorld((m) => void page.push(m))
	const rc = fakeRoom('rc', { ents: [car(1, 0, 0)] })
	const salad = fakeRoom('salad')
	hub.attach(rc)
	hub.attach(salad)
	step(1)
	const w = hub.colliders('salad')[0].w
	const hit = () => hub.contact({ g: 'salad', pid: 7, veg: 'tomato', p: [0, 0.03, 0], v: [0, 0, 1], tag: 'car', w })
	rc.applyOk = false
	assert.equal(hit().end, true)
	assert.equal(rc.applied.length, 1, 'the effect was offered to the game')
	assert.equal(page.filter((m) => m.t === 'xev').length, 0, 'refused: no event')
	assert.deepEqual(salad.bonuses, [], 'refused: no bonus')
	clock.t += 5000
	rc.applyOk = true
	hit()
	assert.equal(page.filter((m) => m.t === 'xev' && m.k === 'R1').length, 1, 'taken: the event')
	assert.ok(!('of' in page.find((m) => m.t === 'xev')), 'the link never reaches the wire')
	assert.deepEqual(salad.bonuses, [[7, 'hop']], 'taken: the bonus')
	hub.dispose()
})

test('A8: the board carries house + scene (from setBoardInfo) and paused per game', () => {
	const { hub, step } = setup()
	const page = []
	hub.openWorld((m) => void page.push(m))
	const rc = fakeRoom('rc', { phase: 'race' })
	const sk = fakeRoom('sk', { phase: 'paused' })
	hub.attach(rc)
	hub.attach(sk)
	step(BOARD_EVERY)
	let b = page.filter((m) => m.t === 'board').at(-1)
	assert.equal(b.house, null, 'no provider: house null')
	assert.equal(b.scene, null)
	assert.deepEqual(b.games.map((g) => [g.id, g.phase, g.paused]), [['rc', 'race', false], ['sk', 'paused', true]])
	let info = { house: 0.25, scene: { json: '/api/game/rc/scene', glb: '/api/game/rc/scene.glb?rev=r2' } }
	assert.equal(hub.setBoardInfo(() => info), true)
	step(BOARD_EVERY)
	b = page.filter((m) => m.t === 'board').at(-1)
	assert.equal(b.house, 0.25)
	assert.deepEqual(b.scene, info.scene)
	info = { house: 0 }
	step(BOARD_EVERY)
	b = page.filter((m) => m.t === 'board').at(-1)
	assert.equal(b.house, 0, 'the operator dimmed: the next board says so')
	assert.equal(b.scene, null)
	hub.setBoardInfo(() => {
		throw new Error('boom')
	})
	step(BOARD_EVERY)
	b = page.filter((m) => m.t === 'board').at(-1)
	assert.equal(b.house, null, 'a failing provider still sends the board')
	hub.dispose()
})

test('A18: the last game detached → every world page gets off (its close), the tick stops; one game left keeps them', () => {
	const { hub, timers, reg } = setup()
	const closed = []
	const pages = [[], []]
	pages.forEach((got, i) => hub.openWorld((m) => void got.push(m), () => closed.push(i)))
	const legacy = []
	hub.openWorld((m) => void legacy.push(m)) // a caller without off(): it still hears `off`
	const rc = fakeRoom('rc', { ents: [car(1, 0, 0)] })
	const sk = fakeRoom('sk')
	hub.attach(rc)
	hub.attach(sk)
	hub.detach('sk')
	assert.deepEqual(closed, [], 'rc still runs: the pages stay')
	assert.equal(hub.stats().worldPages, 3)
	hub.detach('rc')
	assert.deepEqual(closed, [0, 1], 'both pages told off and closed')
	assert.deepEqual(legacy.at(-1), { t: 'off' })
	assert.equal(hub.stats().worldPages, 0)
	assert.equal(hub.running(), false, 'the tick stopped')
	assert.equal(timers.live.size, 0)
	// a game still enabled (its room() answers) when the detach lands → synced back, pages stay
	const after = []
	hub.openWorld((m) => void after.push(m), () => after.push('closed'))
	hub.attach(rc)
	reg.games.get('rc').room = () => rc
	hub.detach('rc')
	assert.ok(!after.includes('closed'), 'rc re-attached by the sync: no off')
	assert.equal(hub.adapters().has('rc'), true)
	hub.dispose()
})
