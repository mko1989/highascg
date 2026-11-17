'use strict'

/**
 * WO-1106 B1 / B7 / B8 / B9 — installing code onto the box (temp dirs via env; never ~/.highascg, repo modules/ or :4200):
 *   B1  module install / uninstall / enable / disable and the detection runtime install / import answer only with the
 *       password (auth enforced) or from the box itself; a URL install needs the caller's sha256.
 *   B7  an upgrade whose new version does not start puts the previous copy back, running.
 *   B8  a sidecar .sha256 is reported as `sha256Source: 'sidecar'`, never as verified.
 *   B9  a download that drip-feeds (never idle) is cut at the overall deadline; a cut-off body rejects.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-mod-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')
const REPO_DIR = path.join(TMP, 'repo-modules')
const HOME_DIR = path.join(TMP, 'home-modules')
process.env.HIGHASCG_MODULES_REPO_DIR = REPO_DIR
process.env.HIGHASCG_MODULES_DIR = HOME_DIR
process.env.HIGHASCG_MODULES_STATE_FILE = path.join(TMP, 'modules.json')

const routesModules = require('../../src/api/routes-modules')
const routesTracking = require('../../src/api/routes-tracking-runtime')
const moduleRegistry = require('../../src/module-registry')
const { installModule, uninstallModule } = require('../../src/module-host/module-install')
const { mayChangeInstalledCode } = require('../../src/module-host/code-change-gate')
const { writeTarGz } = require('../../src/module-host/module-tar')
const { fetchHttps, sha256Hex } = require('../../src/module-host/module-fetch')

const PW = 'wo1106-password'
const OFF = { config: {}, log: () => {} } // the factory default: API auth off
const ON = { config: { security: { enforceAuth: true, apiToken: PW } }, log: () => {} }
const BOX = { socket: { remoteAddress: '127.0.0.1', localPort: 4200 }, headers: { host: '127.0.0.1:4200' } } // the on-box Godot client
const REMOTE = { socket: { remoteAddress: '192.168.1.50', localPort: 4200 }, headers: { host: '192.168.1.17:4200' } }
const withHeaders = (r, h) => ({ ...r, headers: { ...r.headers, ...h } })

/** A tiny module package: `register.js` = the given source. */
function pkgFile(name, version, registerSrc) {
	const f = path.join(TMP, `${name}-${version}-${Math.random().toString(16).slice(2)}.tgz`)
	fs.writeFileSync(f, writeTarGz([
		{ name, type: 'dir' },
		{ name: `${name}/module.json`, data: JSON.stringify({ name, version, main: 'register.js' }) },
		{ name: `${name}/register.js`, data: registerSrc },
	]))
	return f
}
const GOOD = (name) => `module.exports = { name: '${name}' }\n`
const BROKEN = "throw new Error('v2 is broken')\n"
const dotDirs = () => (fs.existsSync(HOME_DIR) ? fs.readdirSync(HOME_DIR).filter((n) => n.startsWith('.')) : [])

test.after(async () => {
	for (const n of ['gate-mod', 'roll-mod', 'side-mod']) await uninstallModule(n, OFF).catch(() => {})
	fs.rmSync(TMP, { recursive: true, force: true })
})

test('B1: the gate — password (auth on) or the box itself; never a LAN device with auth off', () => {
	assert.equal(mayChangeInstalledCode(BOX, OFF).ok, true, 'on-box client, auth off')
	assert.equal(mayChangeInstalledCode({ ...BOX, socket: { remoteAddress: '::ffff:127.0.0.1', localPort: 4200 } }, OFF).ok, true)
	assert.equal(mayChangeInstalledCode({ socket: { remoteAddress: '::1', localPort: 4200 }, headers: {} }, OFF).ok, true)
	const no = mayChangeInstalledCode(REMOTE, OFF)
	assert.equal(no.ok, false)
	assert.equal(no.status, 403)
	assert.match(no.error, /Turn on API auth in Settings ▸ System, or do this on the box itself\./)
	assert.equal(mayChangeInstalledCode(undefined, OFF).ok, false, 'no request = refused')
	assert.equal(mayChangeInstalledCode(withHeaders(BOX, { 'x-forwarded-for': '192.168.1.50' }), OFF).ok, false, 'relayed by a proxy')
	assert.equal(mayChangeInstalledCode(withHeaders(BOX, { origin: 'null' }), OFF).ok, false, 'a page rendered on the box (CEF)')
	assert.equal(mayChangeInstalledCode(withHeaders(REMOTE, { authorization: `Bearer ${PW}` }), ON).ok, true, 'password, auth on')
	assert.equal(mayChangeInstalledCode(withHeaders(REMOTE, { authorization: 'Bearer wrong' }), ON).ok, false)
	assert.equal(mayChangeInstalledCode(withHeaders(REMOTE, { authorization: `Bearer ${PW}` }), OFF).ok, false, 'a password means nothing while auth is off')
})

