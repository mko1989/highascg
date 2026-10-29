'use strict'

/**
 * WO-811 phase 2 — every server path a client uses, against a SANDBOX server (own port, own config, own token file —
 * never the box's node): HTTP routes, /api/ws, /api/video-feed, the browser sign-in. Enforcement ON: the shared password
 * (Bearer header = Godot/Companion/linked nodes, cookie = web UI/phones, ?token= = scripts) is accepted, nothing else is
 * (401). CEF templates use the node's template key instead (smoke-wo811-template-credentials.test.js).
 * Enforcement OFF: everything is accepted as today, with or without the password.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo811-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token') // never the box's .private/api-token

const auth = require('../../src/server/auth')
const { routeRequest } = require('../../src/api/router')
const { startHttpServer } = require('../../src/server/http-server')
const { attachWebSocketServer } = require('../../src/server/ws-server')
const { attachVideoFeed } = require('../../src/system/video-feed')

const PW = 'wo811-shared-password'
const logLines = []
const ctx = {
	config: { security: { enforceAuth: true, apiToken: PW }, caspar: { host: '127.0.0.1', port: 5250 } },
	log: () => {},
}
let server
let port
let feed

test.before(async () => {
	server = startHttpServer({
		port: 0,
		bindAddress: '127.0.0.1',
		webDir: TMP,
		routeApi: (m, p, b, req) => routeRequest(m, p, b, ctx, req),
		log: (m) => logLines.push(String(m)),
	})
	await new Promise((r) => server.once('listening', r))
	port = server.address().port
	attachWebSocketServer(server, ctx, { log: (m) => logLines.push(String(m)) })
	feed = attachVideoFeed(server, ctx, {})
})

test.after(() => {
	auth.setAuthRuntime({ enforceAuth: false })
	try {
		feed?.close()
	} catch {}
	server?._highascgDestroyTrackedSockets?.()
	server?.close()
	fs.rmSync(TMP, { recursive: true, force: true })
	delete process.env.HIGHASCG_API_TOKEN_FILE
})

function get(p, headers = {}) {
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
		}).on('error', reject)
	})
}

function post(p, body, headers = {}) {
	return new Promise((resolve, reject) => {
		const data = Buffer.from(JSON.stringify(body))
		const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers } }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
		})
		req.on('error', reject)
		req.end(data)
	})
}

/** → 'open' or the HTTP status the upgrade was refused with. */
function wsTry(p, headers = {}) {
	return new Promise((resolve) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${p}`, { headers })
		ws.on('open', () => {
			ws.terminate()
			resolve('open')
		})
		ws.on('unexpected-response', (_req, res) => {
			resolve(res.statusCode)
			res.resume()
		})
		ws.on('error', () => resolve('error'))
	})
}

const bearer = { Authorization: `Bearer ${PW}` }

test('enforcement ON: HTTP routes need the shared password (header, cookie, ?token=)', async () => {
	auth.setAuthRuntime({ enforceAuth: true })
	assert.equal((await get('/api/logs')).status, 401, 'no credential')
	assert.equal((await get('/api/logs', { Authorization: 'Bearer wrong' })).status, 401, 'wrong password')
	assert.equal((await get('/api/logs', bearer)).status, 200, 'Bearer (Godot, Companion, linked nodes)')
	assert.equal((await get(`/api/logs?token=${PW}`)).status, 200, '?token= (scripts)')
	assert.equal((await get('/api/auth/status')).status, 200, 'status stays public')
	assert.notEqual((await get('/api/ping')).status, 401, 'ping stays public')
	const bad = await post('/api/auth/login', { password: 'nope' })
	assert.equal(bad.status, 401, 'login with a wrong password')
	const login = await post('/api/auth/login', { password: PW })
	assert.equal(login.status, 200, 'web UI / phone sign-in')
	const cookie = String(login.headers['set-cookie'] || '').split(';')[0]
	assert.match(cookie, /^highascg_session=/)
	assert.equal((await get('/api/logs', { Cookie: cookie })).status, 200, 'the session cookie (web UI, phones)')
	const st = JSON.parse((await get('/api/auth/status', { Cookie: cookie })).body)
	assert.deepEqual(st, { enforceAuth: true, hasToken: true, authenticated: true })
})

test('enforcement ON: a browser page load goes to /login; /login is served', async () => {
	auth.setAuthRuntime({ enforceAuth: true })
	const nav = await get('/api/tracking/presenters/intake', { Accept: 'text/html,application/xhtml+xml' })
	assert.equal(nav.status, 302)
	assert.equal(nav.headers.location, '/login?next=%2Fapi%2Ftracking%2Fpresenters%2Fintake')
	assert.equal((await get('/api/logs', { Accept: 'application/json' })).status, 401, 'fetch/XHR still get the 401')
	const page = await get('/login')
	assert.equal(page.status, 200)
	assert.match(page.body, /fetch\('\/api\/auth\/login'/)
	assert.ok(!page.body.includes(PW), 'the page holds no secret')
})

test('enforcement ON: /api/ws and /api/video-feed upgrades need the password', async () => {
	auth.setAuthRuntime({ enforceAuth: true })
	assert.equal(await wsTry('/api/ws'), 401, 'ws: none')
	assert.equal(await wsTry('/api/ws', { Authorization: 'Bearer wrong' }), 401, 'ws: wrong')
	assert.equal(await wsTry('/api/ws', bearer), 'open', 'ws: header (Godot ws.gd, Companion ws-client)')
	assert.equal(await wsTry(`/api/ws?token=${encodeURIComponent(PW)}`), 'open', 'ws: ?token=')
	assert.equal(await wsTry('/api/ws', { Cookie: `highascg_session=${PW}` }), 'open', 'ws: cookie (web UI)')
	assert.equal(await wsTry('/api/video-feed?width=320&fps=5'), 401, 'feed: none')
	assert.equal(await wsTry('/api/video-feed?width=320&fps=5', bearer), 'open', 'feed: header (video_feed.gd)')
})

test('phase 1: the upgrade log line never carries the ?token= value', async () => {
	auth.setAuthRuntime({ enforceAuth: true })
	logLines.length = 0
	await wsTry(`/api/ws?token=${encodeURIComponent(PW)}`)
	const upgrade = logLines.filter((l) => l.includes('[HTTP Server Upgrade]'))
	assert.ok(upgrade.length > 0, 'the line is still written')
	assert.ok(upgrade.every((l) => l.includes('token=***')), upgrade.join('\n'))
	assert.ok(!logLines.some((l) => l.includes(PW)), 'the password is in no log line')
})

test('enforcement OFF: everything accepted as today, with or without the password', async () => {
	auth.setAuthRuntime({ enforceAuth: false })
	assert.equal((await get('/api/logs')).status, 200, 'no credential')
	assert.equal((await get('/api/logs', bearer)).status, 200, 'credential is harmless')
	assert.equal((await get('/api/logs', { Authorization: 'Bearer wrong' })).status, 200, 'even a wrong one')
	assert.equal(await wsTry('/api/ws'), 'open')
	assert.equal(await wsTry('/api/ws', bearer), 'open')
	assert.equal(await wsTry('/api/video-feed?width=320&fps=5'), 'open')
	const nav = await get('/api/logs', { Accept: 'text/html' })
	assert.equal(nav.status, 200, 'no sign-in redirect while off')
	const login = await post('/api/auth/login', {})
	assert.deepEqual(JSON.parse(login.body), { ok: true, enforceAuth: false })
})

test('the token file is the sandbox one; the box file was never written', () => {
	assert.equal(auth.tokenFilePath(), path.join(TMP, 'api-token'))
	auth.setAuthRuntime({ enforceAuth: true })
	assert.equal(auth.getExpectedApiToken(ctx.config), PW, 'config token while no file')
	fs.writeFileSync(auth.tokenFilePath(), 'from-file\n')
	assert.equal(auth.getExpectedApiToken(ctx.config), 'from-file', 'the file wins (as before)')
	fs.rmSync(auth.tokenFilePath())
	auth.setAuthRuntime({ enforceAuth: false })
})
