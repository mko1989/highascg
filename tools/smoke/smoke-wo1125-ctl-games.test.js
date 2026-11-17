'use strict'

/**
 * WO-1125 — players run the sessions of the THREE REAL game services (rc-game.js, sk-game.js, salad-game.js) over fake
 * sockets on a manual clock (work/notes/game-self-service-contract.md §2–§3): `ctl` passes each game's message parser,
 * `self` is a host action (default off: a module alone is unchanged) pushed to every socket in `state.self`; the state
 * carries what the session panel draws (RC `tracks`, Skirmish `arenas` as { id, title }, `botMax` everywhere); allowed
 * ctl run the game's own host() (the state shows it), the per-game whitelist refuses everything else (Salad: no target /
 * safe / house / lights / wall / kick / pause); a running round refuses (`running`), a paused / safe game refuses
 * (`paused`), spectators refuse (`seat`); `stop` returns from the results to the lobby; every accepted ctl is one info
 * line; the descriptor's `held()` follows the operator's disable / enable; the Game World fans `self` out to every game.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const ROOT = path.join(__dirname, '..', '..')
const { createClock } = require('./lib/salad-fixtures')
const { createRcGame } = require('../../modules/rc-game/server/rc-game')
const { createSkGame } = require('../../modules/toy-skirmish/server/sk-game')
const { createSaladGame } = require('../../modules/stage-salad/server/salad-game')
const { createHub } = require('../../modules/game-world/server/world-hub')
const { createWorldService } = require('../../modules/game-world/server/world-service')

const TRACKS = [{ id: 'stage-oval', name: 'Stage oval', length: 40, checkpoints: [0, 15, 30, 45], points: [] }, { id: 'hall-loop', name: 'Hall loop', length: 80, checkpoints: [0, 40], points: [], laps: 4 }]
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
	ws.state = () => ws.got.filter((x) => x.t === 'state' || x.t === 'welcome').at(-1)?.state
	return ws
}

const GAMES = {
	rc: { make: (c, log) => createRcGame({ baker: baker({ tracks: TRACKS, bounds: null }), lanIps: () => [], loadBots: () => new Promise(() => {}), now: c.now, timers: c.timers, log }),
		attach: (g, ws) => g.attach(ws, { socket: { remoteAddress: '127.0.0.1' } }), prefix: 'rc-game', pause: { action: 'pause', on: true }, unpause: { action: 'pause', on: false } },
	sk: { make: (c, log) => createSkGame({ baker: baker(SK_BAKE), lanIps: () => [], now: c.now, timers: c.timers, log, rng: () => 0.5 }),
		attach: (g, ws) => g.attach(ws, null), prefix: 'toy-skirmish', pause: { action: 'pause', on: true }, unpause: { action: 'pause', on: false } },
	salad: { make: (c, log) => createSaladGame({ baker: baker(SALAD_BAKE), lanIps: () => [], readTracking: async () => null, now: c.now, timers: c.timers, log, rng: () => 0.5 }),
		attach: (g, ws) => g.attach(ws, null), prefix: 'stage-salad', pause: { action: 'safe', on: true }, unpause: { action: 'safe', on: false } },
}

/** One game, enabled, scene in, two players (Ana, Bo) + one spectator joined. */
async function setup(t, id) {
	const c = createClock()
	const logs = []
	const G = GAMES[id]
	const g = G.make(c, (level, msg) => logs.push([level, msg]))
	t.after(() => g.disable())
	g.host({ action: 'enable' })
	await g.scene()
	await flush()
	const join = (m) => {
		const ws = sock()
		G.attach(g, ws)
		ws.say({ t: 'join', ...m })
		return ws
	}
	const ana = join({ name: 'Ana', color: '#ff0000' })
	const bo = join({ name: 'Bo', color: '#00ff00' })
	const spec = join({ name: 'Eve', spectator: true })
	const all = [ana, bo, spec]
	/** Advance the clock in 1 s steps; every socket pings (the rooms drop a silent socket after 10 s). */
	const wait = (ms) => {
		for (let k = 0; k < ms; k += 1000) {
			for (const ws of all) if (ws.readyState === 1) ws.say({ t: 'ping', c: 1 })
			c.advance(Math.min(1000, ms - k))
		}
	}
	const slow = () => wait(2100) // the ctl rate window
	return { g, c, logs, ana, bo, spec, all, wait, slow, G }
}

