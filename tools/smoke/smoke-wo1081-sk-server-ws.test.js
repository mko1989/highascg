'use strict'

/**
 * WO-1081 — Stage Skirmish over a real socket (work/notes/skirmish-game-contract.md §2 / §7) against a SANDBOX server
 * on 127.0.0.1 (ephemeral port; the module's routes, static handler and socket mounted the way the dev server does —
 * never the box's node): the routes (state / scene / scene.glb / host), the socket end to end — join → welcome,
 * fire → shot, hit → dmg / kill, pick → pk / me, junk and oversized frames, the `/instance/<id>` path — and the live
 * room through the kit (RC §2.6): `lxfull` on attach, the lights / screens spliced into the scene JSON, wall pictures
 * leased under the module's own id and relayed as binary frames; disable → `off` + 4403, lease released. One injected
 * clock for the room, the lights and the lease timer: nothing is left open.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { EventEmitter } = require('events')
const WebSocket = require('ws')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
const desc = require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkGame, LEASE_ID } = require('../../modules/toy-skirmish/server/sk-game')
const { attachSkWs, isSkWsPath, WS_PATH } = require('../../modules/toy-skirmish/server/sk-ws')
const { serveSkStatic } = require('../../modules/toy-skirmish/server/sk-static')
const routesSk = require('../../modules/toy-skirmish/server/routes-sk')
const { isSkGameEnabled } = require('../../modules/toy-skirmish/server/sk-public')
const { RouteRegistry } = require('../../src/api/route-registry')
const { parseQueryString } = require('../../src/api/response')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1081-ws-'))

let t0 = 3_000_000
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

const I12 = (o = [0, 0, 0]) => [1, 0, 0, 0, 1, 0, 0, 0, 1, ...o]
const RIG = { nodes: [
	{ id: 'Base', parent: -1, kind: 'Geometry', xf: I12() },
	{ id: 'Yoke', parent: 0, kind: 'Axis', axis: 'pan', xf: I12([0, -0.1, 0]) },
	{ id: 'Head', parent: 1, kind: 'Axis', axis: 'tilt', xf: I12([0, -0.35, 0]) },
	{ id: 'Beam', parent: 2, kind: 'Beam', xf: I12([0, -0.1, 0]), beam: { beamType: 'Spot', beamAngle: 20 } },
] }
const FIXTURES = [0, 1].map((k) => ({ id: `f${k}`, name: `Head ${k}`, enabled: true, typeId: 'aaaaaaaaaaaa', mode: 'M',
	pose: { x: k, y: 4, z: 6, hang: 'truss', yaw: 0, pitch: 0, roll: 0 } }))
const VIS = FIXTURES.map((f) => ({ id: f.id, axes: { Yoke: 0, Head: 0 }, beams: { Beam: { i: 1, c: [1, 0, 0], zoom: 20 } } }))
const SCREENS = [{ id: 'wall', name: 'LED wall', role: 'wall', x: 0, y: 2, z: -8, w: 4, h: 2, yaw: 0 }]
const leases = []
let feedClient = null
const feed = { addClient: (c) => (feedClient = c) }

let server, port, game, wsHandle
const sockets = new Set()

test.before(async () => {
	game = createSkGame({ now: () => t0, timers: T, port: () => port, lanIps: () => ['192.0.2.9', '100.64.0.3'], log: () => {},
		bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null }, cacheDir: path.join(TMP, 'cache') },
		lightsDeps: { fixtures: () => FIXTURES, visual: () => ({ fixtures: VIS }), rigOf: () => RIG, typeName: () => 'Smoke Spot', now: () => t0,
			setInterval: T.setInterval, clearInterval: T.clearInterval },
		videoDeps: { screens: () => SCREENS, roles: () => ['wall'], feed: () => feed, lease: (id, roles) => leases.push([id, roles]), now: () => t0,
			setInterval: T.setInterval, clearInterval: T.clearInterval } })
	const routes = new RouteRegistry()
	routesSk.register(routes, { game })
	server = http.createServer((req, res) => {
		const u = new URL(req.url, 'http://127.0.0.1')
		const chunks = []
		req.on('data', (c) => chunks.push(c))
		req.on('end', async () => {
			const out = u.pathname.startsWith('/api/')
				? await routes.dispatch(req.method, u.pathname, Buffer.concat(chunks).toString('utf8'), { config: {} }, req, parseQueryString(u.search.slice(1)))
				: await desc.handleStatic({ method: req.method, path: u.pathname, search: u.search })
			const o = out || { status: 404, headers: {}, body: 'Not found' }
			res.writeHead(o.status, o.headers)
			res.end(o.body)
		})
	})
	wsHandle = attachSkWs(server, { config: {} }, { game })
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	port = server.address().port
})

test.after(async () => {
	game.disable()
	for (const s of sockets) s.terminate()
	wsHandle.close()
	await new Promise((r) => server.close(r))
	fs.rmSync(TMP, { recursive: true, force: true })
	assert.equal(timers.size, 0, 'no timer left')
})

function req(method, p, { body, headers = {} } = {}) {
	return new Promise((resolve, reject) => {
		const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks), text: Buffer.concat(chunks).toString('utf8') }))
		})
		r.on('error', reject)
		if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body))
		r.end()
	})
}

/** A game socket that queues what it hears; next(type) waits for the next message of that type. */
function client(p = WS_PATH) {
	const s = new WebSocket(`ws://127.0.0.1:${port}${p}`)
	sockets.add(s)
	s.msgs = []
	s.bins = []
	s.waiters = []
	const taken = new Map() // type → messages of it already handed out by next()
	s.on('message', (d, bin) => {
		if (bin) return s.bins.push(d)
		const m = JSON.parse(String(d))
		s.msgs.push(m)
		const w = s.waiters.find((x) => x.type === m.t)
		if (!w) return
		s.waiters.splice(s.waiters.indexOf(w), 1)
		clearTimeout(w.timer)
		taken.set(m.t, (taken.get(m.t) || 0) + 1)
		w.resolve(m)
	})
	s.closed = new Promise((r) => s.on('close', (code) => r(code)))
	s.opened = new Promise((r, j) => (s.on('open', r), s.on('error', j)))
	s.next = (type, ms = 2000) => new Promise((resolve, reject) => {
		const had = s.msgs.filter((m) => m.t === type)
		const n = taken.get(type) || 0
		if (had.length > n) return (taken.set(type, n + 1), resolve(had[n]))
		s.waiters.push({ type, resolve, timer: setTimeout(() => reject(new Error(`no ${type} within ${ms} ms`)), ms) })
	})
	/** Forget what was heard so far: next() waits for new messages only. */
	s.drain = () => {
		for (const m of s.msgs) taken.set(m.t, s.msgs.filter((x) => x.t === m.t).length)
	}
	s.say = (m) => s.send(JSON.stringify(m))
	return s
}
const settle = () => new Promise((r) => setImmediate(r))

