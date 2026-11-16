'use strict'

/**
 * WO-1101 — the Game World module's edges (modules/game-world):
 *   - static /game/world/*: 302 to the slash, index.html, only .html / .js / .mjs / .css, MIME, no-cache, GET / HEAD only,
 *     traversal (plain, encoded, backslash, NUL) and symlinks out of the directory refused
 *   - the world socket /api/game/world/ws on a sandbox HTTP server (own port, never the box's node): `off` + 4403 while
 *     no game runs, `hello` + hub traffic while one does, the /instance/<id> prefix, the Origin check, ≤ 20 sockets
 *   - the module boundary: no file of the world module requires a game module, and nothing in src/ or index.js names
 *     the world; every file keeps the 500-line limit
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const ROOT = path.join(__dirname, '..', '..')
const MOD = path.join(ROOT, 'modules', 'game-world')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1101-static-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')

const { serveWorldStatic, isWorldStaticPath } = require('../../modules/game-world/server/world-static')
const { attachWorldWs, isWorldWsPath, MAX_SOCKETS } = require('../../modules/game-world/server/world-ws')
const { createHub } = require('../../modules/game-world/server/world-hub')

/* ---------------- static ---------------- */

const SITE = path.join(TMP, 'client')
const OUTSIDE = path.join(TMP, 'outside')
fs.mkdirSync(path.join(SITE, 'sub'), { recursive: true })
fs.mkdirSync(OUTSIDE)
fs.writeFileSync(path.join(SITE, 'index.html'), '<!doctype html><title>World</title>')
fs.writeFileSync(path.join(SITE, 'app.js'), 'export const a = 1')
fs.writeFileSync(path.join(SITE, 'm.mjs'), 'export const m = 1')
fs.writeFileSync(path.join(SITE, 'sub', 's.css'), 'body{}')
fs.writeFileSync(path.join(SITE, 'data.json'), '{}')
fs.writeFileSync(path.join(SITE, 'x.png'), 'png')
fs.writeFileSync(path.join(OUTSIDE, 'secret.js'), 'secret')
fs.symlinkSync(path.join(OUTSIDE, 'secret.js'), path.join(SITE, 'link.js'))
fs.symlinkSync(OUTSIDE, path.join(SITE, 'out'))
const get = (p, method = 'GET') => serveWorldStatic(p, { root: SITE, method, query: '?host=1' })

test('static: redirect, index, MIME, no-cache, GET / HEAD only', async () => {
	let r = await get('/game/world')
	assert.deepEqual([r.status, r.headers.Location], [302, '/game/world/?host=1'])
	r = await get('/game/world/')
	assert.equal(r.status, 200)
	assert.equal(r.headers['Content-Type'], 'text/html; charset=utf-8')
	assert.match(r.headers['Cache-Control'], /no-cache/)
	assert.match(String(r.body), /World/)
	assert.equal((await get('/game/world/app.js')).headers['Content-Type'], 'application/javascript; charset=utf-8')
	assert.equal((await get('/game/world/m.mjs')).headers['Content-Type'], 'application/javascript; charset=utf-8')
	assert.equal((await get('/game/world/sub/s.css')).headers['Content-Type'], 'text/css; charset=utf-8')
	assert.equal((await get('/game/world/data.json')).status, 404, 'only .html / .js / .mjs / .css')
	assert.equal((await get('/game/world/x.png')).status, 404)
	assert.equal((await get('/game/world/nope.js')).status, 404)
	assert.equal((await get('/game/world/sub/')).status, 404, 'no index in sub/')
	assert.equal((await get('/game/world/app.js', 'POST')).status, 405)
	const head = await get('/game/world/app.js', 'HEAD')
	assert.deepEqual([head.status, head.body], [200, ''])
	assert.equal(isWorldStaticPath('/game/worldx'), false)
	assert.equal(isWorldStaticPath('/game/world/a.js'), true)
	// the real directory: the shared codec is served
	const real = await serveWorldStatic('/game/world/world-wire.js', {})
	assert.equal(real.status, 200)
	assert.equal((await serveWorldStatic('/game/world/package.json', {})).status, 404)
})

test('static: traversal and symlinks out of the directory are refused', async () => {
	for (const p of ['/game/world/../outside/secret.js', '/game/world/%2e%2e/outside/secret.js', '/game/world/%2E%2E%2Foutside%2Fsecret.js', '/game/world/sub/..%2f..%2foutside%2fsecret.js', '/game/world/..%5coutside%5csecret.js', '/game/world/app.js%00.html', '/game/world/./app.js', '/game/world//etc/passwd.js', '/game/world/%2Fetc%2Fpasswd.js']) {
		const r = await get(p)
		assert.ok(r.status === 403 || r.status === 400, `${p} → ${r.status}`)
	}
	assert.notEqual((await get('/game/world/%252e%252e/outside/secret.js')).status, 200, 'decoded once only')
	assert.equal((await get('/game/world/link.js')).status, 403, 'symlink to a file outside')
	assert.equal((await get('/game/world/out/secret.js')).status, 403, 'symlinked directory outside')
	assert.equal((await get('/game/world/%E0%A4%A.js')).status, 400, 'bad escape')
})

/* ---------------- world socket ---------------- */

