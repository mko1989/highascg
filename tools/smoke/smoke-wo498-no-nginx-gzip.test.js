'use strict'

/**
 * WO-498 — nginx removed; the Node server compresses text itself.
 *
 * Owner 12.08: *"i see nginx is giving some problems so id like it removed completly. ip with a
 * port number is totaly fine for connecting"*.
 *
 * Removing the :80 proxy also removes the only hop that could have gzipped the UI. It never
 * actually did — `/etc/nginx/nginx.conf` ships every `gzip_types` line commented out and nginx's
 * default covers `text/html` only — so the ~1.69 MB eager bundle went over raw either way (WO-497).
 * Compressing in-process is therefore a straight win, not a replacement for something lost.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const REPO = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(REPO, rel))

/** Recover the shipped helper so the test cannot drift from the implementation. */
function loadMaybeGzip() {
	const src = read('src/server/http-server.js')
	const m = src.match(/function maybeGzip\(req, headers, body\)[\s\S]*?\n}/)
	assert.ok(m, 'maybeGzip must exist in http-server.js')
	const consts = "const COMPRESSIBLE_CT = /^(?:text\\/|application\\/(?:javascript|json|xml)|image\\/svg\\+xml)/i;\nconst GZIP_MIN_BYTES = 1024;\n"
	return new Function('zlib', consts + m[0] + '; return maybeGzip')(zlib)
}

const GZIP_REQ = { headers: { 'accept-encoding': 'gzip, deflate, br' } }
const BIG_JS = 'const x = 1;\n'.repeat(400) // ~5 KB of highly compressible text

test('WO-498: a large JS body is gzipped, with Content-Encoding and Vary set', () => {
	const maybeGzip = loadMaybeGzip()
	const headers = { 'Content-Type': 'application/javascript' }
	const out = maybeGzip(GZIP_REQ, headers, BIG_JS)
	assert.equal(headers['Content-Encoding'], 'gzip')
	assert.match(headers['Vary'], /Accept-Encoding/, 'caches must not serve gzip to a client that did not ask')
	assert.equal(headers['Content-Length'], String(out.length))
	assert.ok(out.length < Buffer.byteLength(BIG_JS) / 2, `expected real compression, got ${out.length}`)
	assert.equal(zlib.gunzipSync(out).toString('utf8'), BIG_JS, 'and it must round-trip exactly')
})

test('WO-498: a client that does not offer gzip gets the raw body', () => {
	const maybeGzip = loadMaybeGzip()
	const headers = { 'Content-Type': 'application/javascript' }
	assert.equal(maybeGzip({ headers: {} }, headers, BIG_JS), BIG_JS)
	assert.equal(headers['Content-Encoding'], undefined)
})

test('WO-498: already-compressed and tiny bodies are left alone', () => {
	const maybeGzip = loadMaybeGzip()
	for (const ct of ['image/png', 'font/woff2', 'application/octet-stream']) {
		const h = { 'Content-Type': ct }
		assert.equal(maybeGzip(GZIP_REQ, h, BIG_JS), BIG_JS, `${ct} must not be re-compressed`)
		assert.equal(h['Content-Encoding'], undefined)
	}
	const small = { 'Content-Type': 'text/css' }
	assert.equal(maybeGzip(GZIP_REQ, small, 'body{color:red}'), 'body{color:red}', 'below the min size')
	assert.equal(small['Content-Encoding'], undefined)
})

test('WO-498: CSS, HTML, JSON and SVG all qualify', () => {
	const maybeGzip = loadMaybeGzip()
	for (const ct of ['text/css', 'text/html', 'application/json', 'image/svg+xml']) {
		const h = { 'Content-Type': ct }
		const out = maybeGzip(GZIP_REQ, h, BIG_JS)
		assert.equal(h['Content-Encoding'], 'gzip', `${ct} should compress`)
		assert.ok(Buffer.isBuffer(out))
	}
})

test('WO-498: streamed responses are never gzipped (no buffered body)', () => {
	const src = read('src/server/http-server.js')
	assert.match(
		src,
		/result\.stream \? result\.body : maybeGzip\(req, headers, result\.body\)/,
		'the stream branch must bypass compression',
	)
})

test('WO-498: the nginx proxy is gone from the repo', () => {
	assert.equal(exists('config/nginx/highascg-web-proxy.conf'), false, 'proxy conf must be deleted')
	assert.equal(exists('scripts/runtime/install-highascg-web-proxy.sh'), false, 'installer must be deleted')
	assert.equal(exists('scripts/runtime/remove-highascg-web-proxy.sh'), true, 'a remover must be provided')
})

test('WO-498: nothing still provisions or asserts nginx', () => {
	for (const rel of [
		'tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh',
		'tools/eggs/live-usb/verify-eggs-prepare-host.sh',
		'tools/eggs/live-usb/verify-highascg-stick-boot.sh',
		'scripts/setup/17-operator-tools.sh',
	]) {
		const src = read(rel)
		assert.equal(
			/install-highascg-web-proxy\.sh/.test(src),
			false,
			`${rel} must not install the removed proxy`,
		)
		assert.equal(/highascg_apt_install[^\n]*\bnginx\b/.test(src), false, `${rel} must not apt-install nginx`)
	}
})

test('WO-498: the boot test no longer probes port 80', () => {
	const src = read('tools/startup/stick-boot-test/tests/test-08-highascg-ui.sh')
	assert.equal(/http:\/\/127\.0\.0\.1\/\s/.test(src), false, 'port 80 is not served any more')
	assert.match(src, /http:\/\/127\.0\.0\.1:4200\//, 'the UI is on :4200')
})