test('disabled: state says so, the scene is closed, a socket hears `off` and 4403', async () => {
	assert.deepEqual(JSON.parse((await req('GET', '/api/game/sk/state')).text), { enabled: false })
	assert.equal((await req('GET', '/api/game/sk/scene')).status, 403)
	assert.equal((await req('GET', '/api/game/sk/scene.glb')).status, 403)
	assert.equal((await req('POST', '/api/game/sk/host', { body: { action: 'start' } })).status, 409)
	const s = client()
	const off = await s.next('off')
	assert.deepEqual(off, { t: 'off' })
	assert.equal(await s.closed, 4403)
})

test('host enable; the scene: no tracks, arenas, live lights + screens; the GLB with its rev', async () => {
	assert.equal((await req('POST', '/api/game/sk/host', { body: '[1]' })).status, 400, 'a JSON object is required')
	assert.equal((await req('POST', '/api/game/sk/host', { body: 'nope' })).status, 400)
	const r = JSON.parse((await req('POST', '/api/game/sk/host', { body: { action: 'enable' } })).text)
	assert.equal(r.ok, true)
	assert.equal(r.state.enabled, true)
	assert.equal(isSkGameEnabled(), true, 'the public paths open')
	assert.deepEqual(r.state.joinUrls, [`http://192.0.2.9:${port}/game/sk/`, `http://100.64.0.3:${port}/game/sk/`], 'venue network first')
	const sc = await req('GET', '/api/game/sk/scene')
	assert.equal(sc.status, 200)
	const j = JSON.parse(sc.text)
	assert.equal(j.tracks, undefined)
	assert.ok(j.arenas.length >= 3)
	assert.equal(j.glb, `/api/game/sk/scene.glb?rev=${j.rev}`)
	assert.deepEqual(j.lights.map((l) => l.id), ['f0', 'f1'], 'the rig spliced in')
	assert.deepEqual(j.screens, SCREENS, 'the screens spliced in')
	const st = JSON.parse((await req('GET', '/api/game/sk/state')).text)
	assert.equal(st.sceneRev, j.rev)
	assert.equal(st.arenaId, j.arenas[0].id)
	assert.equal(st.lights, true)
	assert.equal(st.wall, true)
	const glb = await req('GET', `/api/game/sk/scene.glb?rev=${j.rev}`)
	assert.equal(glb.status, 200)
	assert.equal(glb.headers['x-sk-rev'], j.rev)
	assert.match(glb.headers['cache-control'], /immutable/)
	assert.equal(glb.buf.subarray(0, 4).toString('latin1'), 'glTF')
	assert.match((await req('GET', '/api/game/sk/scene.glb?rev=old')).headers['cache-control'], /no-cache/)
	const gz = await req('GET', '/api/game/sk/scene.glb', { headers: { 'Accept-Encoding': 'gzip' } })
	assert.equal(gz.headers['content-encoding'], 'gzip')
})