test('B1: module POSTs (routes as registered) refuse a LAN device with auth off — nothing installed', async () => {
	const h = {}
	routesModules.registerPostRoutes({ post: (p, fn) => (h[p] = fn) })
	const tgz = pkgFile('gate-mod', '1.0.0', GOOD('gate-mod'))
	for (const [p, body] of [['install', { path: tgz }], ['enable', { name: 'gate-mod' }], ['disable', { name: 'gate-mod' }], ['uninstall', { name: 'gate-mod' }]]) {
		const r = await h[`/api/modules/${p}`]({ body: JSON.stringify(body), ctx: OFF, req: REMOTE })
		assert.equal(r.status, 403, `${p}: ${r.body}`)
		assert.match(JSON.parse(r.body).error, /Settings ▸ System/)
	}
	assert.equal(fs.existsSync(path.join(HOME_DIR, 'gate-mod')), false)
	const ok = await h['/api/modules/install']({ body: JSON.stringify({ path: tgz, enable: false }), ctx: OFF, req: BOX })
	assert.equal(ok.status, 200, ok.body)
	const remoteOn = withHeaders(REMOTE, { authorization: `Bearer ${PW}` })
	assert.equal((await h['/api/modules/uninstall']({ body: JSON.stringify({ name: 'gate-mod' }), ctx: ON, req: remoteOn })).status, 200)
})

test('B1: detection runtime install / import refuse a LAN device with auth off; status stays open', async () => {
	const h = {}
	routesTracking.register({ get: (p, fn) => (h['GET ' + p] = fn), post: (p, fn) => (h['POST ' + p] = fn) })
	for (const k of ['POST /api/tracking/runtime/install', 'POST /api/tracking/runtime/import']) {
		const r = await h[k]({ query: {}, body: JSON.stringify({ from: '/tmp/x', prefix: path.join(TMP, 'rt') }), ctx: OFF, req: REMOTE })
		assert.equal(r.status, 403, k)
		assert.match(JSON.parse(r.body).error, /do this on the box itself/)
	}
	// from the box the guard lets it through to the normal checks (an unknown feature is refused before any job starts)
	const box = await h['POST /api/tracking/runtime/install']({ query: {}, body: JSON.stringify({ prefix: path.join(TMP, 'rt'), features: ['eyes'] }), ctx: OFF, req: BOX })
	assert.equal(box.status, 400)
	assert.match(JSON.parse(box.body).error, /unknown feature/)
	const cancel = await h['POST /api/tracking/runtime/cancel']({ query: {}, body: '{}', ctx: OFF, req: REMOTE })
	assert.notEqual(cancel.status, 403, 'only install / import are gated')
})

test('B1: a URL install without the caller sha256 is refused before anything is downloaded', async () => {
	const seen = []
	const fetch = async (u) => (seen.push(u), Buffer.alloc(0))
	const r = await installModule({ url: 'https://example.invalid/m.tgz' }, OFF, { fetch })
	assert.equal(r.ok, false)
	assert.equal(r.code, 'SHA256_REQUIRED')
	assert.deepEqual(seen, [])
	const viaRoute = await routesModules.handlePost('install', JSON.stringify({ url: 'https://example.invalid/m.tgz' }), OFF, { fetch }, BOX)
	assert.equal(viaRoute.status, 400)
	assert.equal(JSON.parse(viaRoute.body).code, 'SHA256_REQUIRED')
})

