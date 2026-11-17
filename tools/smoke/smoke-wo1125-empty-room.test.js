'use strict'

/**
 * WO-1125 — the empty-room rule of self-service (modules/rc-game/server/rc-empty-room.js, wired in rc-ctl.js for all three
 * games): while `self` is on, a round with no connected human player for 20 s goes back to the lobby through the
 * operator's own `stop`, and after 60 s with nobody the bots return to the operator's default (the last bot setting from a
 * host action — Settings ▸ Games default on open, a host page — else 0). Spectators and disconnected players are not
 * humans; a paused game is left alone; self-service off = no timer, nothing happens. Pure unit on a fake room view + the
 * three REAL game services on a manual clock.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { createClock } = require('./lib/salad-fixtures')
const ER = require('../../modules/rc-game/server/rc-empty-room')
const { createRcGame } = require('../../modules/rc-game/server/rc-game')
const { createSkGame } = require('../../modules/toy-skirmish/server/sk-game')
const { createSaladGame } = require('../../modules/stage-salad/server/salad-game')

const { createEmptyRoom, createBotDefault, humansIn, EMPTY_STOP_MS, EMPTY_BOTS_MS } = ER

/* ---------- pure unit ---------- */

function rig({ self = true } = {}) {
	const c = createClock()
	const logs = []
	const sent = []
	const view = { phase: 'race', paused: false, players: new Map() }
	const st = { self }
	const dflt = createBotDefault()
	const e = createEmptyRoom({ game: 'g', now: c.now, timers: c.timers, log: (lv, m) => logs.push([lv, m]), world: () => view, self: () => st.self,
		run: (bodies) => {
			sent.push(...bodies)
			for (const b of bodies) dflt.note(b.action, b, true)
			return true
		},
		bots: (n, level) => [{ action: 'bots', n }, ...(level ? [{ action: 'botlevel', level }] : [])], dflt })
	return { c, logs, sent, view, st, dflt, e }
}

test('constants: 20 s to the lobby, 60 s to the default bots', () => {
	assert.equal(EMPTY_STOP_MS, 20000)
	assert.equal(EMPTY_BOTS_MS, 60000)
})

test('humans: seated, not a bot, not disconnected; spectators are no players at all', () => {
	const players = new Map([[1, { bot: true }], [2, { connected: false }], [3, { connected: true }], [4, {}]])
	assert.equal(humansIn({ players }), 2)
	assert.equal(humansIn({ players: new Map([[1, { bot: true }]]), conns: [{ spectator: true, joined: true }] }), 0)
	assert.equal(humansIn(null), 0)
})

test('a running round with nobody: nothing at 19 s, the operator stop at 20 s (once), one info line', () => {
	const r = rig()
	r.e.setOn(true)
	assert.equal(r.e.running(), true)
	r.c.advance(19000)
	assert.deepEqual(r.sent, [])
	r.c.advance(1000)
	assert.deepEqual(r.sent, [{ action: 'stop' }])
	assert.match(r.logs.at(-1)[1], /^\[g\] nobody connected for 20 s: back to the lobby$/)
	assert.equal(r.logs.at(-1)[0], 'info')
	r.c.advance(10000)
	assert.deepEqual(r.sent, [{ action: 'stop' }], 'once per empty stretch')
})

test('results with nobody: back to the lobby after 20 s too (the players\' "Back to lobby")', () => {
	const r = rig()
	r.view.phase = 'results'
	r.e.setOn(true)
	r.c.advance(20000)
	assert.deepEqual(r.sent, [{ action: 'stop' }])
})

test('a connected human holds it; the 20 s count from the moment the last one left; a disconnected seat does not count', () => {
	const r = rig()
	r.view.players.set(1, { name: 'Ana', connected: true })
	r.e.setOn(true)
	r.c.advance(120000)
	assert.deepEqual(r.sent, [])
	r.view.players.get(1).connected = false // gone (resume seat kept)
	r.c.advance(19000)
	assert.deepEqual(r.sent, [])
	r.c.advance(1000)
	assert.deepEqual(r.sent, [{ action: 'stop' }])
})