test('socket: join → welcome + lxfull; fire → shot; hit → dmg / kill; pick → pk / me; junk ignored', async () => {
	const a = client(), b = client('/instance/abc' + WS_PATH)
	await Promise.all([a.opened, b.opened])
	const lx = a.next('lxfull')
	a.say({ t: 'join', name: 'Ann', color: '#112233' })
	const wa = await a.next('welcome')
	assert.equal(wa.you.name, 'Ann')
	const full = await lx
	assert.equal(full.on, true)
	assert.equal(full.f.length, 2, 'the rig state on attach: every beam')
	assert.deepEqual(full.lights.map((l) => l.id), ['f0', 'f1'])
	b.say({ t: 'join', name: 'Bob' })
	const wb = await b.next('welcome')
	const X = game.room().ctx
	const A = X.players.get(wa.id), B = X.players.get(wb.id)
	const arena = X.arena
	const s0 = arena.spawns[0]
	// stand both on spawn 0's spot, 0.5 u apart along x (spawns are ≥ 1 u from anything solid)
	Object.assign(A, { pos: [s0.x, s0.z], protectUntil: 0 })
	Object.assign(B, { pos: [s0.x + 0.05, s0.z], protectUntil: 0 })
	const shot = b.next('shot')
	a.say({ t: 'fire', w: 'pea', n: 1, p: [s0.x, s0.z], yaw: -Math.PI / 2 })
	const sm = await shot
	assert.deepEqual([sm.id, sm.w, sm.n], [wa.id, 'pea', 1])
	b.drain()
	const dmg = b.next('dmg')
	const me = b.next('me')
	a.say({ t: 'hit', n: 1, id: wb.id })
	assert.deepEqual(await dmg, { t: 'dmg', id: wb.id, by: wa.id, w: 'pea', hp: 86, ar: 0 })
	assert.equal((await me).hp, 86, 'the victim\'s `me`')
	a.say({ t: 'hit', n: 1, id: wb.id }) // rejected: one bullet, one hit
	B.hp = 10
	advance(400)
	a.say({ t: 'fire', w: 'pea', n: 2, p: [s0.x, s0.z], yaw: -Math.PI / 2 })
	await b.next('shot')
	const kill = a.next('kill')
	a.say({ t: 'hit', n: 2, id: wb.id })
	const k = await kill
	assert.deepEqual([k.id, k.by, k.w], [wb.id, wa.id, 'pea'])
	await b.next('kill')
	assert.equal(b.msgs.filter((m) => m.t === 'dmg').length, 2, 'the repeated hit was refused')
	const it = arena.pickups.find((p) => p.kind === 'rattler')
	A.pos = [it.x, it.z]
	a.drain()
	const pk = b.next('pk')
	const meA = a.next('me')
	a.say({ t: 'pick', id: it.id })
	assert.deepEqual(await pk, { t: 'pk', id: it.id, by: wa.id, until: t0 + 15000 })
	assert.equal((await meA).w.rattler, 60)
	// junk: not JSON, unknown type, binary, a bad field — all ignored, the socket stays
	a.send('{oops')
	a.say({ t: 'teleport' })
	a.send(Buffer.from([1, 2, 3]), { binary: true })
	a.say({ t: 'fire', w: 'pea', n: 'x' })
	const pong = a.next('pong')
	a.say({ t: 'ping', c: 7 })
	assert.equal((await pong).c, 7)
	const big = client()
	await big.opened
	big.send(JSON.stringify({ t: 'ping', pad: 'x'.repeat(4096) }))
	assert.equal(await big.closed, 1009, 'frames over 2 KB close the socket')
	const st = JSON.parse((await req('GET', '/api/game/sk/state')).text)
	assert.equal(st.players.length, 2)
	assert.deepEqual(st.pk, [[it.id, t0 + 15000]])
})