for (const id of Object.keys(GAMES)) {
	test(`${id}: self off by default (host refusal), the host action pushes state.self to every socket; panel fields in the state`, async (t) => {
		const s = await setup(t, id)
		assert.equal(s.g.state().self, false)
		assert.deepEqual(s.ana.ctl({ a: 'start' }), { t: 'ctl', ok: false, a: 'start', error: 'host' })
		assert.equal(s.g.state().phase, 'lobby')
		assert.equal(s.g.host({ action: 'self', on: 1 }).status, 400)
		const r = s.g.host({ action: 'self', on: true })
		assert.equal(r.status, 200)
		assert.equal(r.body.state.self, true)
		for (const ws of s.all) assert.equal(ws.state().self, true, 'pushed to every joined socket')
		const st = s.g.state()
		assert.ok(Number.isInteger(st.botMax) && st.botMax > 0)
		assert.ok(['easy', 'normal', 'hard'].includes(st.botLevel))
		if (id === 'rc') assert.deepEqual(st.tracks, [{ id: 'stage-oval', title: 'Stage oval' }, { id: 'hall-loop', title: 'Hall loop' }])
		if (id === 'sk') assert.deepEqual(st.arenas, [{ id: 'tables', title: 'Under the Tables' }])
		assert.equal(s.ana.code, null, 'never a close')
		s.g.host({ action: 'disable' })
		assert.equal(s.g.host({ action: 'self', on: false }).status, 200, 'accepted with the session closed (the core sends it on every module)')
	})

	test(`${id}: spectator → seat; whitelist; allowed choices reach the game's own host path; one info line each`, async (t) => {
		const s = await setup(t, id)
		s.g.host({ action: 'self', on: true })
		assert.equal(s.spec.ctl({ a: 'start' }).error, 'seat')
		const ok = (m) => (s.slow(), assert.deepEqual(s.ana.ctl(m), { t: 'ctl', ok: true, a: m.a }, JSON.stringify(m)))
		const bad = (m) => (s.slow(), assert.equal(s.ana.ctl(m).error, 'bad', JSON.stringify(m)))
		if (id === 'rc') {
			ok({ a: 'set', k: 'track', v: 'hall-loop' })
			assert.equal(s.g.state().trackId, 'hall-loop')
			assert.equal(s.g.state().laps, 4, "the track's own lap count (the host path's rule)")
			ok({ a: 'set', k: 'laps', v: 7 })
			assert.equal(s.ana.state().laps, 7, 'everyone gets the normal state push')
			bad({ a: 'set', k: 'track', v: 'nope' })
			bad({ a: 'set', k: 'laps', v: 21 })
			bad({ a: 'set', k: 'kick', v: 2 })
			bad({ a: 'bots', n: 99 })
			ok({ a: 'bots', n: 3, level: 'hard' })
			assert.equal(s.g.state().botLevel, 'hard')
			assert.equal(s.bo.state().botLevel, 'hard', 'pushed although no bot joined yet')
		}
		if (id === 'sk') {
			ok({ a: 'set', k: 'mode', v: 'tdm' })
			assert.equal(s.g.state().mode, 'tdm')
			ok({ a: 'set', k: 'minutes', v: 12 })
			assert.equal(s.bo.state().limits.minutes, 12)
			ok({ a: 'set', k: 'arena', v: 'tables' })
			bad({ a: 'set', k: 'arena', v: 'nope' })
			bad({ a: 'set', k: 'minutes', v: 31 })
			bad({ a: 'set', k: 'mode', v: 'ctf' })
			bad({ a: 'set', k: 'frags', v: 10 })
			ok({ a: 'bots', n: 2, level: 'easy' })
			assert.deepEqual([s.g.state().bots, s.g.state().botLevel], [2, 'easy'])
			bad({ a: 'bots', n: s.g.state().botMax + 1 })
		}
		if (id === 'salad') {
			ok({ a: 'set', k: 'round', v: 45 })
			assert.equal(s.g.state().secs, 45)
			ok({ a: 'set', k: 'teams', v: true })
			assert.equal(s.ana.state().teams, true)
			bad({ a: 'set', k: 'round', v: 29 })
			bad({ a: 'set', k: 'teams', v: 'yes' })
			for (const k of ['target', 'safe', 'house', 'lights', 'wall', 'kick', 'pause']) bad({ a: 'set', k, v: true })
			ok({ a: 'bots', n: 2, level: 'easy' })
			assert.deepEqual([s.g.state().bots, s.g.state().botLevel], [2, 'easy'])
		}
		const lines = s.logs.filter(([, m]) => m.startsWith(`[${s.G.prefix}] Ana (#`)).map(([lv, m]) => [lv, m.replace(/\(#\d+\)/, '(#)')])
		assert.ok(lines.length >= 3 && lines.every(([lv]) => lv === 'info'), JSON.stringify(lines))
		assert.ok(lines.some(([, m]) => /: set (track hall-loop|mode tdm|round 45)$/.test(m)), JSON.stringify(lines))
		assert.ok(lines.some(([, m]) => /: bots \d (hard|easy)$/.test(m)), JSON.stringify(lines))
	})

	test(`${id}: start from the lobby; a running round refuses (also stop); paused refuses; the operator still wins`, async (t) => {
		const s = await setup(t, id)
		s.g.host({ action: 'self', on: true })
		assert.deepEqual(s.bo.ctl({ a: 'start' }), { t: 'ctl', ok: true, a: 'start' }, JSON.stringify(s.bo.got.filter((x) => x.t === 'ctl')))
		assert.equal(s.g.state().phase, 'countdown')
		s.slow()
		assert.equal(s.ana.ctl({ a: 'stop' }).error, 'running', 'stop never ends a running round')
		assert.equal(s.ana.ctl({ a: 'bots', n: 1 }).error, 'running')
		assert.notEqual(s.g.state().phase, 'lobby')
		assert.equal(s.g.host(s.G.pause).status, 200)
		assert.equal(s.ana.ctl({ a: 'start' }).error, 'paused')
		assert.equal(s.g.host(s.G.unpause).status, 200)
		assert.equal(s.g.host({ action: 'stop' }).status, 200, 'the operator stops it')
		assert.equal(s.g.state().phase, 'lobby')
		s.slow()
		assert.equal(s.g.host(s.G.pause).status, 200)
		const [k, v] = { rc: ['laps', 5], sk: ['minutes', 5], salad: ['round', 60] }[id]
		assert.equal(s.ana.ctl({ a: 'set', k, v }).error, 'paused', 'paused in the lobby too')
		s.g.host({ action: 'self', on: false })
		s.g.host(s.G.unpause)
		s.slow()
		assert.equal(s.ana.ctl({ a: 'start' }).error, 'host', 'self-service off again')
		assert.equal(s.ana.code, null)
	})

	test(`${id}: rate limit — the 5th ctl inside 2 s is \`slow\`, the socket stays open`, async (t) => {
		const s = await setup(t, id)
		s.g.host({ action: 'self', on: true })
		const k = { rc: ['laps', 5], sk: ['minutes', 5], salad: ['round', 60] }[id]
		for (let i = 0; i < 4; i++) assert.equal(s.ana.ctl({ a: 'set', k: k[0], v: k[1] }).ok, true, `#${i + 1}`)
		assert.equal(s.ana.ctl({ a: 'set', k: k[0], v: k[1] }).error, 'slow')
		assert.equal(s.bo.ctl({ a: 'set', k: k[0], v: k[1] }).ok, true, 'another socket')
		assert.equal(s.ana.code, null)
	})

	test(`${id}: descriptor held() follows the operator's disable / enable (games.selfService leaves an operator close alone)`, async (t) => {
		const s = await setup(t, id)
		const W = require(`../../modules/${{ rc: 'rc-game/server/rc-world', sk: 'toy-skirmish/server/sk-world', salad: 'stage-salad/server/salad-world' }[id]}`)
		W.register(() => s.g)
		t.after(() => W.unregister())
		const d = W.descriptor()
		assert.equal(d.held(), false)
		d.host({ action: 'disable' })
		assert.equal(d.held(), true)
		assert.deepEqual(d.state(), { enabled: false }, 'the public state shape is unchanged')
		d.host({ action: 'enable' })
		assert.equal(d.held(), false)
	})
}

test('rc: Back to lobby from the results (stop); a stop in the lobby is a no-op', async (t) => {
	const s = await setup(t, 'rc')
	s.g.host({ action: 'self', on: true })
	s.ana.close()
	s.ana.emit('close')
	const cara = sock()
	s.G.attach(s.g, cara)
	assert.equal(s.bo.ctl({ a: 'start' }).ok, true)
	cara.say({ t: 'join', name: 'Cara' }) // joins during the countdown: seated, not racing
	s.bo.emit('close') // the only racer leaves → results (WO-1106 B39)
	assert.equal(s.g.state().phase, 'results')
	assert.deepEqual(cara.ctl({ a: 'stop' }), { t: 'ctl', ok: true, a: 'stop' })
	assert.equal(s.g.state().phase, 'lobby')
	assert.ok(s.logs.some(([, m]) => /^\[rc-game\] Cara \(#\d+\): stop$/.test(m)))
	assert.deepEqual(cara.ctl({ a: 'stop' }), { t: 'ctl', ok: true, a: 'stop' }, 'a stop in the lobby: nothing to do, answered ok')
})

test('salad + sk: the round runs out → results; `stop` → lobby; start again from the results', async (t) => {
	for (const id of ['salad', 'sk']) {
		const s = await setup(t, id)
		s.g.host({ action: 'self', on: true })
		if (id === 'salad') assert.equal(s.ana.ctl({ a: 'set', k: 'round', v: 30 }).ok, true)
		if (id === 'sk') assert.equal(s.ana.ctl({ a: 'set', k: 'minutes', v: 1 }).ok, true)
		assert.equal(s.ana.ctl({ a: 'start' }).ok, true)
		s.wait(id === 'salad' ? 34000 : 66000)
		assert.equal(s.g.state().phase, 'results', id)
		assert.deepEqual(s.bo.ctl({ a: 'stop' }), { t: 'ctl', ok: true, a: 'stop' })
		assert.equal(s.g.state().phase, 'lobby', id)
		s.wait(id === 'salad' ? 34000 : 66000)
		s.slow()
		assert.equal(s.g.state().phase, 'lobby', 'nothing started by itself')
		assert.equal(s.ana.ctl({ a: 'start' }).ok, true)
		s.wait(id === 'salad' ? 34000 : 66000)
		assert.equal(s.g.state().phase, 'results')
		assert.equal(s.ana.ctl({ a: 'start' }).ok, true, `${id}: play again from the results`)
		assert.equal(s.g.state().phase, 'countdown')
		s.g.disable()
	}
})

test('the Game World fans `self` out to every registered game (enabled or not)', async (t) => {
	const c = createClock()
	const games = { rc: GAMES.rc.make(c, () => {}), sk: GAMES.sk.make(c, () => {}), salad: GAMES.salad.make(c, () => {}) }
	t.after(() => Object.values(games).forEach((g) => g.disable()))
	const reg = { v: 1, games: new Map(), hub: null }
	for (const [id, g] of Object.entries(games)) reg.games.set(id, { id, title: id, order: 1, paths: {}, host: (b) => g.host(b), state: () => g.state(), room: () => g.worldAdapter() })
	const hub = createHub({ registry: reg, timers: { setInterval: () => 1, clearInterval: () => {} }, now: () => 1000, seed: 1, defer: (fn) => fn() })
	const svc = createWorldService({ hub, registry: reg })
	games.sk.host({ action: 'enable' })
	assert.equal(svc.host({ action: 'self' }).status, 400)
	const r = svc.host({ action: 'self', on: true })
	assert.equal(r.status, 200)
	assert.deepEqual(Object.keys(r.body.results).sort(), ['rc', 'salad', 'sk'])
	assert.ok(Object.values(r.body.results).every((x) => x.ok))
	assert.equal(games.sk.state().self, true)
	games.rc.host({ action: 'enable' })
	assert.equal(games.rc.state().self, true, 'kept while closed, there on open')
	assert.ok(path.isAbsolute(ROOT))
})
