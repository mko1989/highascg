'use strict'

/**
 * WO-1074 §2.6 — the live lights and LED wall pictures wired into the game service, end to end against a SANDBOX server
 * (own port, own token file, synthetic project, temp scene cache — never the box's node), with a fake follow service
 * (`lightsDeps`) and a fake video feed + lease (`videoDeps`) injected through createRcGame's deps:
 *  - the state carries `lights` / `wall`; the host switches flip them, broadcast the state and stop / restart the work;
 *  - a socket gets `lxfull` on connect; the scene JSON carries `lights` and `screens`;
 *  - `{t:'video',on:true}` → ONE feed client in the `game` tier at 480 px, the role leased, binary frames in the feed's
 *    `[u8 n][role][JPEG]` framing; they stop after `on:false`, the wall switch off and a disable;
 *  - disabled, the game holds nothing: no timer, no feed client, no lease (asserted through the fakes).
 * The rest of the socket / auth paths: smoke-wo1074-rc-server-http.test.js.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1074-live-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token') // never the box's .private/api-token

const auth = require('../../src/server/auth')
const { routeRequest } = require('../../src/api/router')
const { startHttpServer } = require('../../src/server/http-server')
/* WO-1076: the game is an opt-in module — its routes, public paths and static files reach the server only through the
 * module registry, registered here from the module's own register.js (the WS path is attached below with this test's game) */
const moduleRegistry = require('../../src/module-registry')
const rcModule = require('../../modules/rc-game/register')({ requireCore: (id) => require(id.startsWith('src/') ? require('path').join(__dirname, '..', '..', id) : id), coreRoot: require('path').join(__dirname, '..', '..') })
const { createRcGame, useRcGame } = require('../../modules/rc-game/server/rc-game')
const { attachRcGameWs, WS_PATH } = require('../../modules/rc-game/server/rc-ws')
const { setRcGameEnabled } = require('../../modules/rc-game/server/rc-public')
const { frameMessage } = require('../../src/system/video-feed')
const { LEASE_ID, PARAMS } = require('../../modules/rc-game/server/rc-video')

const PW = 'wo1074-live-password'
const BEARER = { Authorization: `Bearer ${PW}` }
const ctx = { config: { security: { enforceAuth: true, apiToken: PW } }, log: () => {} }

/* one fake clock for the room, the lights producer and the lease renewal: "no timers" = this map is empty */
let t0 = 5_000_000
const timers = new Map()
let seq = 0
const T = {
	setTimeout: (fn, ms) => (timers.set(++seq, { fn, at: t0 + ms, every: 0 }), seq),
	setInterval: (fn, ms) => (timers.set(++seq, { fn, at: t0 + ms, every: ms }), seq),
	clearTimeout: (id) => timers.delete(id),
	clearInterval: (id) => timers.delete(id),
}
function advance(ms) {
	const end = t0 + ms
	for (;;) {
		let next = null
		for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x]
		if (!next) break
		t0 = next[1].at
		if (next[1].every) next[1].at += next[1].every
		else timers.delete(next[0])
		next[1].fn()
	}
	t0 = end
}

/* the fake follow service: two moving heads (rig as in smoke-wo1074-rc-live-lights) */
const I12 = (o = [0, 0, 0]) => [1, 0, 0, 0, 1, 0, 0, 0, 1, ...o]
const RIG = {
	nodes: [
		{ id: 'Base', parent: -1, kind: 'Geometry', xf: I12() },
		{ id: 'Yoke', parent: 0, kind: 'Axis', axis: 'pan', xf: I12([0, -0.1, 0]) },
		{ id: 'Head', parent: 1, kind: 'Axis', axis: 'tilt', xf: I12([0, -0.35, 0]) },
		{ id: 'Beam', parent: 2, kind: 'Beam', xf: I12([0, -0.1, 0]), beam: { beamType: 'Spot', beamAngle: 20 } },
	],
}
const FIXTURES = [0, 1].map((k) => ({ id: `f${k}`, name: `Head ${k}`, enabled: true, typeId: 'aaaaaaaaaaaa', mode: 'M',
	pose: { x: k, y: 4, z: 6, hang: 'truss', yaw: 0, pitch: 0, roll: 0 } }))
