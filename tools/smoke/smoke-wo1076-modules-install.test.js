'use strict'

/**
 * WO-1076 — installing / uninstalling a module package (temp dirs + state file via env; never the box's ~/.highascg,
 * repo modules/ or :4200):
 *   tools/release/make-module-tarball.js packs the fixture (+ .sha256) and the installer takes it from a local path
 *   over the sandbox HTTP API (enabled at once, its route answers); sha256 given / sidecar / mismatch; an https URL via
 *   an injected fetch with the caller's sha256 (WO-1106 B1 / B8: tools/smoke/smoke-wo1106-core-modules.test.js) (and a plain http:// URL refused by the real downloader); every rejection before a byte is
 *   written — `..` and absolute names, symlinks, hard links, two top-level dirs, manifest name ≠ directory, body name ≠
 *   package, oversize packed / unpacked / entry count, a repo modules/<name> never overwritten, an in-tree name;
 *   an upgrade swaps the copy (old code unloaded first); uninstall disables first and removes only the installed copy.
 *   Also: the reader takes GNU / POSIX archives from the system `tar`.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFileSync } = require('child_process')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1076-inst-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')
const REPO_DIR = path.join(TMP, 'repo-modules')
const HOME_DIR = path.join(TMP, 'home-modules')
const STATE = path.join(TMP, 'modules.json')
process.env.HIGHASCG_MODULES_REPO_DIR = REPO_DIR
process.env.HIGHASCG_MODULES_DIR = HOME_DIR
process.env.HIGHASCG_MODULES_STATE_FILE = STATE

const { routeRequest } = require('../../src/api/router')
const { startHttpServer } = require('../../src/server/http-server')
const routesModules = require('../../src/api/routes-modules')
const moduleRegistry = require('../../src/module-registry')
const { installModule, uninstallModule } = require('../../src/module-host/module-install')
const { writeTarGz, readTarGz } = require('../../src/module-host/module-tar')
const { fetchHttps, sha256Hex } = require('../../src/module-host/module-fetch')
const { makeModuleTarball } = require('../release/make-module-tarball')

const FIXTURES = path.join(__dirname, 'fixtures', 'modules')
const PW = 'wo1076-install-password'
const BEARER = { Authorization: `Bearer ${PW}`, 'Content-Type': 'application/json' }
const ctx = { config: { security: { enforceAuth: true, apiToken: PW } }, log: () => {} }
const PKG = path.join(TMP, 'out')
const manifest = (name, extra = {}) => JSON.stringify({ name, version: '1.0.0', ...extra })

let server, port, pkg
function req(method, p, body) {
	return new Promise((resolve, reject) => {
		const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: BEARER }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
		})
		r.on('error', reject)
		if (body !== undefined) r.write(JSON.stringify(body))
		r.end()
	})
}
/** Write a hand-built archive and install it directly (deps = code-only limits). */
async function installEntries(entries, opts = {}, deps = {}) {
	const f = path.join(TMP, `pkg-${Math.random().toString(16).slice(2)}.tgz`)
	fs.writeFileSync(f, writeTarGz(entries))
	return installModule({ path: f, enable: false, ...opts }, ctx, deps)
}
const installedNames = () => (fs.existsSync(HOME_DIR) ? fs.readdirSync(HOME_DIR) : [])

test.before(async () => {
	pkg = makeModuleTarball('echo-fixture', { src: FIXTURES, out: PKG })
	server = startHttpServer({ port: 0, bindAddress: '127.0.0.1', webDir: TMP, routeApi: (m, p, b, r) => routeRequest(m, p, b, ctx, r), log: () => {} })
	await new Promise((r) => server.once('listening', r))
	port = server.address().port
	moduleRegistry.setHttpServer(server, ctx)
})

test.after(async () => {
	await uninstallModule('echo-fixture', ctx).catch(() => {})
	moduleRegistry.setHttpServer(null)
	await new Promise((r) => server.close(r))
	fs.rmSync(TMP, { recursive: true, force: true })
})

