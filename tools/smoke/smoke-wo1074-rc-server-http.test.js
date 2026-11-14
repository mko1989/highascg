'use strict'

/**
 * WO-1074 — RC game server paths against a SANDBOX server (own port, own token file, synthetic project, temp scene
 * cache — never the box's node): the auth matrix with enforcement ON (enabled vs disabled; neighbouring paths stay
 * protected), the static /game/rc files and the three files the page imports, and the game socket end to end — join,
 * full at the 11th player, a spectator, car state relay, countdown, laps, results, kick (4409), disable (`off` + 4403).
 * And the game never puts anything on a screen: src/game/ and the route reference no AMCP / scene-take / look code.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const zlib = require('zlib')
const WebSocket = require('ws')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1074-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token') // never the box's .private/api-token

const auth = require('../../src/server/auth')
const { routeRequest } = require('../../src/api/router')
const { startHttpServer } = require('../../src/server/http-server')
const { attachWebSocketServer } = require('../../src/server/ws-server')
const { createRcGame, useRcGame } = require('../../src/game/rc-game')
const { attachRcGameWs, isGamePath, WS_PATH } = require('../../src/game/rc-ws')
const { isRcGameEnabled, setRcGameEnabled } = require('../../src/game/rc-public')
const { serveRcStatic } = require('../../src/game/rc-static')
const { COUNTDOWN_MS } = require('../../src/game/rc-room')

const ROOT = path.join(__dirname, '..', '..')
const PW = 'wo1074-shared-password'
const BEARER = { Authorization: `Bearer ${PW}` }
const ctx = { config: { security: { enforceAuth: true, apiToken: PW }, caspar: { host: '127.0.0.1', port: 5250 } }, log: () => {} }

let t0 = 1_000_000
const timers = new Map()
let seq = 0
const clock = {
	now: () => t0,
	timers: {
		setTimeout: (fn, ms) => (timers.set(++seq, { fn, at: t0 + ms, every: 0 }), seq),
		setInterval: (fn, ms) => (timers.set(++seq, { fn, at: t0 + ms, every: ms }), seq),
		clearTimeout: (id) => timers.delete(id),
		clearInterval: (id) => timers.delete(id),
	},
	advance(ms) {
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
	},
}

let server, port, ws, rcWs, game
test.before(async () => {
	server = startHttpServer({ port: 0, bindAddress: '127.0.0.1', webDir: TMP, routeApi: (m, p, b, req) => routeRequest(m, p, b, ctx, req), log: () => {} })
	await new Promise((r) => server.once('listening', r))
	port = server.address().port
	game = createRcGame({ now: clock.now, timers: clock.timers, port: () => port, lanIps: () => ['192.0.2.7'],
		// scale 1: the v2 sizes this end-to-end run measures laps against (the toy scale is smoke-wo1074-rc-server-toy*)
		bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null }, cacheDir: path.join(TMP, 'cache'), scale: 1 } })
	useRcGame(game)
	ws = attachWebSocketServer(server, ctx, { log: () => {} })
	rcWs = attachRcGameWs(server, ctx, { game })
})

test.after(() => {
	game?.disable()
	useRcGame(null)
	setRcGameEnabled(false)
	auth.setAuthRuntime({ enforceAuth: false })
	rcWs?.close()
	try {
		ws?.close?.()
	} catch {}
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
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks), body: Buffer.concat(chunks).toString('utf8') }))
		})
		r.on('error', reject)
		r.end(data || undefined)
	})
}
const get = (p, headers) => req('GET', p, { headers })
const host = (body, headers = BEARER) => req('POST', '/api/game/rc/host', { headers, body })

/** A socket client: every message kept; next(pred) waits for the first unseen match. */
function client(p = WS_PATH) {
	const sock = new WebSocket(`ws://127.0.0.1:${port}${p}`)
	const c = { sock, msgs: [], seen: 0, waiters: [], closed: null }
	const poke = () => {
		for (const w of [...c.waiters]) {
			const i = c.msgs.findIndex((m, k) => k >= w.from && w.pred(m))
			if (i >= 0) {
				c.waiters.splice(c.waiters.indexOf(w), 1)
				w.resolve(c.msgs[i])
			}
		}
	}
	sock.on('message', (d) => {
		c.msgs.push(JSON.parse(String(d)))
		poke()
	})
	c.closing = new Promise((r) => sock.on('close', (code) => r((c.closed = code))))
	c.open = new Promise((r, j) => (sock.once('open', r), sock.once('error', j)))
	c.next = (pred, from = 0, ms = 3000) => new Promise((resolve, reject) => {
		const w = { pred: typeof pred === 'string' ? (m) => m.t === pred : pred, from, resolve }
		c.waiters.push(w)
		poke()
		setTimeout(() => reject(new Error(`timeout waiting for ${pred}`)), ms).unref()
	})
	c.send = (m) => sock.send(JSON.stringify(m))
	/** Round trip: everything sent before has been handled by the server. */
	c.sync = async () => {
		const n = c.msgs.length
		const tag = Math.random()
		c.send({ t: 'ping', c: tag })
		await c.next((m) => m.t === 'pong' && m.c === tag, n)
	}
	return c
}

