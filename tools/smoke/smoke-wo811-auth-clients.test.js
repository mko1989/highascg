'use strict'

/**
 * WO-811 — the clients' side of the shared password: node → node calls (linked servers, relay, replication) carry it,
 * the web UI signs in, phase 1 (redaction, Syncthing ignore). CEF templates never get it — they get the node's template
 * key: smoke-wo811-template-credentials.test.js. Server paths with
 * enforcement ON/OFF: smoke-wo811-auth-server-paths.test.js. Godot: godot/client/tests/test_auth_wo811.gd. Companion:
 * companion-module-highpass-highascg/test/auth-headers.test.js.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo811c-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')

const auth = require('../../src/server/auth')
const { getJson, requestJson } = require('../../src/cluster/cluster-peers')
const { rawRequest } = require('../../src/cluster/cluster-relay')
const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const PW = 'wo811-node-password'
let server
let port
const seen = []

test.before(async () => {
	server = http.createServer((req, res) => {
		seen.push({ url: req.url, authorization: req.headers.authorization || '' })
		req.resume()
		req.on('end', () => {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end('{"ok":true}')
		})
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	port = server.address().port
})

test.after(() => {
	auth.setAuthRuntime({ enforceAuth: false, config: null })
	server?.close()
	fs.rmSync(TMP, { recursive: true, force: true })
	delete process.env.HIGHASCG_API_TOKEN_FILE
})

test('outboundAuthHeaders: Bearer with this node password, nothing without one (today)', () => {
	assert.deepEqual(auth.outboundAuthHeaders({}), {})
	assert.deepEqual(auth.outboundAuthHeaders({ security: { apiToken: PW } }), { Authorization: `Bearer ${PW}` })
	auth.setAuthRuntime({ config: { security: { apiToken: PW } } })
	assert.deepEqual(auth.outboundAuthHeaders(), { Authorization: `Bearer ${PW}` }, 'the runtime config (index.js)')
	auth.setAuthRuntime({ config: null })
	assert.deepEqual(auth.outboundAuthHeaders(), {})
	assert.match(read('index.js'), /auth\.setAuthRuntime\(\{ enforceAuth: auth\.isEnforceAuthActive\(cfg\), config: cfg \}\)/)
})

test('linked-server calls carry the password; the subnet scan does not', async () => {
	auth.setAuthRuntime({ config: { security: { apiToken: PW } } })
	seen.length = 0
	await getJson('127.0.0.1', port, '/api/cluster/identity')
	await getJson('127.0.0.1', port, '/api/replication/ping', 1000, { auth: false })
	await requestJson('POST', '127.0.0.1', port, '/api/cluster/peers', { a: 1 })
	await rawRequest('GET', '127.0.0.1', port, '/api/device-view', undefined)
	assert.deepEqual(seen.map((s) => s.authorization), [`Bearer ${PW}`, '', `Bearer ${PW}`, `Bearer ${PW}`])
	assert.match(read('src/cluster/cluster-peers.js'), /fetchJson\(host, 4200, '\/api\/replication\/ping', SCAN_TIMEOUT_MS, \{ auth: false \}\)/)
	auth.setAuthRuntime({ config: null })
	seen.length = 0
	await getJson('127.0.0.1', port, '/api/cluster/identity')
	assert.equal(seen[0].authorization, '', 'no password configured → no header (today)')
})

test('replication peer calls carry Bearer next to the replication token', () => {
	const src = read('src/replication/peer-client.js')
	assert.match(src, /'X-HighAsCG-Replication-Token': peer\.token \|\| '',\n\s+\.\.\.outboundAuthHeaders\(\),/)
})

test('templates get no shared password (template key instead: smoke-wo811-template-credentials.test.js)', () => {
	assert.equal(auth.templateApiToken, undefined)
	assert.ok(!/apiToken/.test(read('src/engine/multiview-apply-overlay.js')))
})

test('web UI: sign-in gate before bootstrap, 401 → sign in again (session cookie)', () => {
	const app = read('client/app.js')
	assert.match(app, /import \{ ensureAuthGate \} from '\.\/lib\/auth-gate\.js'/)
	assert.match(app, /\nawait ensureAuthGate\(\)\n/)
	const api = read('client/lib/api-client.js')
	assert.equal((api.match(/if \(res\.status === 401\) noteUnauthorized\(\)/g) || []).length, 4, 'get, post, put, delete')
	const gate = read('client/lib/auth-gate.js')
	assert.match(gate, /fetch\(`\$\{getApiBase\(\)\}\/api\/auth\/status`, FETCH_OPTS\)/)
	assert.match(gate, /if \(!status\?\.enforceAuth \|\| status\?\.authenticated\) return/, 'off → no gate')
	assert.match(gate, /body: JSON\.stringify\(\{ password: input\.value\.trim\(\) \}\)/)
})

test('phase 1: redaction and the Syncthing ignore', () => {
	assert.equal(auth.redactUrlForLog('/api/ws?token=abc'), '/api/ws?token=***')
	assert.equal(auth.redactUrlForLog('/api/video-feed?width=9&token=abc&fps=1'), '/api/video-feed?width=9&token=***&fps=1')
	assert.equal(auth.redactUrlForLog('/api/ws?password=x&apiToken=y'), '/api/ws?password=***&apiToken=***')
	assert.equal(auth.redactUrlForLog('/api/ws'), '/api/ws')
	assert.match(read('src/server/http-server.js'), /Event fired for path: \$\{redactUrlForLog\(req\.url\)\}/)
	const ignore = read('.stignore').split('\n').map((l) => l.trim())
	assert.ok(ignore.includes('/.private/api-token'), '.stignore lists the token file')
	assert.equal(path.relative(ROOT, auth.TOKEN_FILE), path.join('.private', 'api-token'), 'the path the ignore line names')
})

test('login page: next is same-site only', () => {
	const { safeNext } = require('../../src/server/login-page')
	assert.equal(safeNext('/intake'), '/intake')
	assert.equal(safeNext('//evil.example/x'), '/')
	assert.equal(safeNext('https://evil.example'), '/')
	assert.equal(safeNext('/\\evil'), '/')
})