test('wall pictures: leased under the module\'s id, relayed as binary; disable → off + 4403, lease released', async () => {
	const v = client()
	await v.opened
	v.say({ t: 'join', name: 'Viewer', spectator: true })
	await v.next('welcome')
	v.say({ t: 'video', on: true })
	await settle()
	for (let n = 0; n < 50 && !feedClient; n++) await settle()
	assert.ok(feedClient, 'the feed was asked for a client')
	assert.deepEqual(leases.at(-1), [LEASE_ID, ['wall']])
	assert.equal(LEASE_ID, 'toy-skirmish')
	const frame = Buffer.concat([Buffer.from([4]), Buffer.from('wall', 'latin1'), Buffer.from([0xff, 0xd8, 0xff])])
	feedClient.send(frame)
	for (let n = 0; n < 50 && !v.bins.length; n++) await settle()
	assert.ok(v.bins.length >= 1 && Buffer.from(v.bins[0]).equals(frame), 'the frame reaches the subscriber')
	assert.ok(feedClient instanceof EventEmitter)
	assert.equal((await req('POST', '/api/game/sk/host', { body: { action: 'lights', on: 'no' } })).status, 400)
	v.drain()
	const dark = v.next('lxfull')
	const lr = JSON.parse((await req('POST', '/api/game/sk/host', { body: { action: 'lights', on: false } })).text)
	assert.equal(lr.state.lights, false)
	assert.deepEqual([(await dark).on, (await dark).f], [false, []], 'the host switch turns the rig off for everyone')
	const wr = JSON.parse((await req('POST', '/api/game/sk/host', { body: { action: 'wall', on: false } })).text)
	assert.equal(wr.state.wall, false)
	assert.deepEqual(leases.at(-1), [LEASE_ID, []], 'wall off → lease released')
	await req('POST', '/api/game/sk/host', { body: { action: 'wall', on: true } })
	assert.deepEqual(leases.at(-1), [LEASE_ID, ['wall']])
	const all = [...sockets].filter((s) => s.readyState === WebSocket.OPEN)
	const closes = all.map((s) => s.closed)
	const r = await req('POST', '/api/game/sk/host', { body: { action: 'disable' } })
	assert.equal(JSON.parse(r.text).state.enabled, false)
	assert.ok((await Promise.all(closes)).every((c) => c === 4403), 'every game socket closed with 4403')
	assert.ok(all.every((s) => s.msgs.at(-1)?.t === 'off'), '`off` first')
	assert.deepEqual(leases.at(-1), [LEASE_ID, []], 'lease released')
	assert.equal(isSkGameEnabled(), false)
	assert.equal(timers.size, 0, 'disabled: no room, lights or lease timer')
	assert.equal(game.socketCount(), 0)
})

test('the socket paths: exact, or under /instance/<id>', () => {
	for (const p of [WS_PATH, `${WS_PATH}?x=1`, `/instance/abc${WS_PATH}`]) assert.equal(isSkWsPath(p), true, p)
	for (const p of ['/api/game/sk/wsx', '/api/game/rc/ws', `/instance/a/b${WS_PATH}`, `/x${WS_PATH}`, '', null]) assert.equal(isSkWsPath(p), false, String(p))
})

test('static: the page dir, the kit alias (.js / .mjs / .css only), traversal refused, three', async () => {
	assert.equal((await req('GET', '/game/sk')).status, 302)
	assert.equal((await req('GET', '/game/sk/protocol.js')).status, 200)
	assert.equal((await req('GET', '/game/sk/kit/net.js')).status, 200, 'the RC client through the alias')
	assert.equal((await req('GET', '/game/sk/kit/index.html')).status, 404, 'html is not part of the kit')
	assert.equal((await req('GET', '/game/sk/kit/package.json')).status, 404)
	assert.equal((await req('GET', '/game/sk/kit/')).status, 404)
	assert.equal((await req('GET', '/vendor/three/build/three.module.js')).status, 200)
	for (const p of ['/game/sk/kit/..%2f..%2fserver%2fsk-kit.js', '/game/sk/kit/%2e%2e/%2e%2e/register.js', '/game/sk/../rc-game/server/rc-game.js',
		'/game/sk/kit/..\\..\\register.js', '/game/sk/%2e%2e/server/sk-game.js', '/game/sk/kit/x%00.js', '/game/sk/kit/%zz.js']) {
		const r = await serveSkStatic(p, {})
		assert.ok(r.status >= 400, `${p} → ${r.status}`)
	}
	assert.equal((await serveSkStatic('/game/sk/kit/net.js', { method: 'POST' })).status >= 400, true, 'GET / HEAD only')
})
