'use strict'

/**
 * WO-1076 / WO-1074 — the RC car game is a detachable opt-in module (owner 14.11: "an opt in module that is installed
 * when the user wants it"):
 *  - the core (src/, index.js) names nothing of the game;
 *  - with the module present but not enabled, none of its URLs answer and nothing of it is loaded;
 *  - enable (repo checkout) → state / static page / three / socket answer; disable → they are gone again;
 *  - packed with tools/release/make-module-tarball.js and installed from the tarball into a modules dir OUTSIDE the
 *    repo, the installed copy runs (core files reached through host.requireCore); uninstall removes it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const ROOT = path.join(__dirname, '..', '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1076-rc-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')
const EMPTY_REPO = path.join(TMP, 'repo-modules')
const HOME_DIR = path.join(TMP, 'home-modules')
fs.mkdirSync(EMPTY_REPO)
process.env.HIGHASCG_MODULES_REPO_DIR = path.join(ROOT, 'modules')
process.env.HIGHASCG_MODULES_DIR = HOME_DIR
process.env.HIGHASCG_MODULES_STATE_FILE = path.join(TMP, 'modules.json')

const { routeRequest } = require('../../src/api/router')
const { startHttpServer } = require('../../src/server/http-server')
const moduleRegistry = require('../../src/module-registry')
const { makeModuleTarball } = require('../release/make-module-tarball')

const PW = 'wo1076-rc-password'
const BEARER = { Authorization: `Bearer ${PW}`, 'Content-Type': 'application/json' }
const ctx = { config: { security: { enforceAuth: true, apiToken: PW } }, log: () => {} }
const loaded = () => Object.keys(require.cache).filter((f) => f.includes(`${path.sep}rc-game${path.sep}`))

let server, port
function req(method, p, { headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
		})
		r.on('error', reject)
		if (body !== undefined) r.write(JSON.stringify(body))
		r.end()
	})
}
const post = (p, body) => req('POST', p, { headers: BEARER, body })
/** First message (or close code) of a game socket. */
function wsFirst() {
	return new Promise((resolve) => {
		const s = new WebSocket(`ws://127.0.0.1:${port}/api/game/rc/ws`)
		const t = setTimeout(() => (s.terminate(), resolve({ silent: true })), 700)
		s.on('message', (d) => (clearTimeout(t), s.close(), resolve({ msg: JSON.parse(String(d)) })))
		s.on('error', () => (clearTimeout(t), resolve({ error: true })))
		s.on('unexpected-response', (_r, res) => (clearTimeout(t), resolve({ status: res.statusCode })))
	})
}
async function gone(label) {
	assert.equal((await req('GET', '/api/game/rc/state')).status, 401, `${label}: state is not public`)
	assert.equal((await req('GET', '/api/game/rc/state', { headers: BEARER })).status, 404, `${label}: no state route`)
	assert.equal((await post('/api/game/rc/host', { action: 'enable' })).status, 404, `${label}: no host route`)
	assert.notEqual((await req('GET', '/game/rc/main.js')).status, 200, `${label}: no game page`)
	const w = await wsFirst()
	assert.ok(!w.msg, `${label}: no game socket (${JSON.stringify(w)})`)
}
async function works(label, dirPart) {
	const st = await req('GET', '/api/game/rc/state')
	assert.equal(st.status, 200, `${label}: state is public`)
	assert.deepEqual(JSON.parse(st.text), { enabled: false }, `${label}: module on, no session yet`)
	assert.equal((await req('GET', '/api/game/rc/scene')).status, 401, `${label}: scene stays closed until a host starts a session`)
	const page = await req('GET', '/game/rc/')
	assert.equal(page.status, 200, label)
	assert.match(page.text, /<canvas|<script/, label)
	assert.equal((await req('GET', '/game/rc/main.js')).status, 200, label)
	const three = await req('GET', '/vendor/three/build/three.module.js')
	assert.equal(three.status, 200, `${label}: three from the core's node_modules`)
	assert.deepEqual((await wsFirst()).msg, { t: 'off' }, `${label}: socket answers "off" (no session)`)
	assert.ok(loaded().length > 3 && loaded().every((f) => f.includes(dirPart)), `${label}: loaded from ${dirPart}`)
}