test('make-module-tarball: name-version.tgz + sha256sum line, one top-level dir, reproducible', () => {
	assert.equal(path.basename(pkg.tgz), 'highascg-module-echo-fixture-1.2.0.tgz')
	const buf = fs.readFileSync(pkg.tgz)
	assert.equal(fs.readFileSync(pkg.sha256File, 'utf8'), `${sha256Hex(buf)}  highascg-module-echo-fixture-1.2.0.tgz\n`)
	const names = readTarGz(buf).map((e) => e.name)
	assert.ok(names.includes('echo-fixture/module.json') && names.includes('echo-fixture/public/index.html'))
	assert.ok(names.every((n) => n === 'echo-fixture' || n.startsWith('echo-fixture/')))
	const again = makeModuleTarball('echo-fixture', { src: FIXTURES, out: path.join(TMP, 'out2') })
	assert.equal(again.sha256, pkg.sha256)
})

test('install from a local tarball over the API: sha256 verified, enabled, route answers; bad sha refused', async () => {
	const bad = await req('POST', '/api/modules/install', { path: pkg.tgz, sha256: '0'.repeat(64) })
	assert.equal(bad.status, 400)
	assert.match(JSON.parse(bad.text).error, /sha256 mismatch/)
	assert.deepEqual(installedNames(), [])
	const ok = await req('POST', '/api/modules/install', { path: pkg.tgz, sha256: `${pkg.sha256}  whatever.tgz` })
	assert.equal(ok.status, 200, ok.text)
	const b = JSON.parse(ok.text)
	assert.equal(b.name, 'echo-fixture')
	assert.equal(b.sha256Verified, true)
	assert.equal(b.enabled, true)
	assert.equal(b.available.find((a) => a.name === 'echo-fixture').source, 'installed')
	assert.deepEqual(installedNames(), ['echo-fixture'])
	assert.equal(fs.lstatSync(path.join(HOME_DIR, 'echo-fixture', 'register.js')).isFile(), true)
	assert.equal(JSON.parse((await req('GET', '/api/echo-fixture/ping')).text).pong, true)
})

test('sidecar .sha256 is used when no sha256 is given; a wrong sidecar refuses', async () => {
	const copy = path.join(TMP, 'side', 'highascg-module-echo-fixture-1.2.0.tgz')
	fs.mkdirSync(path.dirname(copy), { recursive: true })
	fs.copyFileSync(pkg.tgz, copy)
	fs.writeFileSync(`${copy}.sha256`, `${'a'.repeat(64)}  x.tgz\n`)
	const r = await installModule({ path: copy }, ctx)
	assert.equal(r.code, 'SHA256')
	fs.copyFileSync(pkg.sha256File, `${copy}.sha256`)
	const up = await installModule({ path: copy }, ctx) // also an upgrade over the running copy
	assert.equal(up.ok, true, up.error)
	assert.equal(up.sha256Verified, false, 'WO-1106 B8: a sidecar matches, it does not verify')
	assert.equal(up.sha256Source, 'sidecar')
	assert.equal(up.replaced, true)
	assert.equal(up.enabled, true)
	assert.equal(JSON.parse((await req('GET', '/api/echo-fixture/ping')).text).pong, true)
	assert.deepEqual(installedNames(), ['echo-fixture'], 'no .staging-* / .old-* left behind')
})