test('auth matrix (enforcement ON): disabled → only GET state is public; enabled → state, scene, scene.glb; host never', async () => {
	assert.equal(isRcGameEnabled(), false)
	assert.deepEqual(JSON.parse((await get('/api/game/rc/state')).body), { enabled: false })
	for (const p of ['/api/game/rc/scene', '/api/game/rc/scene.glb']) assert.equal((await get(p)).status, 401, p)
	assert.equal((await get('/api/game/rc/scene', BEARER)).status, 403, 'not running')
	assert.equal((await host({ action: 'enable' }, {})).status, 401, 'host without the password')
	assert.equal((await host({ action: 'start' })).status, 409, 'not enabled')
	const en = await host({ action: 'enable' })
	assert.equal(en.status, 200)
	const st = JSON.parse(en.body).state
	assert.equal(st.enabled, true)
	assert.deepEqual(st.joinUrls, [`http://192.0.2.7:${port}/game/rc/`])
	assert.equal(st.phase, 'lobby')
	assert.equal(isRcGameEnabled(), true)
	assert.equal((await get('/api/game/rc/state')).status, 200)
	const scene = await get('/api/game/rc/scene')
	assert.equal(scene.status, 200)
	const sj = JSON.parse(scene.body)
	assert.ok(sj.tracks.length >= 2 && sj.floors.length >= 1 && /^none-[0-9a-f]{10}$/.test(sj.rev))
	const glb = await get('/api/game/rc/scene.glb', { 'Accept-Encoding': 'gzip' })
	assert.equal(glb.status, 200)
	assert.equal(glb.headers['content-type'], 'model/gltf-binary')
	assert.equal(glb.headers['content-encoding'], 'gzip')
	assert.equal(glb.headers['x-rc-rev'], sj.rev)
	assert.equal(zlib.gunzipSync(glb.raw).readUInt32LE(0), 0x46546c67, 'glTF magic')
	assert.match((await get(`/api/game/rc/scene.glb?rev=${sj.rev}`)).headers['cache-control'], /immutable/)
	assert.equal((await get('/api/game/rc/scene.glb?rev=old')).headers['cache-control'], 'no-cache')
	assert.equal((await host({ action: 'start' }, {})).status, 401, 'host stays protected while enabled')
	assert.equal((await host('not an object')).status, 400)
	// neighbouring paths stay protected
	for (const p of ['/api/settings', '/api/game/rc/../settings', '/api/game/rc/state/', '/api/game/rc/statex', '/api/game/rc/scene.json', '/api/game/rc']) {
		assert.equal((await get(p)).status, 401, p)
	}
	assert.equal((await req('POST', '/api/game/rc/state', { body: {} })).status, 401, 'POST on a public GET path')
	assert.equal((await req('POST', '/api/game/rc/scene', { body: {} })).status, 401)
	const apiWs = await new Promise((resolve) => {
		const s = new WebSocket(`ws://127.0.0.1:${port}/api/ws`)
		s.on('open', () => (s.close(), resolve('open')))
		s.on('unexpected-response', (_q, res) => resolve(res.statusCode))
		s.on('error', () => resolve('error'))
	})
	assert.equal(apiWs, 401, '/api/ws still needs the password')
	assert.ok(isGamePath('/instance/x/api/game/rc/ws') && !isGamePath('/api/game/rc/wsx'))
	// back to disabled: the scene is protected again
	assert.equal((await host({ action: 'disable' })).status, 200)
	assert.equal((await get('/api/game/rc/scene')).status, 401)
	assert.deepEqual(JSON.parse((await get('/api/game/rc/state')).body), { enabled: false })
})