let server, port, wsh, hub, reg, svc
const enabled = { on: false }
test.before(async () => {
	reg = { v: 1, games: new Map(), hub: null }
	reg.games.set('rc', { id: 'rc', title: 'RC', room: () => (enabled.on ? { id: 'rc' } : null), host: () => ({ status: 200, body: {} }) })
	hub = createHub({ registry: reg, timers: { setInterval: () => 1, clearInterval: () => {} }, now: () => 5000, defer: (fn) => fn() })
	svc = { state: () => ({ on: enabled.on, v: 1, games: [] }) }
	server = http.createServer((q, s) => s.end('x'))
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	port = server.address().port
	const ctx = { config: { security: { enforceAuth: true, apiToken: 'pw' } } }
	wsh = attachWorldWs(server, ctx, { hub, service: svc, registry: reg })
})
test.after(() => {
	wsh.close()
	hub.dispose()
	server.close()
})

function open(p = '/api/game/world/ws', headers = {}) {
	return new Promise((resolve) => {
		const s = new WebSocket(`ws://127.0.0.1:${port}${p}`, { headers })
		const got = []
		s.on('message', (d) => got.push(JSON.parse(String(d))))
		s.on('close', (code) => resolve({ s, got, code }))
		s.on('unexpected-response', (_q, res) => resolve({ s, got, status: res.statusCode }))
		s.on('open', () => setTimeout(() => resolve({ s, got, open: true }), 50))
		s.on('error', () => {})
	})
}

test('world socket: no game running → off + 4403', async () => {
	enabled.on = false
	const r = await open()
	assert.deepEqual(r.got, [{ t: 'off' }])
	assert.equal(r.code, 4403)
})

test('world socket: a game running → hello, then the hub feeds it (board, wst / wv); /instance prefix; Origin check', async () => {
	enabled.on = true
	const r = await open()
	assert.equal(r.open, true)
	assert.deepEqual(r.got[0], { t: 'hello', v: 1, state: { on: true, v: 1, games: [] } })
	assert.equal(hub.stats().worldPages, 1)
	assert.equal(hub.running(), true, 'a world page runs the tick')
	for (let i = 0; i < 5; i++) hub.tick()
	await new Promise((res) => setTimeout(res, 50))
	assert.ok(r.got.some((m) => m.t === 'board'))
	r.s.close()
	await new Promise((res) => setTimeout(res, 50))
	assert.equal(hub.stats().worldPages, 0)
	assert.equal(hub.running(), false)
	const inst = await open('/instance/abc/api/game/world/ws')
	assert.equal(inst.open, true)
	inst.s.close()
	const bad = await open('/api/game/world/ws', { Origin: 'http://evil.example' })
	assert.equal(bad.status, 403)
	const same = await open('/api/game/world/ws', { Origin: `http://127.0.0.1:${port}` })
	assert.equal(same.open, true)
	same.s.close()
	assert.equal(isWorldWsPath('/api/game/world/wsx'), false)
	assert.equal(isWorldWsPath('/api/game/rc/ws'), false)
})

test(`world socket: at most ${MAX_SOCKETS} sockets`, async () => {
	enabled.on = true
	const socks = []
	for (let i = 0; i < MAX_SOCKETS; i++) socks.push(await open())
	assert.ok(socks.every((x) => x.open))
	const full = await open()
	assert.equal(full.status, 503)
	for (const x of socks) x.s.close()
	await new Promise((res) => setTimeout(res, 100))
	assert.equal(wsh.count(), 0)
})

/* ---------------- module boundary ---------------- */

function walk(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue
		const p = path.join(dir, e.name)
		if (e.isDirectory()) walk(p, out)
		else out.push(p)
	}
	return out
}

test('boundary: no world file requires / imports a game module; src/ and index.js never name the world', () => {
	const GAME = /(rc-game|toy-skirmish|stage-salad)/
	for (const f of walk(MOD).filter((x) => /\.(m?js)$/.test(x))) {
		const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // code, not comments
		const specs = [...src.matchAll(/require\(\s*['"`]([^'"`]+)['"`]\s*\)|import\s[^'"`]*['"`]([^'"`]+)['"`]|import\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1] || m[2] || m[3])
		for (const s of specs) assert.ok(!GAME.test(s) && !/\/modules\//.test(s), `${path.relative(ROOT, f)} requires ${s}`)
		assert.ok(!/require\(\s*['"`]\.\.\/\.\.\/(src|modules)/.test(src), `${path.relative(ROOT, f)}: core only through host.core()`)
	}
	for (const f of [...walk(path.join(ROOT, 'src')).filter((x) => x.endsWith('.js')), path.join(ROOT, 'index.js')]) {
		assert.ok(!/game-world|highascg\.game-world/.test(fs.readFileSync(f, 'utf8')), `${path.relative(ROOT, f)} names the world`)
	}
})

test('boundary: every server file of the world module keeps the 500-line limit', () => {
	for (const f of [...walk(path.join(MOD, 'server')), path.join(MOD, 'register.js')].filter((x) => x.endsWith('.js'))) {
		const n = fs.readFileSync(f, 'utf8').split('\n').length
		assert.ok(n <= 500, `${path.relative(ROOT, f)}: ${n} lines`)
	}
})