test('B8: sha256Source caller / sidecar / none; only the caller hash is verified', async () => {
	const tgz = pkgFile('side-mod', '1.0.0', GOOD('side-mod'))
	const sha = sha256Hex(fs.readFileSync(tgz))
	const none = await installModule({ path: tgz, enable: false }, OFF)
	assert.deepEqual([none.ok, none.sha256Verified, none.sha256Source], [true, false, 'none'])
	fs.writeFileSync(`${tgz}.sha256`, `${sha}  x.tgz\n`)
	const side = await installModule({ path: tgz, enable: false }, OFF)
	assert.deepEqual([side.ok, side.sha256Verified, side.sha256Source], [true, false, 'sidecar'])
	const caller = await installModule({ path: tgz, sha256: sha, enable: false }, OFF)
	assert.deepEqual([caller.ok, caller.sha256Verified, caller.sha256Source], [true, true, 'caller'])
})

test('B7: an upgrade that does not start puts the previous copy back, running; a good upgrade drops it', async () => {
	const v1 = await installModule({ path: pkgFile('roll-mod', '1.0.0', GOOD('roll-mod')) }, OFF)
	assert.equal(v1.enabled, true, v1.enableError)
	assert.equal(moduleRegistry.externalInfo('roll-mod').version, '1.0.0')
	const v2 = await installModule({ path: pkgFile('roll-mod', '2.0.0', BROKEN) }, OFF)
	assert.equal(v2.ok, false)
	assert.equal(v2.code, 'ENABLE')
	assert.equal(v2.rolledBack, true)
	assert.equal(v2.previousRunning, true)
	assert.match(v2.error, /did not start.*The previous version is back and running/)
	assert.equal(JSON.parse(fs.readFileSync(path.join(HOME_DIR, 'roll-mod', 'module.json'), 'utf8')).version, '1.0.0')
	assert.equal(moduleRegistry.externalInfo('roll-mod')?.version, '1.0.0', 'v1 runs again')
	assert.deepEqual(dotDirs(), [], 'no .old-* / .failed-* / .staging-* left')
	const v3 = await installModule({ path: pkgFile('roll-mod', '3.0.0', GOOD('roll-mod')) }, OFF)
	assert.equal(v3.ok, true)
	assert.equal(v3.enabled, true)
	assert.equal(moduleRegistry.externalInfo('roll-mod').version, '3.0.0')
	assert.deepEqual(dotDirs(), [], 'the previous copy is removed once the new one runs')
})

/** fetchHttps over a local plain-HTTP server (the `get` override keeps the https-only URL check). */
function localGet(port) {
	return (u, o, cb) => http.get({ host: '127.0.0.1', port, path: u.pathname, headers: o.headers }, cb)
}
async function withServer(handler, fn) {
	const sockets = new Set()
	const srv = http.createServer(handler)
	srv.on('connection', (s) => (sockets.add(s), s.on('close', () => sockets.delete(s))))
	await new Promise((r) => srv.listen(0, '127.0.0.1', r))
	try {
		return await fn(srv.address().port, sockets)
	} finally {
		for (const s of sockets) s.destroy()
		await new Promise((r) => srv.close(r))
	}
}

test('B9: a drip-feed (never idle) is cut at the overall deadline and the connection is closed', async () => {
	await withServer((req, res) => {
		res.writeHead(200, { 'Content-Length': '100000' })
		const t = setInterval(() => res.write('x'), 20)
		res.on('close', () => clearInterval(t))
	}, async (port, sockets) => {
		const t0 = Date.now()
		await assert.rejects(fetchHttps('https://example.invalid/m.tgz', { get: localGet(port), timeoutMs: 5000, deadlineMs: 300 }), /took too long/)
		assert.ok(Date.now() - t0 < 2000, 'well before the idle timeout')
		await new Promise((r) => setTimeout(r, 50))
		assert.equal(sockets.size, 0, 'the request was destroyed')
	})
})

test('B9: a body cut off mid-way rejects (never hangs)', async () => {
	await withServer((req, res) => {
		res.writeHead(200, { 'Content-Length': '1000' })
		res.write('only a bit')
		setTimeout(() => res.socket.destroy(), 30)
	}, async (port) => {
		await assert.rejects(fetchHttps('https://example.invalid/m.tgz', { get: localGet(port), timeoutMs: 5000, deadlineMs: 5000 }), /cut off|aborted/)
	})
})