test('https URL: injected fetch with the caller sha256 (no sidecar fetched); the real downloader refuses http:// and bad URLs', async () => {
	const gz = fs.readFileSync(pkg.tgz)
	const seen = []
	const fetch = async (u) => {
		seen.push(u)
		if (u.endsWith('.sha256')) return Buffer.from(`${pkg.sha256}  x\n`)
		return gz
	}
	const BOX = { socket: { remoteAddress: '127.0.0.1', localPort: 4200 }, headers: { host: '127.0.0.1:4200' } } // WO-1106 B1
	const r = await routesModules.handlePost('install', JSON.stringify({ url: 'https://example.invalid/m.tgz', sha256: pkg.sha256, enable: false }), ctx, { fetch }, BOX)
	assert.equal(r.status, 200, r.body)
	assert.equal(JSON.parse(r.body).sha256Verified, true)
	assert.equal(JSON.parse(r.body).sha256Source, 'caller')
	assert.deepEqual(seen, ['https://example.invalid/m.tgz'], 'WO-1106 B1: no same-origin sidecar is fetched')
	// enable:false over the running, enabled copy: unloaded now AND remembered off (no surprise load on restart)
	assert.equal(moduleRegistry.isLoaded('echo-fixture'), false)
	assert.deepEqual(JSON.parse(fs.readFileSync(STATE, 'utf8'))['echo-fixture'], { enabled: false })
	await assert.rejects(fetchHttps('http://127.0.0.1:1/x.tgz'), /only https/)
	await assert.rejects(fetchHttps('not a url'), /not a URL/)
	const viaApi = await req('POST', '/api/modules/install', { url: 'http://127.0.0.1:1/x.tgz', sha256: pkg.sha256 })
	assert.equal(viaApi.status, 400)
	assert.match(JSON.parse(viaApi.text).error, /only https/)
	assert.equal((await req('POST', '/api/modules/install', { path: pkg.tgz, url: 'https://x/y.tgz' })).status, 400)
	assert.equal((await req('POST', '/api/modules/install', { path: 'relative.tgz' })).status, 400)
	assert.equal((await req('POST', '/api/modules/install', { path: '/etc/passwd' })).status, 400)
})

test('rejections: traversal, absolute, links, layout, names, sizes — nothing written', async () => {
	const before = installedNames()
	const base = [{ name: 'evil', type: 'dir' }, { name: 'evil/module.json', data: manifest('evil') }]
	const cases = [
		[[...base, { name: 'evil/../../escape.js', data: 'x' }], 'TAR_PATH'],
		[[...base, { name: '../escape.js', data: 'x' }], 'TAR_PATH'],
		[[...base, { name: '/tmp/abs.js', data: 'x' }], 'TAR_PATH'],
		[[...base, { name: 'evil/link', type: 'symlink', linkTarget: '/etc/passwd' }], 'TAR_LINK'],
		[[...base, { name: 'evil/inside-link', type: 'symlink', linkTarget: 'module.json' }], 'TAR_LINK'],
		[[...base, { name: 'evil/hard', type: 'hardlink', linkTarget: 'evil/module.json' }], 'TAR_LINK'],
		[[...base, { name: 'other/x.js', data: 'x' }], 'LAYOUT'],
		[[{ name: 'evil', type: 'dir' }], 'LAYOUT'],
		[[{ name: 'evil', type: 'dir' }, { name: 'evil/module.json', data: manifest('not-evil') }], 'NAME'],
		[[{ name: 'evil', type: 'dir' }, { name: 'evil/module.json', data: '{nope' }], 'MANIFEST'],
		[[{ name: 'evil', type: 'dir' }, { name: 'evil/module.json', data: manifest('evil', { main: '../../x.js' }) }], 'MANIFEST'],
		[[...base, { name: 'evil/a.js', data: '1' }, { name: 'evil/a.js', data: '2' }], 'UNPACK'],
		[[{ name: 'previs', type: 'dir' }, { name: 'previs/module.json', data: manifest('previs') }], 'NAME'],
		[[{ name: 'old', type: 'dir' }, { name: 'old/module.json', data: manifest('old', { requiresCore: '>=2999.1.1' }) }], 'CORE'],
	]
	for (const [entries, code] of cases) {
		const r = await installEntries(entries)
		assert.equal(r.ok, false, `${code}: ${JSON.stringify(entries.map((e) => e.name))}`)
		assert.equal(r.code, code, `${r.code} ${r.error}`)
	}
	assert.equal((await installEntries(base, { name: 'something-else' })).code, 'NAME')
	assert.equal(fs.existsSync(path.join(TMP, 'escape.js')), false)
	assert.equal(fs.existsSync('/tmp/abs.js'), false)
	// sizes: packed, unpacked (zip bomb), entry count
	const big = [...base, { name: 'evil/blob.bin', data: Buffer.alloc(200_000) }]
	assert.equal((await installEntries(big, {}, { limits: { maxPackedBytes: 100 } })).code, 'TOO_LARGE')
	assert.equal((await installEntries(big, {}, { limits: { maxUnpackedBytes: 50_000 } })).code, 'TAR_TOO_LARGE')
	assert.equal((await installEntries([...base, { name: 'evil/1', data: '' }, { name: 'evil/2', data: '' }], {}, { limits: { maxEntries: 3 } })).code, 'TAR_TOO_MANY')
	assert.equal((await installEntries(big, {}, { limits: { maxUnpackedBytes: 50_000 } })).status, 413)
	// a repo dev checkout of the same name is never overwritten
	fs.mkdirSync(path.join(REPO_DIR, 'evil'), { recursive: true })
	assert.equal((await installEntries(base)).code, 'REPO_MODULE')
	fs.rmSync(path.join(REPO_DIR, 'evil'), { recursive: true })
	assert.deepEqual(installedNames(), before, 'no staging dir, no partial install')
})

