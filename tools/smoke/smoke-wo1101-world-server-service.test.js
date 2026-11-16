'use strict'

/**
 * WO-1101 / WO-1102 — the Game World service and API (modules/game-world/server/world-service.js, routes-world.js,
 * world-public.js; work/notes/game-world-contract.md §3–§4) with fake game descriptors (§0.1):
 *   - state off / on (games, joinUrl, scene URLs with the rev, affect, safe, events, stats)
 *   - host round trips: enable / disable / start / stop one or all (a refusing game is reported, the others still go),
 *     presenter-safe fan-out shapes (salad `safe`, rc / sk `pause`; a game enabled while safe gets it too), bots in each
 *     game's own shape, lights / wall / house pass-through to enabled games only, affect, event (rain / spot / none)
 *   - the routes through a real RouteRegistry and through the core router with API auth ENFORCED: state public only
 *     while a game session runs, host never public
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1101-svc-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')

const { createHub } = require('../../modules/game-world/server/world-hub')
const { createWorldService } = require('../../modules/game-world/server/world-service')
const { isWorldPublicPath } = require('../../modules/game-world/server/world-public')
const routesWorld = require('../../modules/game-world/server/routes-world')
const { RouteRegistry } = require('../../src/api/route-registry')

function fakeAdapter(id) {
	return { id, entities: () => [], viewers: () => [], send() {}, toAll() {}, board: () => ({ phase: 'lobby', endsAt: null, top: [], players: 2, bots: 1 }), apply: () => true, bonus: () => true, area: () => null, pause() {} }
}
function fakeDesc(id, order, o = {}) {
	const d = {
		id,
		title: id.toUpperCase(),
		order,
		models: {},
		paths: { play: `/game/${id}/`, spectate: `/game/${id}/?spectate=1`, host: `/game/${id}/?host=1`, state: `/api/game/${id}/state`, kit: null, scene: `/api/game/${id}/scene`, glb: `/api/game/${id}/scene.glb` },
		calls: [],
		on: false,
		adapter: fakeAdapter(id),
		room: () => (d.on ? d.adapter : null),
		host(b) {
			d.calls.push(b)
			if (o.refuse === b.action) return { status: 409, body: { ok: false, error: 'no players' } }
			if (b.action === 'enable') d.on = true
			else if (b.action === 'disable') d.on = false
			else if (!d.on) return { status: 409, body: { ok: false, error: 'the game is not enabled' } }
			return { status: 200, body: { ok: true } }
		},
		state: () => (d.on ? { enabled: true, phase: 'lobby', joinUrls: [`http://192.0.2.7:4200/game/${id}/`], sceneRev: 'rev 1' } : { enabled: false }),
	}
	return d
}
function setup(o = {}) {
	const reg = { v: 1, games: new Map(), hub: null }
	const rc = fakeDesc('rc', 1, o.rc)
	const sk = fakeDesc('sk', 2, o.sk)
	const salad = fakeDesc('salad', 3, o.salad)
	for (const d of [rc, sk, salad]) reg.games.set(d.id, d)
	const timers = { setInterval: () => 1, clearInterval: () => {} }
	const hub = createHub({ registry: reg, timers, now: () => 1000, seed: 1, defer: (fn) => fn() })
	const svc = createWorldService({ hub, registry: reg })
	return { reg, rc, sk, salad, hub, svc }
}
const last = (d) => d.calls.at(-1)

test('state: off while no session runs; on with games, joinUrl, scene, affect, safe, stats', () => {
	const { svc, rc } = setup()
	let s = svc.state()
	assert.deepEqual(Object.keys(s), ['on', 'v', 'games'])
	assert.equal(s.on, false)
	assert.deepEqual(s.games.map((g) => [g.id, g.enabled, g.phase]), [['rc', false, 'off'], ['sk', false, 'off'], ['salad', false, 'off']])
	rc.on = true
	s = svc.state()
	assert.equal(s.on, true)
	assert.equal(s.safe, false)
	assert.deepEqual(s.affect, { rc: 'on', sk: 'on', salad: 'on' })
	const g = s.games[0]
	assert.deepEqual([g.id, g.title, g.enabled, g.phase, g.players, g.bots, g.joinUrl], ['rc', 'RC', true, 'lobby', 2, 1, 'http://192.0.2.7:4200/game/rc/'])
	assert.deepEqual(s.scene, { json: '/api/game/rc/scene', glb: '/api/game/rc/scene.glb?rev=rev%201' })
	assert.equal(s.events, null)
	assert.equal(typeof s.stats.ticks, 'number')
	assert.equal(s.games[0]._rev, undefined)
})

test('enable / disable / start / stop: one game or all; a refusing game is reported, the others still go', () => {
	const { svc, rc, sk, salad, hub } = setup({ sk: { refuse: 'start' } })
	let r = svc.host({ action: 'enable', game: 'sk' })
	assert.equal(r.status, 200)
	assert.deepEqual(r.body.results, { sk: { ok: true, status: 200 } })
	assert.deepEqual(rc.calls, [])
	r = svc.host({ action: 'enable' })
	assert.equal(r.body.ok, true)
	for (const d of [rc, sk, salad]) assert.deepEqual(last(d), { action: 'enable' })
	assert.equal(hub.adapters().size, 3, 'the hub attached the enabled sessions')
	r = svc.host({ action: 'start' })
	assert.equal(r.status, 200)
	assert.equal(r.body.ok, false)
	assert.deepEqual(r.body.results.sk, { ok: false, status: 409, error: 'no players' })
	assert.equal(r.body.results.rc.ok, true)
	assert.deepEqual(last(salad), { action: 'start' }, 'the others still started')
	r = svc.host({ action: 'stop', game: 'rc' })
	assert.deepEqual(last(rc), { action: 'stop' })
	assert.deepEqual(Object.keys(r.body.results), ['rc'])
	svc.host({ action: 'disable', game: 'salad' })
	r = svc.host({ action: 'stop' })
	assert.deepEqual(Object.keys(r.body.results), ['rc', 'sk'], 'stop all = the enabled games')
	r = svc.host({ action: 'disable' })
	assert.equal(r.body.state.on, false)
	assert.equal(svc.host({ action: 'start', game: 'nope' }).status, 404)
	assert.equal(svc.host({ action: 'start' }).status, 409, 'no enabled game')
	assert.equal(svc.host({ action: 'dance' }).status, 400)
	assert.equal(svc.host(null).status, 400)
})

test('presenter safe: salad `safe`, rc / sk `pause`, to every enabled game; off undoes; a game enabled while safe starts paused', () => {
	const { svc, rc, sk, salad, hub } = setup()
	svc.host({ action: 'enable', game: 'rc' })
	svc.host({ action: 'enable', game: 'salad' })
	let r = svc.host({ action: 'safe', on: true })
	assert.equal(r.status, 200)
	assert.equal(hub.isSafe(), true)
	assert.equal(r.body.state.safe, true)
	assert.deepEqual(last(rc), { action: 'pause', on: true })
	assert.deepEqual(last(salad), { action: 'safe', on: true })
	assert.deepEqual(sk.calls, [], 'not enabled → not called')
	svc.host({ action: 'enable', game: 'sk' })
	assert.deepEqual(sk.calls, [{ action: 'enable' }, { action: 'pause', on: true }])
	assert.equal(svc.host({ action: 'event', kind: 'rain' }).status, 409, 'no events while safe')
	r = svc.host({ action: 'safe', on: false })
	assert.equal(r.body.state.safe, false)
	assert.deepEqual(last(rc), { action: 'pause', on: false })
	assert.deepEqual(last(sk), { action: 'pause', on: false })
	assert.deepEqual(last(salad), { action: 'safe', on: false })
	assert.equal(hub.isSafe(), false)
	assert.equal(svc.host({ action: 'safe', on: 'yes' }).status, 400)
})

test('bots in each game\'s own shape: rc { count }, sk / salad { n }', () => {
	const { svc, rc, sk, salad } = setup()
	svc.host({ action: 'enable' })
	svc.host({ action: 'bots', game: 'rc', n: 3 })
	assert.deepEqual(last(rc), { action: 'bots', count: 3 })
	svc.host({ action: 'bots', game: 'sk', n: 2 })
	assert.deepEqual(last(sk), { action: 'bots', n: 2 })
	svc.host({ action: 'bots', game: 'salad', n: 0 })
	assert.deepEqual(last(salad), { action: 'bots', n: 0 })
	assert.equal(svc.host({ action: 'bots', n: 2 }).status, 400)
	assert.equal(svc.host({ action: 'bots', game: 'rc', n: -1 }).status, 400)
	assert.equal(svc.host({ action: 'bots', game: 'rc', n: 1.5 }).status, 400)
	assert.equal(svc.host({ action: 'bots', game: 'zz', n: 1 }).status, 404)
})

test('lights / wall / house pass through to every enabled game; the world keeps the last value', () => {
	const { svc, rc, sk, salad } = setup()
	svc.host({ action: 'enable', game: 'rc' })
	svc.host({ action: 'enable', game: 'sk' })
	let r = svc.host({ action: 'lights', on: false })
	assert.deepEqual(last(rc), { action: 'lights', on: false })
	assert.deepEqual(last(sk), { action: 'lights', on: false })
	assert.deepEqual(salad.calls, [])
	assert.equal(r.body.state.lights, false)
	r = svc.host({ action: 'wall', on: true })
	assert.deepEqual(last(sk), { action: 'wall', on: true })
	assert.equal(r.body.state.wall, true)
	r = svc.host({ action: 'house', level: 1.7 })
	assert.deepEqual(last(rc), { action: 'house', level: 1 })
	assert.equal(r.body.state.house, 1)
	svc.host({ action: 'house', on: false })
	assert.deepEqual(last(sk), { action: 'house', level: 0 })
	assert.equal(svc.host({ action: 'house', level: 'x' }).status, 400)
	assert.equal(svc.host({ action: 'lights' }).status, 400)
})

test('affect and events', () => {
	const { svc, hub } = setup()
	svc.host({ action: 'enable' })
	let r = svc.host({ action: 'affect', game: 'sk', mode: 'soft' })
	assert.equal(r.status, 200)
	assert.equal(hub.affect('sk'), 'soft')
	assert.deepEqual(r.body.state.affect, { rc: 'on', sk: 'soft', salad: 'on' })
	assert.equal(svc.host({ action: 'affect', game: 'sk', mode: 'loud' }).status, 400)
	assert.equal(svc.host({ action: 'affect', mode: 'off' }).status, 400)
	assert.equal(svc.host({ action: 'affect', game: 'zz', mode: 'off' }).status, 404)
	r = svc.host({ action: 'event', kind: 'rain' })
	assert.deepEqual(r.body.state.events.rain, { secs: 10, left: 10 })
	r = svc.host({ action: 'event', kind: 'spot', secs: 60 })
	assert.deepEqual(r.body.state.events.spot, { secs: 60, left: 60 })
	assert.equal(svc.host({ action: 'event', kind: 'spot', secs: 4 }).status, 400)
	assert.equal(svc.host({ action: 'event', kind: 'spot', secs: 61 }).status, 400)
	assert.equal(svc.host({ action: 'event', kind: 'hail' }).status, 400)
	r = svc.host({ action: 'event', kind: 'none' })
	assert.equal(r.body.state.events, null)
})

test('a throwing descriptor is reported, never thrown', () => {
	const { svc, rc, reg } = setup()
	rc.host = () => {
		throw new Error('boom')
	}
	reg.games.get('sk').state = () => {
		throw new Error('boom')
	}
	const r = svc.host({ action: 'enable' })
	assert.equal(r.status, 200)
	assert.deepEqual(r.body.results.rc, { ok: false, status: 500, error: 'the game failed' })
	assert.equal(r.body.results.sk.ok, true)
})

test('public paths: GET state only while a session runs; host never; no neighbours', () => {
	const { reg, rc } = setup()
	assert.equal(isWorldPublicPath('GET', '/api/game/world/state', reg), false)
	rc.on = true
	assert.equal(isWorldPublicPath('GET', '/api/game/world/state', reg), true)
	assert.equal(isWorldPublicPath('POST', '/api/game/world/host', reg), false)
	assert.equal(isWorldPublicPath('GET', '/api/game/world/host', reg), false)
	assert.equal(isWorldPublicPath('GET', '/api/game/world/statex', reg), false)
	assert.equal(isWorldPublicPath('POST', '/api/game/world/state', reg), false)
	reg.games.get('sk').room = () => {
		throw new Error('boom')
	}
	assert.equal(isWorldPublicPath('GET', '/api/game/world/state', reg), true)
})

test('routes through a RouteRegistry: state JSON, host JSON body, malformed body → 400', async () => {
	const { svc, rc } = setup()
	const routes = new RouteRegistry()
	routesWorld.register(routes, { service: svc })
	let r = await routes.dispatch('GET', '/api/game/world/state', '', {}, {}, {})
	assert.equal(r.status, 200)
	assert.equal(r.headers['Cache-Control'], 'no-store')
	assert.equal(JSON.parse(r.body).on, false)
	r = await routes.dispatch('POST', '/api/game/world/host', JSON.stringify({ action: 'enable', game: 'rc' }), {}, {}, {})
	assert.equal(r.status, 200)
	assert.equal(JSON.parse(r.body).state.on, true)
	assert.equal(rc.on, true)
	r = await routes.dispatch('POST', '/api/game/world/host', '{nope', {}, {}, {})
	assert.equal(r.status, 400)
	r = await routes.dispatch('POST', '/api/game/world/host', '[1]', {}, {}, {})
	assert.equal(r.status, 400)
})

test('through the core router with API auth enforced (module registry): state public only while a game runs, host never', async () => {
	const PW = 'wo1101-world-password'
	const ctx = { config: { security: { enforceAuth: true, apiToken: PW } }, log: () => {} }
	const { reg, rc } = setup()
	const { KEY } = require('../../modules/game-world/server/world-link')
	globalThis[KEY] = reg
	const desc = require('../../modules/game-world/register')({ requireCore: (id) => require(id.startsWith('src/') ? path.join(__dirname, '..', '..', id) : id), log: () => {} })
	const moduleRegistry = require('../../src/module-registry')
	const { routeRequest } = require('../../src/api/router')
	moduleRegistry.register(desc)
	try {
		const req = (h = {}) => ({ headers: h, socket: { remoteAddress: '192.0.2.50' } })
		let r = await routeRequest('GET', '/api/game/world/state', '', ctx, req())
		assert.equal(r.status, 401, 'no game → auth')
		r = await routeRequest('GET', '/api/game/world/state', '', ctx, req({ authorization: `Bearer ${PW}` }))
		assert.equal(r.status, 200)
		assert.equal(JSON.parse(r.body).on, false)
		rc.on = true
		r = await routeRequest('GET', '/api/game/world/state', '', ctx, req())
		assert.equal(r.status, 200, 'public while a session runs')
		assert.equal(JSON.parse(r.body).on, true)
		r = await routeRequest('POST', '/api/game/world/host', JSON.stringify({ action: 'safe', on: true }), ctx, req())
		assert.equal(r.status, 401, 'host never public')
		r = await routeRequest('POST', '/api/game/world/host', JSON.stringify({ action: 'safe', on: true }), ctx, req({ authorization: `Bearer ${PW}` }))
		assert.equal(r.status, 200)
		assert.equal(reg.hub, desc.hub, 'register.js set reg.hub')
	} finally {
		moduleRegistry.unregister('game-world')
		await desc.onShutdown()
	}
	assert.equal(reg.hub, null, 'onShutdown clears reg.hub')
	assert.equal(desc.hub.running(), false)
})
