'use strict'

/**
 * WO-811 phase 3 — Settings → Nuclear "Change casparcg login password…": POST /api/system/gui-launch {action:'os-password'}
 * opens tools/runtime/os-password.sh (passwd) in a terminal on :0, and only for a request from the box itself
 * (src/api/box-local-request.js). The launch is STUBBED here (child_process.spawn / deps) — nothing runs passwd or
 * opens a window. Also: the wrapper's shell syntax, that it never echoes a password, and the HTTPS proxy stamping
 * X-Forwarded-For so a proxied LAN client is not taken for the box.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const childProcess = require('child_process')
const { execFileSync } = childProcess

// Stub spawn BEFORE system-hardware-gui.js destructures it: the real-route test must never open a terminal.
const spawned = []
childProcess.spawn = (bin, args, opts) => {
	spawned.push({ bin, args, env: opts?.env || {} })
	return { unref() {}, on() {}, once() {} }
}

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const { checkBoxLocalRequest, isLoopbackAddress } = require('../../src/api/box-local-request')
const gui = require('../../src/api/system-hardware-gui')
const { hashNuclearPassword } = require('../../src/utils/nuclear-password')

const fakeReq = (remoteAddress, headers = {}, localPort = 4200) => ({ socket: { remoteAddress, localPort }, headers })
const BODY = JSON.stringify({ action: 'os-password' })

test('local check: loopback socket, no proxy header, loopback Host on our port, loopback Origin', () => {
	assert.equal(isLoopbackAddress('127.0.0.1'), true)
	assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
	assert.equal(isLoopbackAddress('::1'), true)
	assert.equal(isLoopbackAddress('192.168.1.20'), false)
	const ok = (r) => assert.deepEqual(checkBoxLocalRequest(r), { ok: true })
	const no = (r, reason) => assert.deepEqual(checkBoxLocalRequest(r), { ok: false, reason })
	ok(fakeReq('127.0.0.1', { host: '127.0.0.1:4200' })) // Godot on the box
	ok(fakeReq('::1', { host: '[::1]:4200' }))
	ok(fakeReq('127.0.0.1', { host: 'localhost:4200', origin: 'http://localhost:4200' })) // web UI on the box
	ok(fakeReq('127.0.0.1', {}))
	no(fakeReq('192.168.1.20', { host: '192.168.1.10:4200' }), 'not from this machine')
	no(fakeReq('10.0.0.5', {}), 'not from this machine')
	no(null, 'not from this machine')
	no(fakeReq('127.0.0.1', { host: '127.0.0.1:4200', 'x-forwarded-for': '192.168.1.20' }), 'relayed by a proxy')
	no(fakeReq('127.0.0.1', { host: '127.0.0.1:4200', forwarded: 'for=192.168.1.20' }), 'relayed by a proxy')
	no(fakeReq('127.0.0.1', { host: '192.168.1.10:4443' }), 'not addressed to this machine') // :4443 proxy, Host kept
	no(fakeReq('127.0.0.1', { host: '127.0.0.1:4443' }), 'relayed by a proxy') // spoofed Host, wrong port
	no(fakeReq('127.0.0.1', { host: '127.0.0.1:4200', origin: 'https://evil.example' }), 'foreign page') // CEF web source
	no(fakeReq('127.0.0.1', { host: '127.0.0.1:4200', origin: 'null' }), 'foreign page') // file:// / sandboxed page
})

test('handler: refuses a non-local origin (403, no launch), accepts the local one (launch stubbed)', async () => {
	const calls = []
	const deps = { spawnGuiDetached: (action) => (calls.push(action), '/usr/bin/xterm') }
	const ctx = { config: {} }
	for (const req of [
		fakeReq('192.168.1.20', { host: '192.168.1.10:4200' }),
		fakeReq('127.0.0.1', { host: '192.168.1.10:4443', 'x-forwarded-for': '192.168.1.20' }),
		fakeReq('127.0.0.1', { host: '127.0.0.1:4200', origin: 'https://evil.example' }),
		undefined,
	]) {
		const r = await gui.handleGuiLaunchPost(BODY, ctx, req, deps)
		assert.equal(r.status, 403)
		assert.match(JSON.parse(r.body).error, /^Only on the box's own screen \(/)
	}
	assert.deepEqual(calls, [], 'nothing launched for a remote request')
	const r = await gui.handleGuiLaunchPost(BODY, ctx, fakeReq('127.0.0.1', { host: '127.0.0.1:4200' }), deps)
	assert.equal(r.status, 200)
	assert.deepEqual(calls, ['os-password'])
	const b = JSON.parse(r.body)
	assert.equal(b.ok, true)
	assert.equal(b.note, 'Terminal opened on the box screen — finish there.')
	// Other actions are not affected by the box-local rule (alsamixer from a laptop still launches).
	const other = await gui.handleGuiLaunchPost(JSON.stringify({ action: 'alsamixer' }), ctx, fakeReq('10.0.0.5', {}), deps)
	assert.equal(other.status, 200)
})

test('handler: the existing nuclear gate still comes first', async () => {
	const calls = []
	const deps = { spawnGuiDetached: (action) => (calls.push(action), '/usr/bin/xterm') }
	const ctx = { config: { ui: { nuclearRequirePassword: true, nuclearPasswordHash: hashNuclearPassword('nuke') } } }
	const local = fakeReq('127.0.0.1', { host: '127.0.0.1:4200' })
	const no = await gui.handleGuiLaunchPost(BODY, ctx, local, deps)
	assert.equal(no.status, 403)
	assert.match(JSON.parse(no.body).error, /Invalid password/)
	const yes = await gui.handleGuiLaunchPost(JSON.stringify({ action: 'os-password', password: 'nuke' }), ctx, local, deps)
	assert.equal(yes.status, 200)
	assert.deepEqual(calls, ['os-password'])
})

test('real route over loopback HTTP: local accepted, proxied refused; argv is the fixed wrapper on :0', async () => {
	const { routeRequest } = require('../../src/api/router')
	const { startHttpServer } = require('../../src/server/http-server')
	const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo811-osp-'))
	const ctx = { config: null, log: () => {} } // null: no X window positioning on :0 after the stubbed launch
	const server = startHttpServer({ port: 0, bindAddress: '127.0.0.1', webDir: TMP,
		routeApi: (m, p, b, req) => routeRequest(m, p, b, ctx, req), log: () => {} })
	await new Promise((r) => server.once('listening', r))
	const port = server.address().port
	const post = (headers) => new Promise((resolve, reject) => {
		const req = http.request({ host: '127.0.0.1', port, path: '/api/system/gui-launch', method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(BODY), ...headers } }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
		})
		req.on('error', reject)
		req.end(BODY)
	})
	try {
		spawned.length = 0
		const proxied = await post({ 'X-Forwarded-For': '192.168.1.20' })
		assert.equal(proxied.status, 403)
		const viaProxyHost = await post({ Host: '192.168.1.10:4443' })
		assert.equal(viaProxyHost.status, 403)
		assert.equal(spawned.length, 0, 'nothing spawned for refused requests')
		const local = await post({})
		const { resolveTerminalEmulator } = require('../../src/utils/desktop-app-catalog')
		if (!resolveTerminalEmulator()) {
			assert.equal(local.status, 502, 'no terminal on this runner: the launch says so') // CI without xterm
			assert.match(JSON.parse(local.body).error, /No terminal emulator installed/)
			return
		}
		assert.equal(local.status, 200, local.body)
		assert.equal(spawned.length, 1)
		const { args, env } = spawned[0]
		assert.deepEqual(args.slice(-2), ['/bin/sh', gui.OS_PASSWORD_SCRIPT], 'fixed wrapper, nothing from the request')
		assert.ok(args.includes('highascg-passwd') || args.includes('--class=highascg-passwd') || args[0] === '-e')
		assert.equal(env.DISPLAY, ':0', 'on the box screen')
	} finally {
		server._highascgDestroyTrackedSockets?.()
		server.close()
		fs.rmSync(TMP, { recursive: true, force: true })
	}
})

test('wrapper script: valid sh, runs passwd, never stores or echoes a password', () => {
	const rel = 'tools/runtime/os-password.sh'
	assert.equal(path.join(ROOT, rel), gui.OS_PASSWORD_SCRIPT)
	execFileSync('sh', ['-n', path.join(ROOT, rel)]) // throws on a syntax error
	const src = read(rel)
	const code = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
	assert.match(code, /^\/usr\/bin\/passwd$/m, 'plain passwd: it prompts on the terminal itself')
	assert.doesNotMatch(code, /\becho\b/, 'no echo at all')
	assert.doesNotMatch(code, /chpasswd|--stdin|stty|>\s*[~/$]/i, 'no password piping, no tty tricks, no file writes')
	const reads = code.match(/\bread\b[^\n]*/g) || []
	assert.ok(reads.length >= 1)
	for (const r of reads) assert.match(r, /^read -r _ \|\| true$/, 'reads only the Enter key into _')
	assert.match(code, /\$\(id -u\)" = "0"/, 'refuses to run as root')
	assert.match(code, /Press Enter to close this window/)
})

test('wiring: gui-launch passes req; window class; the HTTPS proxy stamps X-Forwarded-For', () => {
	assert.match(read('src/api/router.js'), /routes\.post\('\/api\/system\/gui-launch', \(\{ path, body, ctx, req \}\) => routesSystemHardware\.hardwareHandlePost\(path, body, ctx, req\)/)
	assert.match(read('src/api/routes-system-hardware.js'), /handleGuiLaunchPost\(body, ctx, req\)/)
	assert.match(read('src/utils/x-display-session-gui-windows.js'), /'os-password': 'highascg-passwd'/)
	const proxy = read('tools/runtime/highascg-https-proxy.js')
	assert.match(proxy, /'x-forwarded-for': creq\.socket\.remoteAddress \|\| 'unknown'/)
	assert.match(proxy, /X-Forwarded-For: \$\{csocket\.remoteAddress \|\| 'unknown'\}/)
})