test('bots: after 60 s with nobody (in the lobby) back to the operator default, only when different, once', () => {
	const r = rig()
	r.dflt.note('enable', { action: 'enable' })
	r.dflt.note('bots', { action: 'bots', n: 1 }) // the operator's default (Settings ▸ Games on open)
	r.dflt.note('bots', { action: 'bots', n: 4 }, true) // a player's ctl
	r.dflt.note('botlevel', { action: 'botlevel', level: 'hard' }, true)
	r.e.setOn(true)
	r.c.advance(20000)
	assert.deepEqual(r.sent, [{ action: 'stop' }])
	r.view.phase = 'lobby'
	r.c.advance(39000)
	assert.equal(r.sent.length, 1, 'not before 60 s')
	r.c.advance(1000)
	assert.deepEqual(r.sent.slice(1), [{ action: 'bots', n: 1 }])
	assert.match(r.logs.at(-1)[1], /^\[g\] nobody connected for 60 s: bots back to 1$/)
	r.c.advance(120000)
	assert.equal(r.sent.length, 2, 'once')
	assert.equal(r.dflt.same(), true)
})

test('bots: already at the default → nothing sent; no operator default → 0; a level the operator set comes back too', () => {
	const a = rig()
	a.view.phase = 'lobby'
	a.e.setOn(true)
	a.c.advance(70000)
	assert.deepEqual(a.sent, [], 'nobody changed the bots')
	const b = rig()
	b.view.phase = 'lobby'
	b.dflt.note('bots', { action: 'bots', count: 3, level: 'hard' }, true) // RC body shape, from a player
	b.e.setOn(true)
	b.c.advance(60000)
	assert.deepEqual(b.sent, [{ action: 'bots', n: 0 }])
	const c = rig()
	c.view.phase = 'lobby'
	c.dflt.note('bots', { action: 'bots', count: 2, level: 'easy' }) // RC operator
	c.dflt.note('bots', { action: 'bots', count: 5, level: 'hard' }, true)
	c.e.setOn(true)
	c.c.advance(60000)
	assert.deepEqual(c.sent, [{ action: 'bots', n: 2 }, { action: 'botlevel', level: 'easy' }])
})

test('paused / presenter safe: left alone; self-service off: no timer and tick does nothing', () => {
	const r = rig()
	r.view.paused = true
	r.e.setOn(true)
	r.c.advance(90000)
	assert.deepEqual(r.sent, [])
	const s = rig()
	s.view.safe = true
	s.e.setOn(true)
	s.c.advance(90000)
	assert.deepEqual(s.sent, [])
	const o = rig({ self: false })
	assert.equal(o.e.running(), false)
	assert.equal(o.c.pending(), 0)
	o.c.advance(90000)
	assert.equal(o.e.tick(), null)
	assert.deepEqual(o.sent, [])
	const p = rig()
	p.e.setOn(true)
	p.e.setOn(false)
	assert.equal(p.e.running(), false)
	assert.equal(p.c.pending(), 0, 'the interval is cleared')
})

/* ---------- the three real game services ---------- */

const TRACKS = [{ id: 'stage-oval', name: 'Stage oval', length: 40, checkpoints: [0, 15, 30, 45], points: [] }]
const SK_BAKE = { scale: 0.1, floors: [{ id: 'hall', y: 0, rect: [-3, -3, 3, 3] }], occ: [], bounds: { min: [-3, 0, -3], max: [3, 2, 3] } }
const SALAD_BAKE = { floors: [{ id: 'hall', y: 0.241, rect: [-15.254, -27.734, 15.016, 34.491] }, { id: 'stage', y: 0.639, rect: [9.55, -4, 12.55, 11] }],
	bounds: { min: [-15.3, 0, -27.8], max: [15.1, 5.99, 34.5] } }
const baker = (json) => ({ rev: () => 'r1', get: () => Promise.resolve({ rev: 'r1', json, text: JSON.stringify(json) }), drop() {} })
const flush = () => new Promise((r) => setTimeout(r, 0))