const VIS = FIXTURES.map((f) => ({ id: f.id, axes: { Yoke: 0, Head: 0 }, beams: { Beam: { i: 1, c: [1, 0, 0], zoom: 20 } } }))
const lightsDeps = { fixtures: () => FIXTURES, visual: () => ({ fixtures: VIS }), rigOf: () => RIG, typeName: () => 'Smoke Spot',
	now: () => t0, setInterval: T.setInterval, clearInterval: T.clearInterval }

/* the fake video feed: records its clients (socket-shaped) and the role lease */
const SCREENS = [{ id: 'led_wall_1', role: 'pgm1', p: [0, 3, -9], rot: [0, 0, 0], size: [7, 4], curveDeg: 0, cols: 14, uv: [0, 0, 1, 1] }]
const feedClients = []
const feed = {
	addClient(c, query, opts) {
		const e = { c, query, opts, roles: null, closed: false }
		feedClients.push(e)
		c.on('message', (d) => (e.roles = JSON.parse(String(d)).roles))
		c.on('close', () => (e.closed = true))
	},
}
const leases = []
const videoDeps = { screens: () => SCREENS, feed: () => feed, lease: (id, roles) => leases.push([id, roles]),
	roles: () => SCREENS.map((s) => s.role), now: () => t0, setInterval: T.setInterval, clearInterval: T.clearInterval }
const openClients = () => feedClients.filter((e) => !e.closed)
const lastLease = () => leases.at(-1)

let server, port, rcWs, game
test.before(async () => {
	moduleRegistry.register(rcModule)
	server = startHttpServer({ port: 0, bindAddress: '127.0.0.1', webDir: TMP, routeApi: (m, p, b, req) => routeRequest(m, p, b, ctx, req), log: () => {} })
	await new Promise((r) => server.once('listening', r))
	port = server.address().port
	game = createRcGame({ now: () => t0, timers: T, port: () => port, lanIps: () => ['192.0.2.7'], lightsDeps, videoDeps,
		bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null }, cacheDir: path.join(TMP, 'cache') } })
	useRcGame(game)
	rcWs = attachRcGameWs(server, ctx, { game })
})

test.after(() => {
	moduleRegistry.unregister('rc-game')
	game?.disable()
	useRcGame(null)
	setRcGameEnabled(false)
	auth.setAuthRuntime({ enforceAuth: false })
	rcWs?.close()
	server?._highascgDestroyTrackedSockets?.()
	server?.close()
	fs.rmSync(TMP, { recursive: true, force: true })
	delete process.env.HIGHASCG_API_TOKEN_FILE
})

function req(method, p, { headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
		const r = http.request({ host: '127.0.0.1', port, path: p, method,
			headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers } }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
		})
		r.on('error', reject)
		r.end(data || undefined)
	})
}
const host = async (body) => {
	const r = await req('POST', '/api/game/rc/host', { headers: BEARER, body })
	return { status: r.status, ...JSON.parse(r.body) }
}