test('static /game/rc and the three files: redirect, MIME types, traversal refused, GET only, public', async () => {
	const r = await get('/game/rc?spectate=1')
	assert.equal(r.status, 302)
	assert.equal(r.headers.location, '/game/rc/?spectate=1')
	const index = await get('/game/rc/')
	assert.equal(index.status, 200, 'public without the password')
	assert.match(index.headers['content-type'], /^text\/html/)
	assert.match((await get('/game/rc/main.js')).headers['content-type'], /^application\/javascript/)
	assert.match((await get('/game/rc/rc.css')).headers['content-type'], /^text\/css/)
	assert.match((await get('/game/rc/package.json')).headers['content-type'], /^application\/json/)
	for (const p of ['/game/rc/../../package.json', '/game/rc/%2e%2e/%2e%2e/package.json', '/game/rc/a/../main.js', '/game/rc/%5c..%5cindex.html',
		'/vendor/three/build/../package.json', '/vendor/three/examples/jsm/%2e%2e/%2e%2e/package.json']) {
		assert.equal((await get(p)).status, 403, p)
	}
	assert.equal((await get('/game/rc/nope.exe')).status, 404)
	assert.equal((await get('/game/rc/missing.js')).status, 404)
	assert.equal((await req('POST', '/game/rc/', { body: {} })).status, 405)
	const three = await get('/vendor/three/build/three.module.js')
	assert.equal(three.status, 200, 'served without the previs module (no vendorDirs in this server)')
	assert.match(three.headers['content-type'], /^application\/javascript/)
	assert.equal((await get('/vendor/three/examples/jsm/loaders/GLTFLoader.js')).status, 200)
	assert.equal((await get('/vendor/three/examples/jsm/utils/BufferGeometryUtils.js')).status, 200)
	assert.equal((await get('/vendor/three/package.json')).status, 404, 'only build/ and examples/jsm/')
	// a symlink out of the game directory is refused
	const root = path.join(TMP, 'root')
	fs.mkdirSync(root)
	fs.writeFileSync(path.join(TMP, 'secret.json'), '{}')
	fs.symlinkSync(path.join(TMP, 'secret.json'), path.join(root, 'link.json'))
	fs.writeFileSync(path.join(root, 'ok.json'), '{}')
	assert.equal((await serveRcStatic('/game/rc/link.json', { root })).status, 403)
	assert.equal((await serveRcStatic('/game/rc/ok.json', { root })).status, 200)
	assert.equal((await serveRcStatic('/game/rc/%00.json', { root })).status, 403)
})

async function joinAll(n) {
	const cs = []
	for (let i = 0; i < n; i++) {
		const c = client()
		await c.open
		c.send({ t: 'join', name: `P${i}`, color: '#00ff00' })
		c.welcome = await c.next('welcome')
		cs.push(c)
	}
	return cs
}

