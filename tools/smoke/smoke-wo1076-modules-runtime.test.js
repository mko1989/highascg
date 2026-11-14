'use strict'

/**
 * WO-1076 — external (opt-in, installable) modules at runtime, against a SANDBOX server (own port, own token file,
 * temp module dirs + state file via env; never the box's :4200, ~/.highascg or repo modules/):
 *   discovery from both dir kinds (repo dev checkout + installed), repo copy shadows an installed one, bad manifests /
 *   name mismatches / in-tree names / incompatible core reported and never loaded; boot loads only enabled modules
 *   (a disabled one is never required); POST enable / disable without a restart — the fixture's routes (registry +
 *   handleApi, a Buffer reply with headers, req + query), its public path (auth enforcement ON; only under its own
 *   prefix), its WS echo path, handleStatic + live staticMounts (incl. node_modules/three) answer while enabled and
 *   stop after disable; onBoot / onShutdown run once each; GET /api/modules keeps its shape + `available`; the base
 *   server answers with no modules dirs at all.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1076-rt-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')
const REPO_DIR = path.join(TMP, 'repo-modules')
const HOME_DIR = path.join(TMP, 'home-modules')
const STATE = path.join(TMP, 'modules.json')
process.env.HIGHASCG_MODULES_REPO_DIR = REPO_DIR
process.env.HIGHASCG_MODULES_DIR = HOME_DIR
process.env.HIGHASCG_MODULES_STATE_FILE = STATE

const { routeRequest } = require('../../src/api/router')
const { startHttpServer } = require('../../src/server/http-server')
const moduleRegistry = require('../../src/module-registry')
const loader = require('../../src/module-host/module-loader')
const { compareVersions, satisfiesCore } = require('../../src/module-host/module-manifest')

const FIXTURE = path.join(__dirname, 'fixtures', 'modules', 'echo-fixture')
const PW = 'wo1076-shared-password'
const BEARER = { Authorization: `Bearer ${PW}`, 'Content-Type': 'application/json' }
const ctx = { config: { security: { enforceAuth: true, apiToken: PW } }, log: () => {} }
const probe = () => (globalThis.__wo1076Probe = globalThis.__wo1076Probe || { events: [] })
const count = (ev) => probe().events.filter((e) => e === ev).length

function copyDir(src, dst) {
	fs.mkdirSync(dst, { recursive: true })
	for (const d of fs.readdirSync(src, { withFileTypes: true })) {
		if (d.isDirectory()) copyDir(path.join(src, d.name), path.join(dst, d.name))
		else fs.copyFileSync(path.join(src, d.name), path.join(dst, d.name))
	}
}
function writeModule(root, name, manifest, register = "module.exports = { name: '" + name + "' }\n") {
	fs.mkdirSync(path.join(root, name), { recursive: true })
	fs.writeFileSync(path.join(root, name, 'module.json'), JSON.stringify(manifest))
	fs.writeFileSync(path.join(root, name, 'register.js'), register)
}

let server, port
function req(method, p, { headers = {}, body } = {}) {
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
const post = (p, body) => req('POST', p, { headers: BEARER, body })
const json = (r) => JSON.parse(r.text)

/** Upgrade to `p`: 'open' (101 + echo), or 'none' when nobody answers within `ms`. */
function wsProbe(p, ms = 400) {
	return new Promise((resolve) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${p}`)
		const t = setTimeout(() => (ws.terminate(), resolve('none')), ms)
		ws.on('open', () => ws.send('hi'))
		ws.on('message', (d) => (clearTimeout(t), ws.close(), resolve(String(d))))
		ws.on('error', () => (clearTimeout(t), resolve('error')))
	})
}

test.before(async () => {
	copyDir(FIXTURE, path.join(REPO_DIR, 'echo-fixture'))
	server = startHttpServer({ port: 0, bindAddress: '127.0.0.1', webDir: TMP, routeApi: (m, p, b, r) => routeRequest(m, p, b, ctx, r), log: () => {} })
	await new Promise((r) => server.once('listening', r))
	port = server.address().port
	moduleRegistry.setHttpServer(server, ctx)
})

test.after(async () => {
	for (const n of ['echo-fixture', 'inst-only']) await loader.disableModule(n, ctx).catch(() => {})
	moduleRegistry.setHttpServer(null)
	await new Promise((r) => server.close(r))
	fs.rmSync(TMP, { recursive: true, force: true })
})

test('versions: calver / build stamps / semver compare numerically; ranges', () => {
	assert.equal(compareVersions('2026-11-11_114936', '2026.11.01'), 1)
	assert.equal(compareVersions('2026.05.20', '2026.11.1'), -1)
	assert.equal(compareVersions('1.2.0', '1.2'), 0)
	assert.equal(satisfiesCore('>=2026.11.01', '2026-11-11_114936'), true)
	assert.equal(satisfiesCore('>=2026.11.01 <2027', '2027.01.01'), false)
	assert.equal(satisfiesCore('2099.1.1', '2026.05.20'), false)
	assert.equal(satisfiesCore('', '2026.05.20'), true)
	assert.equal(satisfiesCore('^1.0', '1.0'), false) // not a supported range → incompatible, never loaded
})

test('base server: no modules dirs → GET /api/modules keeps its shape, available []', async () => {
	assert.equal(fs.existsSync(HOME_DIR), false)
	const saved = process.env.HIGHASCG_MODULES_REPO_DIR
	process.env.HIGHASCG_MODULES_REPO_DIR = path.join(TMP, 'does-not-exist')
	try {
		assert.deepEqual(loader.loadEnabledExternalModules(() => {}), [])
		const r = await req('GET', '/api/modules', { headers: BEARER })
		assert.equal(r.status, 200)
		const b = json(r)
		for (const k of ['enabled', 'bundles', 'styles', 'wsNamespaces']) assert.ok(Array.isArray(b[k]), k)
		assert.deepEqual(b.available, [])
	} finally {
		process.env.HIGHASCG_MODULES_REPO_DIR = saved
	}
})

test('discovery: both dir kinds, repo shadows installed, bad entries reported, nothing required while disabled', async () => {
	writeModule(HOME_DIR, 'inst-only', { name: 'inst-only', version: '0.1.0' }, "globalThis.__wo1076InstRequired = true; module.exports = { name: 'inst-only', apiPathPrefixes: ['/api/inst-only'], handleApi: () => ({ status: 200, headers: {}, body: 'inst' }) }\n")
	writeModule(HOME_DIR, 'echo-fixture', { name: 'echo-fixture', version: '0.0.1' }) // shadowed by the repo copy
	writeModule(HOME_DIR, 'wrong-dir', { name: 'other-name', version: '1.0.0' })
	writeModule(HOME_DIR, 'previs', { name: 'previs', version: '1.0.0' }) // an in-tree name
	writeModule(HOME_DIR, 'too-new', { name: 'too-new', version: '1.0.0', requiresCore: '>=2999.1.1' })
	writeModule(HOME_DIR, 'core-claim', { name: 'core-claim', version: '1.0.0' }, "module.exports = { name: 'core-claim', apiPathPrefixes: ['/api/modules'], handleApi: () => null }\n")
	fs.mkdirSync(path.join(HOME_DIR, 'no-manifest'))
	const av = loader.listAvailable()
	const by = Object.fromEntries(av.map((a) => [a.name, a]))
	assert.equal(by['echo-fixture'].source, 'repo')
	assert.equal(by['echo-fixture'].version, '1.2.0')
	assert.equal(by['echo-fixture'].shadowsInstalled, true)
	assert.equal(by['echo-fixture'].enabled, false) // defaultEnabled false: opt-in
	assert.equal(by['inst-only'].source, 'installed')
	assert.match(by['wrong-dir'].error, /does not match directory/)
	assert.match(by.previs.error, /in-tree module name/)
	assert.match(by['no-manifest'].error, /module.json missing/)
	assert.equal(by['too-new'].compatible, false)
	assert.deepEqual(loader.loadEnabledExternalModules(() => {}), [])
	assert.equal(globalThis.__wo1076InstRequired, undefined, 'installed-but-disabled is never required')
	assert.equal(count('require'), 0)
	assert.equal((await post('/api/modules/enable', { name: 'too-new' })).status, 409)
	const cc = await post('/api/modules/enable', { name: 'core-claim' })
	assert.equal(cc.status, 409)
	assert.match(json(cc).error, /core API path/)
	assert.equal(moduleRegistry.isLoaded('core-claim'), false)
	assert.equal((await post('/api/modules/enable', { name: 'nope' })).status, 404)
})

test('boot path: an enabled module in modules.json is loaded by loadEnabledExternalModules', () => {
	fs.writeFileSync(STATE, JSON.stringify({ 'inst-only': { enabled: true } }))
	assert.deepEqual(loader.loadEnabledExternalModules(() => {}), ['inst-only'])
	assert.equal(globalThis.__wo1076InstRequired, true)
	assert.deepEqual(moduleRegistry.externalInfo('inst-only').source, 'installed')
})

test('runtime enable: routes, Buffer reply, public path, WS, static — then disable: all gone', async () => {
	assert.equal((await req('GET', '/api/echo-fixture/ping', { headers: BEARER })).status, 404)
	assert.equal(await wsProbe('/api/echo-fixture/ws'), 'none')
	const en = await post('/api/modules/enable', { name: 'echo-fixture' })
	assert.equal(en.status, 200, en.text)
	assert.equal(json(en).available.find((a) => a.name === 'echo-fixture').loaded, true)
	assert.equal(count('require'), 1)
	assert.equal(count('boot'), 1)
	assert.equal(count('http-attach'), 1)
	assert.deepEqual(JSON.parse(fs.readFileSync(STATE, 'utf8'))['echo-fixture'], { enabled: true })
	// a second enable is a no-op (no second onBoot)
	assert.equal((await post('/api/modules/enable', { name: 'echo-fixture' })).status, 200)
	assert.equal(count('boot'), 1)

	const ping = await req('GET', '/api/echo-fixture/ping?q=hey', { headers: BEARER })
	assert.equal(ping.status, 200)
	assert.deepEqual(json(ping), { pong: true, q: 'hey', version: '1.2.0' })
	const blob = await req('GET', '/api/echo-fixture/blob', { headers: { ...BEARER, 'User-Agent': 'wo1076' } })
	assert.deepEqual([...blob.buf], [0, 1, 2, 255])
	assert.equal(blob.headers['x-echo-ua'], 'wo1076')
	assert.equal(json(await req('POST', '/api/echo-fixture/echo', { headers: BEARER, body: '{"a":1}' })).raw, '{"a":1}')
	// auth: enforcement ON — its public path answers without the password, its other routes do not
	assert.equal((await req('GET', '/api/echo-fixture/public')).status, 200)
	assert.equal((await req('GET', '/api/echo-fixture/ping')).status, 401)
	// …and its publicPaths() saying yes to a CORE path (/api/settings) is ignored: outside its apiPathPrefixes
	assert.equal(moduleRegistry.isPublicPath('GET', '/api/settings'), false)
	assert.equal((await req('GET', '/api/settings')).status, 401)
	assert.equal(await wsProbe('/api/echo-fixture/ws'), 'echo:hi')
	assert.equal((await req('GET', '/echo-fixture-hello')).text, 'hello from handleStatic')
	const page = await req('GET', '/echo-fixture/')
	assert.equal(page.status, 200)
	assert.match(page.text, /echo-fixture static page/)
	assert.equal((await req('GET', '/echo-fixture')).status, 302)
	assert.equal((await req('GET', '/echo-fixture/%2e%2e/module.json')).status, 403)
	assert.equal((await req('GET', '/echo-fixture/../module.json')).status !== 200, true)
	const three = await req('GET', '/echo-fixture/three/three.module.js')
	if (fs.existsSync(path.join(__dirname, '../../node_modules/three/build/three.module.js'))) {
		assert.equal(three.status, 200)
		assert.match(three.headers['content-type'], /javascript/)
	}
	const list = json(await req('GET', '/api/modules', { headers: BEARER }))
	assert.ok(list.enabled.includes('echo-fixture'))

	const dis = await post('/api/modules/disable', { name: 'echo-fixture' })
	assert.equal(dis.status, 200, dis.text)
	assert.equal(count('shutdown'), 1)
	assert.equal(count('http-detach'), 1)
	assert.equal(moduleRegistry.isLoaded('echo-fixture'), false)
	assert.equal((await req('GET', '/api/echo-fixture/ping', { headers: BEARER })).status, 404)
	assert.equal((await req('GET', '/api/echo-fixture/public')).status, 401, 'public only while enabled')
	assert.equal(await wsProbe('/api/echo-fixture/ws'), 'none')
	assert.notEqual((await req('GET', '/echo-fixture-hello')).text, 'hello from handleStatic')
	assert.doesNotMatch((await req('GET', '/echo-fixture/')).text, /echo-fixture static page/)
	assert.deepEqual(JSON.parse(fs.readFileSync(STATE, 'utf8'))['echo-fixture'], { enabled: false })
	assert.equal(Object.keys(require.cache).some((k) => k.startsWith(fs.realpathSync(REPO_DIR))), false, 'module files dropped from require cache')

	// re-enable loads fresh code (a second require) and boots again
	assert.equal((await post('/api/modules/enable', { name: 'echo-fixture' })).status, 200)
	assert.equal(count('require'), 2)
	assert.equal(count('boot'), 2)
	assert.equal(await wsProbe('/api/echo-fixture/ws'), 'echo:hi')
	assert.equal((await post('/api/modules/disable', { name: 'echo-fixture' })).status, 200)
})

test('module POSTs need the API password; bodies are raw JSON strings', async () => {
	assert.equal((await req('POST', '/api/modules/enable', { body: { name: 'echo-fixture' } })).status, 401)
	assert.equal((await req('POST', '/api/modules/install', { body: { path: '/x.tgz' } })).status, 401)
	assert.equal((await req('POST', '/api/modules/uninstall', { body: { name: 'inst-only' } })).status, 401)
	assert.equal((await post('/api/modules/enable', 'not json')).status, 400)
	assert.equal((await post('/api/modules/disable', { name: '../etc' })).status, 400)
})