test('uninstall: disables first (route gone), removes only ~/.highascg/modules/<name>; repo modules refused', async () => {
	assert.equal((await post('enable', 'echo-fixture')).status, 200)
	assert.equal((await req('GET', '/api/echo-fixture/ping')).status, 200)
	const r = await post('uninstall', 'echo-fixture')
	assert.equal(r.status, 200, r.text)
	assert.equal((await req('GET', '/api/echo-fixture/ping')).status, 404)
	assert.equal(moduleRegistry.isLoaded('echo-fixture'), false)
	assert.equal(fs.existsSync(path.join(HOME_DIR, 'echo-fixture')), false)
	assert.equal(JSON.parse(fs.readFileSync(STATE, 'utf8'))['echo-fixture'], undefined)
	assert.equal((await post('uninstall', 'echo-fixture')).status, 404)
	fs.mkdirSync(path.join(REPO_DIR, 'dev-only'), { recursive: true })
	assert.equal((await post('uninstall', 'dev-only')).status, 409)
	assert.equal(fs.existsSync(path.join(REPO_DIR, 'dev-only')), true)
	assert.equal((await post('uninstall', '../../etc')).status, 400)
})

test('the reader takes GNU / POSIX archives from the system tar (no links in them)', (t) => {
	const src = path.join(TMP, 'systar')
	fs.mkdirSync(path.join(src, 'echo-fixture', 'deep'), { recursive: true })
	fs.writeFileSync(path.join(src, 'echo-fixture', 'module.json'), manifest('echo-fixture'))
	fs.writeFileSync(path.join(src, 'echo-fixture', 'deep', `${'n'.repeat(120)}.js`), '1')
	for (const fmt of ['gnu', 'posix']) {
		const out = path.join(TMP, `sys-${fmt}.tgz`)
		try {
			execFileSync('tar', [`--format=${fmt}`, '-C', src, '-czf', out, 'echo-fixture'])
		} catch {
			return t.skip('no GNU tar')
		}
		const names = readTarGz(fs.readFileSync(out)).map((e) => e.name)
		assert.ok(names.includes(`echo-fixture/deep/${'n'.repeat(120)}.js`), fmt)
	}
	fs.symlinkSync('/etc/passwd', path.join(src, 'echo-fixture', 'pw'))
	const out = path.join(TMP, 'sys-link.tgz')
	execFileSync('tar', ['-C', src, '-czf', out, 'echo-fixture'])
	assert.throws(() => readTarGz(fs.readFileSync(out)), (e) => e.code === 'TAR_LINK')
})

function post(action, name) {
	return req('POST', `/api/modules/${action}`, { name })
}