test.before(async () => {
	server = startHttpServer({ port: 0, bindAddress: '127.0.0.1', webDir: TMP, routeApi: (m, p, b, r) => routeRequest(m, p, b, ctx, r), log: () => {} })
	await new Promise((r) => server.once('listening', r))
	port = server.address().port
	moduleRegistry.setHttpServer(server, ctx)
})
test.after(async () => {
	await post('/api/modules/disable', { name: 'rc-game' }).catch(() => {})
	moduleRegistry.setHttpServer(null)
	await new Promise((r) => server.close(r))
	fs.rmSync(TMP, { recursive: true, force: true })
})

test('the core names nothing of the game', () => {
	const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []))
	for (const f of [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'index.js')]) {
		const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
		assert.doesNotMatch(code, /rc-game|routes-rc-game|game\/rc|\/api\/game\b|attachRcGameWs|isRcPublicPath|serveRcStatic/, path.relative(ROOT, f))
	}
	assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'game')) && !fs.existsSync(path.join(ROOT, 'game')))
	const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'rc-game', 'module.json'), 'utf8'))
	assert.equal(m.name, 'rc-game')
	assert.ok(m.defaultEnabled !== true, 'opt-in')
})

test('checkout: present but not enabled → nothing answers, nothing loaded; enable → works; disable → gone', async () => {
	const list = JSON.parse((await req('GET', '/api/modules', { headers: BEARER })).text)
	const row = list.available.find((a) => a.name === 'rc-game')
	assert.ok(row && row.enabled === false && row.loaded === false && row.source === 'repo', JSON.stringify(row))
	assert.deepEqual(loaded(), [])
	await gone('not enabled')
	assert.deepEqual(loaded(), [], 'asking for its URLs loads nothing')

	assert.equal((await req('POST', '/api/modules/enable', { headers: { 'Content-Type': 'application/json' }, body: { name: 'rc-game' } })).status, 401, 'enable needs the password')
	const en = await post('/api/modules/enable', { name: 'rc-game' })
	assert.equal(en.status, 200, en.text)
	await works('enabled', `${path.sep}modules${path.sep}rc-game${path.sep}`)

	const dis = await post('/api/modules/disable', { name: 'rc-game' })
	assert.equal(dis.status, 200, dis.text)
	await gone('disabled')
	assert.deepEqual(loaded(), [], 'its files left the require cache')
})

test('packed and installed outside the repo: the installed copy runs; uninstall removes it', async () => {
	const out = path.join(TMP, 'dist')
	const built = makeModuleTarball('rc-game', { out })
	const tgz = built.tgz
	assert.ok(tgz && fs.statSync(tgz).size > 100_000, JSON.stringify(built))
	process.env.HIGHASCG_MODULES_REPO_DIR = EMPTY_REPO // a box without the checkout copy
	try {
		assert.ok(!JSON.parse((await req('GET', '/api/modules', { headers: BEARER })).text).available.some((a) => a.name === 'rc-game'), 'not installed')
		await gone('not installed')
		const ins = await post('/api/modules/install', { path: tgz, name: 'rc-game' })
		assert.equal(ins.status, 200, ins.text)
		assert.equal(JSON.parse(ins.text).sha256Source, 'sidecar', 'the sidecar .sha256 was checked (WO-1106 B8: matched, not "verified")')
		assert.ok(fs.existsSync(path.join(HOME_DIR, 'rc-game', 'module.json')))
		await works('installed', HOME_DIR)
		const un = await post('/api/modules/uninstall', { name: 'rc-game' })
		assert.equal(un.status, 200, un.text)
		assert.ok(!fs.existsSync(path.join(HOME_DIR, 'rc-game')))
		await gone('uninstalled')
	} finally {
		process.env.HIGHASCG_MODULES_REPO_DIR = path.join(ROOT, 'modules')
	}
})