function sock() {
	const ws = new EventEmitter()
	Object.assign(ws, { readyState: 1, bufferedAmount: 0, got: [], code: null })
	ws.send = (s) => ws.got.push(JSON.parse(s))
	ws.close = (code) => ((ws.code = code), (ws.readyState = 3))
	ws.say = (m) => ws.emit('message', Buffer.from(JSON.stringify(m)), false)
	ws.ctl = (m) => (ws.say({ t: 'ctl', ...m }), ws.got.filter((x) => x.t === 'ctl').at(-1))
	ws.leave = () => ((ws.readyState = 3), ws.emit('close'))
	return ws
}

const GAMES = {
	rc: { make: (c, log) => createRcGame({ baker: baker({ tracks: TRACKS, bounds: null }), lanIps: () => [], loadBots: () => new Promise(() => {}), now: c.now, timers: c.timers, log }),
		attach: (g, ws) => g.attach(ws, { socket: { remoteAddress: '127.0.0.1' } }), prefix: 'rc-game', bots: (n) => ({ action: 'bots', count: n }) },
	sk: { make: (c, log) => createSkGame({ baker: baker(SK_BAKE), lanIps: () => [], now: c.now, timers: c.timers, log, rng: () => 0.5 }),
		attach: (g, ws) => g.attach(ws, null), prefix: 'toy-skirmish', bots: (n) => ({ action: 'bots', n }) },
	salad: { make: (c, log) => createSaladGame({ baker: baker(SALAD_BAKE), lanIps: () => [], readTracking: async () => null, now: c.now, timers: c.timers, log, rng: () => 0.5 }),
		attach: (g, ws) => g.attach(ws, null), prefix: 'stage-salad', bots: (n) => ({ action: 'bots', n }) },
}

async function setup(t, id, { self = true, dfltBots = null } = {}) {
	const c = createClock()
	const logs = []
	const G = GAMES[id]
	const g = G.make(c, (level, msg) => logs.push([level, msg]))
	t.after(() => {
		g.host({ action: 'self', on: false })
		g.disable()
	})
	g.host({ action: 'enable' })
	if (dfltBots != null) assert.equal(g.host(G.bots(dfltBots)).status, 200, 'the operator default (as the core applies it on open)')
	await g.scene()
	await flush()
	if (self) g.host({ action: 'self', on: true })
	const all = []
	const join = (m) => {
		const ws = sock()
		G.attach(g, ws)
		ws.say({ t: 'join', ...m })
		all.push(ws)
		return ws
	}
	/** Advance in 1 s steps; every open socket pings (the rooms drop a silent socket after 10 s). */
	const wait = (ms) => {
		for (let k = 0; k < ms; k += 1000) {
			for (const ws of all) if (ws.readyState === 1) ws.say({ t: 'ping', c: 1 })
			c.advance(Math.min(1000, ms - k))
		}
	}
	const lines = (re) => logs.filter(([lv, m]) => lv === 'info' && re.test(m)).length
	return { g, c, logs, join, wait, lines, G }
}