/** A socket client: JSON messages and binary frames kept apart; next(pred) waits for the first unseen JSON match. */
function client() {
	const sock = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`)
	const c = { sock, msgs: [], bins: [], waiters: [] }
	const poke = () => {
		for (const w of [...c.waiters]) {
			const i = c.msgs.findIndex((m, k) => k >= w.from && w.pred(m))
			if (i >= 0) c.waiters.splice(c.waiters.indexOf(w), 1), w.resolve(c.msgs[i])
		}
	}
	sock.on('message', (d, isBinary) => {
		if (isBinary) c.bins.push(Buffer.from(d))
		else c.msgs.push(JSON.parse(String(d)))
		poke()
	})
	c.closing = new Promise((r) => sock.on('close', (code) => r(code)))
	c.open = new Promise((r, j) => (sock.once('open', r), sock.once('error', j)))
	c.next = (pred, from = 0) => new Promise((resolve, reject) => {
		c.waiters.push({ pred: typeof pred === 'string' ? (m) => m.t === pred : pred, from, resolve })
		poke()
		setTimeout(() => reject(new Error(`timeout waiting for ${pred}`)), 3000).unref()
	})
	c.send = (m) => sock.send(JSON.stringify(m))
	/** Round trip: everything sent before has been handled by the server (and everything it sent first has arrived). */
	c.sync = async () => {
		const n = c.msgs.length
		const tag = Math.random()
		c.send({ t: 'ping', c: tag })
		await c.next((m) => m.t === 'pong' && m.c === tag, n)
	}
	return c
}

/** One picture as the feed would hand it to its client (≥ 115 ms after the last one: ≤ 8 / s per role). */
function feedFrame(e, n) {
	advance(200)
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 0xff, 0xd9])
	e.c.send(frameMessage('pgm1', jpeg), { binary: true })
	return jpeg
}

test('§2.6 live lights + wall pictures through the game service; disabled it holds nothing', { timeout: 20000 }, async () => {
	// disabled: nothing exists — no timer, no feed client, no lease
	assert.equal(timers.size, 0)
	assert.equal(feedClients.length + leases.length, 0)
	assert.deepEqual(JSON.parse((await req('GET', '/api/game/rc/state')).body), { enabled: false })

	const en = await host({ action: 'enable' })
	assert.equal(en.status, 200)
	assert.equal(en.state.lights, true, 'default on')
	assert.equal(en.state.wall, true, 'default on')
	assert.equal(feedClients.length + leases.length, 0, 'enabled without sockets: still no feed client, no lease')

	// the scene JSON carries the live additions
	const sj = JSON.parse((await req('GET', '/api/game/rc/scene')).body)
	assert.ok(sj.tracks.length >= 1 && /^none-/.test(sj.rev), 'the bake is still there')
	assert.deepEqual(sj.lights.map((l) => [l.i, l.id, l.name, l.kind]), [[0, 'f0', 'Head 0', 'spot'], [1, 'f1', 'Head 1', 'spot']])
	assert.ok(sj.lights.every((l) => l.p.length === 3 && l.p.every(Number.isFinite)))
	assert.deepEqual(sj.screens, SCREENS)

	// a socket: lxfull on connect (before joining), the 10 Hz producer runs while it is attached
	const A = client()
	await A.open
	const full = await A.next('lxfull')
	assert.equal(full.on, true)
	assert.deepEqual(full.lights.map((l) => l.id), ['f0', 'f1'])
	assert.equal(full.f.length, 2)
	assert.deepEqual(full.f[0].slice(4, 9), [1, 0, 0, 1, 20], 'red, full, 20°')
	A.send({ t: 'join', name: 'Ola', color: '#ff5533' })
	assert.equal((await A.next('welcome')).state.lights, true)
	const B = client() // a second socket that never asks for pictures
	await B.open
	B.send({ t: 'join', name: 'Bo', color: '#33aaff' })
	await B.next('welcome')
	const lightTimer = () => [...timers.values()].filter((x) => x.every === 100).length
	assert.equal(lightTimer(), 1, 'one 10 Hz producer for every socket')

	// lights switch: off → `lxfull` off to everyone + a state broadcast, the producer stops; bad `on` → 400
	assert.equal((await host({ action: 'lights' })).status, 400)
	assert.equal((await host({ action: 'lights', on: 'no' })).status, 400)
	let n = A.msgs.length
	const off = await host({ action: 'lights', on: false })
	assert.equal(off.status, 200)
	assert.equal(off.state.lights, false)
	assert.deepEqual((await A.next('lxfull', n)).f, [])
	assert.equal((await A.next('state', n)).state.lights, false)
	assert.equal(lightTimer(), 0)
	n = A.msgs.length
	assert.equal((await host({ action: 'lights', on: true })).state.lights, true)
	assert.equal((await A.next('lxfull', n)).f.length, 2)
	assert.equal((await A.next('state', n)).state.lights, true)
	assert.equal(lightTimer(), 1)

	// pictures: one feed client in the game tier at 480 px, pgm1 leased, frames framed [u8 n][role][JPEG] to A only
	A.send({ t: 'video', on: true })
	await A.sync()
	assert.equal(openClients().length, 1)
	const fc = openClients()[0]
	assert.deepEqual(fc.opts, { tier: 'game' })
	assert.equal(fc.query.width, 480)
	assert.equal(PARAMS.width, 480)
	assert.deepEqual(fc.roles, ['pgm1'])
	assert.deepEqual(lastLease(), [LEASE_ID, ['pgm1']])
	assert.equal([...timers.values()].filter((x) => x.every === 5000).length, 1, 'the lease is renewed every 5 s')
	const jpeg = feedFrame(fc, 1)
	await A.sync()
	await B.sync()
	assert.equal(A.bins.length, 1)
	const bin = A.bins[0]
	assert.equal(bin[0], 4)
	assert.equal(bin.subarray(1, 5).toString('latin1'), 'pgm1')
	assert.deepEqual(bin.subarray(5), jpeg)
	assert.equal(B.bins.length, 0, 'a socket that did not ask gets no pictures')

	// on:false → feed client closed, lease released, no more frames
	A.send({ t: 'video', on: false })
	await A.sync()
	assert.equal(fc.closed, true)
	assert.deepEqual(lastLease(), [LEASE_ID, []])
	feedFrame(fc, 2)
	await A.sync()
	assert.equal(A.bins.length, 1, 'nothing after on:false')

	// wall switch off → released (and a state broadcast); on → the socket that had asked is subscribed again
	A.send({ t: 'video', on: true })
	await A.sync()
	const fc2 = openClients()[0]
	feedFrame(fc2, 3)
	await A.sync()
	assert.equal(A.bins.length, 2)
	n = A.msgs.length
	const wallOff = await host({ action: 'wall', on: false })
	assert.equal(wallOff.state.wall, false)
	assert.equal((await A.next('state', n)).state.wall, false)
	assert.equal(fc2.closed, true)
	assert.deepEqual(lastLease(), [LEASE_ID, []])
	assert.equal(openClients().length, 0)
	feedFrame(fc2, 4)
	await A.sync()
	assert.equal(A.bins.length, 2, 'nothing while the wall switch is off')
	assert.equal((await host({ action: 'wall', on: true })).state.wall, true)
	const fc3 = openClients()[0]
	assert.ok(fc3 && fc3 !== fc2, 'the subscriber gets pictures again')
	feedFrame(fc3, 5)
	await A.sync()
	assert.equal(A.bins.length, 3)

	// disable: every socket closed, no producer, no feed client, the lease released, no timer at all
	assert.equal((await host({ action: 'disable' })).status, 200)
	assert.equal(await A.closing, 4403)
	assert.equal(await B.closing, 4403)
	assert.equal(fc3.closed, true)
	assert.equal(openClients().length, 0)
	assert.deepEqual(lastLease(), [LEASE_ID, []])
	assert.equal(timers.size, 0, 'no room / lights / lease timer')
	const { lights, video } = game.live()
	assert.equal(lights.subscribers() + video.subscribers(), 0)
	assert.equal(lights.running(), false)
	const leasesNow = leases.length
	advance(60000)
	assert.equal(leases.length, leasesNow, 'no renewal after the disable')
	assert.deepEqual(JSON.parse((await req('GET', '/api/game/rc/state')).body), { enabled: false })
})