test('game socket end to end: join, full, spectator, relay, countdown, laps, results, kick 4409, disable 4403', { timeout: 30000 }, async () => {
	// disabled: accepted only to say `off` and close 4403
	const early = client()
	assert.deepEqual(await early.next('off'), { t: 'off' })
	assert.equal(await early.closing, 4403)
	assert.equal((await host({ action: 'enable' })).status, 200)
	const sj = (await game.scene()).json
	const cs = await joinAll(10)
	assert.deepEqual(cs.map((c) => c.welcome.you.slot), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
	const extra = client()
	await extra.open
	extra.send({ t: 'join', name: 'eleventh' })
	assert.deepEqual(await extra.next('full'), { t: 'full' })
	const spec = client()
	await spec.open
	spec.send({ t: 'join', name: 'watcher', spectator: true })
	const sw = await spec.next('welcome')
	assert.equal(sw.you.spectator, true)
	assert.equal(sw.state.players.length, 10)
	assert.equal(sw.state.spectators, 1)
	// eight players leave in the lobby → two left
	for (const c of [extra, ...cs.slice(2)]) c.sock.close()
	const [A, B] = cs
	await A.next((m) => m.t === 'state' && m.state.players.length === 2)
	const track = sj.tracks[0]
	assert.equal((await host({ action: 'track', trackId: track.id })).status, 200)
	assert.equal((await host({ action: 'laps', laps: 1 })).status, 200)
	assert.equal((await host({ action: 'laps', laps: 0 })).status, 400)
	const before = clock.now()
	const st = JSON.parse((await host({ action: 'start' })).body).state
	assert.equal(st.phase, 'countdown')
	assert.equal(st.startAt, before + COUNTDOWN_MS, 'startAt in the state for late joiners')
	assert.equal((await A.next('countdown')).startAt, before + COUNTDOWN_MS)
	assert.equal((await host({ action: 'track', trackId: track.id })).status, 409, 'no track change during a race')
	clock.advance(COUNTDOWN_MS)
	assert.equal(game.state().phase, 'race')
	const [x, y, z] = track.points[0] // v2: [x, y, z]
	const sync = () => Promise.all([A.sync(), B.sync(), spec.sync()])
	// relay: A's car reaches B and the spectator in the world snapshot
	const nB = B.msgs.length
	A.send({ t: 's', p: [x, y, z], yaw: 0.5, v: 2, st: -0.25, cp: 0, lap: 0 })
	await sync()
	clock.advance(70)
	const w = await B.next((m) => m.t === 'w' && m.cars.some((c) => c[0] === A.welcome.id), nB)
	const car = w.cars.find((c) => c[0] === A.welcome.id) // [id, x, y, z, yaw, v, st, fx]
	assert.deepEqual([car[1], car[3], car[6]], [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000, -0.25])
	await spec.next((m) => m.t === 'w', 0)
	// laps: checkpoints in order, never faster than length / 24 m/s
	const K = track.checkpoints.length
	const minLap = (track.length / 24) * 1000
	const lap = async (c) => {
		for (let cp = 1; cp < K; cp++) {
			clock.advance(200)
			c.send({ t: 's', p: [x, y, z], yaw: 0, v: 3, st: 0, cp, lap: 0 })
			await sync()
		}
		clock.advance(minLap)
		c.send({ t: 's', p: [x, y, z], yaw: 0, v: 3, st: 0, cp: 0, lap: 1 })
		await sync()
	}
	await lap(A)
	const l = await B.next((m) => m.t === 'lap' && m.id === A.welcome.id)
	assert.equal(l.lap, 1)
	assert.ok(l.ms >= minLap)
	await lap(B)
	const res = await A.next('results')
	assert.equal(res.final, true)
	assert.deepEqual(res.order.map((r) => r.id), [A.welcome.id, B.welcome.id])
	assert.equal(game.state().phase, 'results')
	// kick
	assert.equal((await host({ action: 'kick', id: B.welcome.id })).status, 200)
	assert.equal(await B.closing, 4409)
	assert.equal((await host({ action: 'kick', id: 999 })).status, 404)
	// disable: every game socket gets `off` and 4403
	assert.equal((await host({ action: 'disable' })).status, 200)
	assert.ok(await A.next('off'))
	assert.equal(await A.closing, 4403)
	assert.equal(await spec.closing, 4403)
	assert.equal(game.socketCount(), 0)
	assert.equal(isRcGameEnabled(), false)
	const late = client()
	await late.next('off')
	assert.equal(await late.closing, 4403)
})

test('bad frames: over 2 KB closes the socket, invalid JSON is dropped and counted', async () => {
	assert.equal((await host({ action: 'enable' })).status, 200)
	const c = client()
	await c.open
	c.sock.send('x'.repeat(4096))
	assert.equal(await c.closing, 1009, 'ws maxPayload 2048')
	const d = client()
	await d.open
	for (let i = 0; i < 25; i++) d.sock.send('{not json')
	assert.equal(await d.closing, 1008, 'closed after 20 invalid messages')
	assert.equal((await host({ action: 'disable' })).status, 200)
})

test('the game never puts anything on a screen: no AMCP, scene-take, look or channel code in src/game/ or the route', () => {
	const files = [...fs.readdirSync(path.join(ROOT, 'src/game')).map((f) => `src/game/${f}`), 'src/api/routes-rc-game.js']
	assert.ok(files.length >= 10)
	const allowed = /^(\.\/rc-[a-z-]+|\.\/response|\.\.\/game\/rc-game|\.\.\/stage\/(mvr-store|glb-write)|\.\.\/engine\/project-scenes|\.\.\/utils\/lan-ipv4|\.\.\/server\/(auth|security-headers)|\.\.\/repo-paths|ws|crypto|fs|os|path|zlib)$/
	/* §2.6 — per FILE, exactly these extra modules: the previs pose maths (gdtf-ik), the GDTF cache (gdtf-store) and the
	   patch normaliser (follow-patch) for the lights — all read-only; node's EventEmitter (the in-process feed client's
	   shape), the cached channel map + INFO CONFIG rasters (pixel-map-service.liveChannelMap: config and cached text,
	   no AMCP) and the video-surface manager for the pictures. That manager's role lease is the ONE way the game reaches
	   Caspar: it adds a read-only SHM consumer (the same lease the Godot camera view and the feed use) — so rc-video.js
	   may call only `resolveRoleChannel` and `getVideoSurfaceManager(ctx).lease`, and no file here holds an AMCP verb. */
	const extra = {
		'src/game/rc-lights-fk.js': ['../fixtures/gdtf-ik'],
		'src/game/rc-lights.js': ['../fixtures/gdtf-store', '../fixtures/follow-patch'],
		'src/game/rc-video.js': ['events', '../fixtures/pixel-map-service', '../system/video-surfaces'],
	}
	const use = {
		'../fixtures/pixel-map-service': /^\.liveChannelMap\(ctx\)/,
		'../system/video-surfaces': /^(\.resolveRoleChannel\(role, map\)|\.getVideoSurfaceManager\(ctx\)\.lease\(id, roles\))/,
	}
	const seen = new Set()
	for (const f of files) {
		const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
		const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
		for (const m of code.matchAll(/require\(\s*'([^']+)'\s*\)/g)) {
			if (allowed.test(m[1])) continue
			assert.ok((extra[f] || []).includes(m[1]), `${f} requires ${m[1]}`)
			seen.add(`${f} ${m[1]}`)
			if (use[m[1]]) assert.match(code.slice(m.index + m[0].length), use[m[1]], `${f}: only the listed call on ${m[1]}`)
		}
		// the route registry's `requireCaspar: false` (these routes work with Caspar down) is the one allowed mention
		assert.doesNotMatch(code.replace(/requireCaspar: false/g, ''), /amcp|caspar|scene[-_]?take|sceneTake|takeLook|\blooks?\b|\bchannels?\b|playout|LOADBG|MIXER|\bCG ADD|\bPLAY\s/i, f)
		// AMCP verbs with a channel number / template, and Caspar's SHM consumer, are never spelled out in the game
		assert.doesNotMatch(code, /\bSHM\b|\b(ADD|REMOVE|LOAD|CLEAR|CALL|SWAP|STOP|RESUME|PAUSE)\s+(\d|\$\{)/, f)
		// ("layer" is allowed: in src/game it only ever means an MVR layer — hidden_layers / layer_colors; the require
		// allow-list above is what keeps Caspar, AMCP, looks and channel code out)
	}
	assert.deepEqual([...seen].sort(), Object.entries(extra).flatMap(([f, ms]) => ms.map((m) => `${f} ${m}`)).sort(), 'no stale extra')
	const route = fs.readFileSync(path.join(ROOT, 'src/api/routes-rc-game.js'), 'utf8')
	assert.deepEqual([...route.matchAll(/routes\.(get|post)\('([^']+)'/g)].map((m) => m[2]),
		['/api/game/rc/state', '/api/game/rc/scene', '/api/game/rc/scene.glb', '/api/game/rc/host'], 'no route that shows the game on a wall')
})
