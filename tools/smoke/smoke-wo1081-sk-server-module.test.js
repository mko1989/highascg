'use strict'

/**
 * WO-1081 — Stage Skirmish is an opt-in module (docs/MODULES.md) that reuses the RC game's world code through its kit
 * (server/sk-kit.js) — the sibling `rc-game` must be INSTALLED, not enabled:
 *  - through the real module host and API server (sandbox: own port, own token file, temp module state): present but
 *    not enabled → none of its URLs answer, nothing loaded; enable → state / page / kit alias / three / socket answer and
 *    the auth matrix holds (state public, scene public only while a session runs, host never); disable → all gone and
 *    its files (and the kit's RC files it loaded) leave the require cache;
 *  - without the sibling the module refuses to load with a clear message;
 *  - the game never touches Caspar: its server files require only their own files, the kit, and a few named core files,
 *    and name nothing of AMCP / looks / layers / project or config writes;
 *  - every file of the module (server and client) keeps the 500-line limit.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const ROOT = path.join(__dirname, '..', '..')
const MOD = path.join(ROOT, 'modules', 'toy-skirmish')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1081-mod-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')
process.env.HIGHASCG_MODULES_REPO_DIR = path.join(ROOT, 'modules')
process.env.HIGHASCG_MODULES_DIR = path.join(TMP, 'home-modules')
process.env.HIGHASCG_MODULES_STATE_FILE = path.join(TMP, 'modules.json')
fs.mkdirSync(process.env.HIGHASCG_MODULES_DIR)

const { routeRequest } = require('../../src/api/router')
const { startHttpServer } = require('../../src/server/http-server')
const moduleRegistry = require('../../src/module-registry')

const PW = 'wo1081-module-password'
const BEARER = { Authorization: `Bearer ${PW}`, 'Content-Type': 'application/json' }
const ctx = { config: { security: { enforceAuth: true, apiToken: PW } }, log: () => {} }
const inDir = (f, name) => f.includes(`${path.sep}modules${path.sep}${name}${path.sep}`)
const loaded = (name) => Object.keys(require.cache).filter((f) => inDir(f, name))

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
function wsFirst() {
	return new Promise((resolve) => {
		const s = new WebSocket(`ws://127.0.0.1:${port}/api/game/sk/ws`)
		const t = setTimeout(() => (s.terminate(), resolve({ silent: true })), 700)
		s.on('message', (d) => (clearTimeout(t), s.close(), resolve({ msg: JSON.parse(String(d)) })))
		s.on('error', () => (clearTimeout(t), resolve({ error: true })))
		s.on('unexpected-response', (_r, res) => (clearTimeout(t), resolve({ status: res.statusCode })))
	})
}
async function gone(label) {
	assert.equal((await req('GET', '/api/game/sk/state')).status, 401, `${label}: state is not public`)
	assert.equal((await req('GET', '/api/game/sk/state', { headers: BEARER })).status, 404, `${label}: no state route`)
	assert.equal((await post('/api/game/sk/host', { action: 'enable' })).status, 404, `${label}: no host route`)
	assert.notEqual((await req('GET', '/game/sk/protocol.js')).status, 200, `${label}: no game files`)
	assert.notEqual((await req('GET', '/game/sk/kit/net.js')).status, 200, `${label}: no kit alias`)
	assert.ok(!(await wsFirst()).msg, `${label}: no game socket`)
}

test.before(async () => {
	server = startHttpServer({ port: 0, bindAddress: '127.0.0.1', webDir: TMP, routeApi: (m, p, b, r) => routeRequest(m, p, b, ctx, r), log: () => {} })
	await new Promise((r) => server.once('listening', r))
	port = server.address().port
	moduleRegistry.setHttpServer(server, ctx)
})
test.after(async () => {
	await post('/api/modules/disable', { name: 'toy-skirmish' }).catch(() => {})
	moduleRegistry.setHttpServer(null)
	await new Promise((r) => server.close(r))
	fs.rmSync(TMP, { recursive: true, force: true })
})

test('module.json: opt-in, the contract\'s name / version / core requirement', () => {
	const m = JSON.parse(fs.readFileSync(path.join(MOD, 'module.json'), 'utf8'))
	assert.equal(m.name, 'toy-skirmish')
	assert.equal(m.title, 'Stage Skirmish')
	assert.equal(m.version, '1.0.0')
	assert.equal(m.requiresCore, '>=2026.5.20')
	assert.ok(m.defaultEnabled !== true, 'opt-in')
})

test('present but not enabled → nothing; enable → works (auth matrix); disable → gone, require cache clean', async () => {
	const row = JSON.parse((await req('GET', '/api/modules', { headers: BEARER })).text).available.find((a) => a.name === 'toy-skirmish')
	assert.ok(row && row.enabled === false && row.loaded === false, JSON.stringify(row))
	await gone('not enabled')
	assert.deepEqual(loaded('toy-skirmish'), [])
	assert.deepEqual(loaded('rc-game'), [], 'the RC kit is not loaded either')

	const en = await post('/api/modules/enable', { name: 'toy-skirmish' })
	assert.equal(en.status, 200, en.text)
	const st = await req('GET', '/api/game/sk/state')
	assert.equal(st.status, 200, 'state is public')
	assert.deepEqual(JSON.parse(st.text), { enabled: false }, 'module on, no session yet')
	assert.equal((await req('GET', '/api/game/sk/scene')).status, 401, 'the scene stays closed until a session runs')
	assert.equal((await req('POST', '/api/game/sk/host', { headers: { 'Content-Type': 'application/json' }, body: { action: 'enable' } })).status, 401, 'host needs the password')
	assert.equal((await req('GET', '/game/sk/protocol.js')).status, 200)
	assert.equal((await req('GET', '/game/sk/kit/net.js')).status, 200, 'the RC client through the alias')
	assert.equal((await req('GET', '/vendor/three/build/three.module.js')).status, 200, 'three while the RC module is off')
	assert.deepEqual((await wsFirst()).msg, { t: 'off' })
	assert.ok(loaded('toy-skirmish').length > 5)
	assert.ok(loaded('rc-game').length > 3, 'the kit loaded the RC world code')
	assert.ok(!loaded('rc-game').some((f) => f.endsWith(`rc-game${path.sep}register.js`)), 'the RC module itself was not loaded')

	// a session with a sandbox scene (synthetic project, temp cache) — the module's own process-wide game is replaced
	const G = require(path.join(MOD, 'server', 'sk-game.js'))
	G.useSkGame(G.createSkGame({ lanIps: () => ['192.0.2.1'], bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }),
		mvrStore: { get: () => null, mesh: async () => null }, cacheDir: path.join(TMP, 'cache') } }))
	const on = await post('/api/game/sk/host', { action: 'enable' })
	assert.equal(on.status, 200, on.text)
	const sc = await req('GET', '/api/game/sk/scene')
	assert.equal(sc.status, 200, 'public while a session runs')
	assert.ok(JSON.parse(sc.text).arenas.length >= 3)
	assert.equal((await req('GET', '/api/game/sk/scenex')).status, 401, 'exact paths only')
	assert.equal((await req('GET', '/api/game/skx/state')).status, 401)
	assert.deepEqual(await wsFirst(), { silent: true }, 'a running session waits for the join (no `off`; no lights here)')

	const dis = await post('/api/modules/disable', { name: 'toy-skirmish' })
	assert.equal(dis.status, 200, dis.text)
	await gone('disabled')
	assert.deepEqual(loaded('toy-skirmish'), [], 'its files left the require cache')
	assert.deepEqual(loaded('rc-game'), [], 'and so did the kit\'s RC files')
})

test('without the rc-game sibling installed: refuses to load, saying why', async () => {
	const repo = path.join(TMP, 'lonely-repo')
	const dst = path.join(repo, 'toy-skirmish')
	fs.mkdirSync(path.join(dst, 'server'), { recursive: true })
	for (const f of ['module.json', 'register.js']) fs.copyFileSync(path.join(MOD, f), path.join(dst, f))
	for (const f of fs.readdirSync(path.join(MOD, 'server'))) fs.copyFileSync(path.join(MOD, 'server', f), path.join(dst, 'server', f))
	process.env.HIGHASCG_MODULES_REPO_DIR = repo
	try {
		const en = await post('/api/modules/enable', { name: 'toy-skirmish' })
		assert.ok(en.status >= 400, en.text)
		assert.equal(JSON.parse(en.text).error, 'Stage Skirmish needs the "rc-game" module installed')
		const row = JSON.parse((await req('GET', '/api/modules', { headers: BEARER })).text).available.find((a) => a.name === 'toy-skirmish')
		assert.equal(row.loaded, false)
		await gone('no sibling')
	} finally {
		await post('/api/modules/disable', { name: 'toy-skirmish' }).catch(() => {})
		process.env.HIGHASCG_MODULES_REPO_DIR = path.join(ROOT, 'modules')
	}
	const { MISSING } = require('../../modules/toy-skirmish/server/sk-kit')
	assert.equal(MISSING, 'Stage Skirmish needs the "rc-game" module installed')
})

test('the game never touches Caspar: own files, the kit and named core files only; no AMCP / looks / layers / writes', () => {
	const files = [path.join(MOD, 'register.js'), ...fs.readdirSync(path.join(MOD, 'server')).map((f) => path.join(MOD, 'server', f))]
	const CORE_OK = new Set(['ws', 'src/api/response', 'src/server/auth', 'src/utils/lan-ipv4'])
	const KIT_OK = new Set(['host.js', 'rc-scene.js', 'rc-lights.js', 'rc-video.js', 'rc-static.js', 'rc-scene-occ.js', 'rc-scene-height.js', 'rc-sanitize.js', 'rc-resume.js', 'rc-ctl.js'])
	for (const f of files) {
		const rel = path.relative(ROOT, f)
		const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
		for (const [, id] of code.matchAll(/require\(\s*'([^']+)'\s*\)/g)) {
			assert.ok(/^\.\/(server\/)?(sk-[a-z-]+|routes-sk)$/.test(id) || ['fs', 'path'].includes(id) && rel.endsWith('sk-kit.js') || id === 'path' && rel.endsWith('sk-static.js'),
				`${rel}: require('${id}')`)
		}
		for (const [, id] of code.matchAll(/core\(\s*'([^']+)'\s*\)/g)) assert.ok(CORE_OK.has(id), `${rel}: core('${id}')`)
		for (const [, id] of code.matchAll(/file\(\s*'([^']+)'\s*\)/g)) assert.ok(KIT_OK.has(id), `${rel}: kit file ${id}`)
		const bare = code.replace(/requireCaspar: false/g, '')
		assert.doesNotMatch(bare, /\bamcp\b|caspar|\b5250\b|\blayers?\b|\blooks?\b|scene-take|writeFile|appendFile|mkdirSync|unlinkSync|renameSync|rmSync|\/api\/project|saveProject|child_process|dgram|\bnet\b/i, rel)
	}
})

test('500-line limit: every file of the module', () => {
	const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
	for (const f of walk(MOD).filter((x) => /\.(js|mjs|json|css|html)$/.test(x))) {
		const n = fs.readFileSync(f, 'utf8').split('\n').length
		assert.ok(n <= 501, `${path.relative(ROOT, f)}: ${n} lines`)
	}
	for (const f of [path.join(ROOT, 'tools', 'dev', 'skirmish-dev-server.js'), ...fs.readdirSync(__dirname).filter((x) => x.startsWith('smoke-wo1081-sk-server-')).map((x) => path.join(__dirname, x))]) {
		assert.ok(fs.readFileSync(f, 'utf8').split('\n').length <= 501, path.relative(ROOT, f))
	}
})