for (const id of ['sk', 'salad']) {
	test(`${id}: a bot round left by its only player → lobby after 20 s (spectator watching), bots back to the default after 60 s`, async (t) => {
		const s = await setup(t, id, { dfltBots: 1 })
		const ana = s.join({ name: 'Ana', color: '#ff0000' })
		const eve = s.join({ name: 'Eve', spectator: true })
		assert.equal(ana.ctl({ a: 'bots', n: 3, level: 'hard' }).ok, true)
		s.wait(2100)
		assert.equal(ana.ctl({ a: 'start' }).ok, true)
		s.wait(6000)
		assert.notEqual(s.g.state().phase, 'lobby', 'the round runs')
		ana.leave()
		s.wait(18000)
		assert.ok(!['lobby', 'results'].includes(s.g.state().phase), `still running at 18 s (${s.g.state().phase})`)
		s.wait(3000)
		assert.equal(s.g.state().phase, 'lobby', 'back to the lobby by the operator stop')
		assert.equal(s.lines(new RegExp(`^\\[${s.G.prefix}\\] nobody connected for 2\\d s: back to the lobby$`)), 1)
		assert.equal(s.g.state().bots, 3)
		s.wait(40000)
		assert.equal(s.g.state().bots, 1, 'the operator default, not 0')
		assert.equal(s.lines(new RegExp(`^\\[${s.G.prefix}\\] nobody connected for 6\\d s: bots back to 1$`)), 1)
		assert.equal(eve.code, null, 'the spectator stays connected (and did not count as a human)')
		s.wait(120000)
		assert.equal(s.g.state().phase, 'lobby', 'nothing started by itself')
	})

	test(`${id}: a connected player keeps the round; self-service off = the round runs on and the bots stay`, async (t) => {
		const s = await setup(t, id)
		const ana = s.join({ name: 'Ana', color: '#ff0000' })
		s.join({ name: 'Bo', color: '#00ff00' })
		assert.equal(ana.ctl({ a: 'bots', n: 2 }).ok, true)
		s.wait(2100)
		assert.equal(ana.ctl({ a: 'start' }).ok, true)
		ana.leave()
		s.wait(25000)
		assert.ok(!['lobby', 'results'].includes(s.g.state().phase), 'Bo is still there')
		const o = await setup(t, id, { self: false })
		const cara = o.join({ name: 'Cara', color: '#0000ff' })
		assert.equal(o.g.host(o.G.bots(2)).status, 200)
		assert.equal(o.g.host({ action: 'start' }).status, 200)
		o.wait(6000)
		cara.leave()
		o.wait(24000)
		assert.ok(!['lobby'].includes(o.g.state().phase), 'self off: no empty-room stop')
		o.wait(120000)
		assert.equal(o.g.state().bots, 2, 'self off: the bots stay')
		assert.equal(o.lines(/nobody connected/), 0)
	})
}

test('rc: a race whose only player left ends in the results (WO-1106 B39); nobody there for 20 s → the lobby', async (t) => {
	const s = await setup(t, 'rc')
	const ana = s.join({ name: 'Ana', color: '#ff0000' })
	assert.equal(ana.ctl({ a: 'start' }).ok, true)
	s.wait(4000)
	ana.leave()
	assert.equal(s.g.state().phase, 'results')
	s.wait(18000)
	assert.equal(s.g.state().phase, 'results')
	s.wait(3000)
	assert.equal(s.g.state().phase, 'lobby', 'the next visitor finds a lobby')
	assert.equal(s.lines(/^\[rc-game\] nobody connected for 2\d s: back to the lobby$/), 1)
})

test('rc: bots a player set return to 0 a minute after the last player left (no operator default)', async (t) => {
	const s = await setup(t, 'rc')
	const ana = s.join({ name: 'Ana', color: '#ff0000' })
	assert.equal(ana.ctl({ a: 'bots', n: 3, level: 'normal' }).ok, true)
	ana.leave()
	s.wait(59000)
	assert.equal(s.lines(/bots back/), 0)
	s.wait(2000)
	assert.equal(s.lines(/^\[rc-game\] nobody connected for 6\d s: bots back to 0$/), 1)
	assert.equal(s.g.state().phase, 'lobby')
})

test('wiring: rc-ctl requires the rule and feeds it every host action; the three services pass the body + timers', () => {
	const fs = require('node:fs')
	const path = require('node:path')
	const M = path.join(__dirname, '..', '..', 'modules')
	const ctl = fs.readFileSync(path.join(M, 'rc-game', 'server', 'rc-ctl.js'), 'utf8')
	assert.match(ctl, /require\('\.\/rc-empty-room'\)/)
	assert.match(ctl, /botDefault\.note\(action, a, own\)/)
	assert.match(ctl, /empty\.setOn\(self\)/)
	for (const f of ['rc-game/server/rc-game.js', 'toy-skirmish/server/sk-game.js', 'stage-salad/server/salad-game.js']) {
		const src = fs.readFileSync(path.join(M, f), 'utf8')
		assert.match(src, /ctl\.note\(action, a\)/, f)
		assert.match(src, /createGameCtl\(\{ game: '[a-z-]+', log, now, timers: deps\.timers,/, f)
	}
	for (const f of ['rc-game/server/rc-room.js', 'toy-skirmish/server/sk-room.js', 'stage-salad/server/salad-room.js'])
		assert.ok(fs.readFileSync(path.join(M, f), 'utf8').split('\n').length <= 500, f)
})
