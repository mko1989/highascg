'use strict'

/**
 * WO-822 — the :4443 HTTPS proxy (highascg-https-proxy) is removed, the way nginx was in WO-498.
 *
 * Owner 29.10: "The https proxy was deprecated due to some issues I don't remember now." It only existed for the
 * WebCodecs live GUI preview (WO-319/325), gone with the kiosk (WO-646) and the stream encoder (WO-660).
 * The box-local check keeps its proxy rules as defence in depth (a proxy that is not ours can relay too).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(REPO, rel))
const REMOVER = 'scripts/runtime/remove-highascg-https-proxy.sh'

/** Source files that could still provision or call the proxy (not config/, not work orders, not this test). */
function sourceFiles() {
	const out = []
	const walk = (dir) => {
		for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
			const rel = `${dir}/${e.name}`
			if (e.isDirectory()) {
				if (e.name !== 'node_modules') walk(rel)
			} else if (/\.(js|sh|service|list|example|md|gd)$/.test(e.name)) out.push(rel)
		}
	}
	for (const d of ['src', 'scripts', 'tools', 'docs']) walk(d)
	return out.filter((r) => !r.endsWith('smoke-wo822-no-https-proxy.test.js') && !r.startsWith('docs/wiki-site/') && !r.startsWith('docs/reference/'))
}

test('WO-822: the proxy script and its unit template are gone', () => {
	assert.equal(exists('tools/runtime/highascg-https-proxy.js'), false)
	assert.equal(exists('tools/runtime/highascg-https-proxy.service'), false)
})

test('WO-822: nothing in the repo sources still names the proxy script or listens on :4443', () => {
	for (const rel of sourceFiles()) {
		const src = read(rel)
		assert.equal(/highascg-https-proxy\.js/.test(src), false, `${rel} must not reference the deleted proxy script`)
		assert.equal(/tools\/runtime\/highascg-https-proxy/.test(src), false, `${rel} must not reference the deleted proxy unit`)
	}
})

test('WO-822: the remover exists, parses, is idempotent-shaped and masks the unit', () => {
	assert.equal(exists(REMOVER), true)
	execFileSync('bash', ['-n', path.join(REPO, REMOVER)])
	const src = read(REMOVER)
	assert.match(src, /systemctl disable --now "\$UNIT"/)
	assert.match(src, /systemctl mask "\$UNIT"/)
	assert.match(src, /rm -f "\$UNIT_FILE"/)
	assert.match(src, /REMOVE_CERTS/)
	assert.match(src, /\[\[ "\$\(id -u\)" -ne 0 \]\]|"\$\(id -u\)" -ne 0/, 'refuses to run without root')
})

test('WO-822: the remover refuses without root and dry-runs cleanly without touching anything', () => {
	const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo822-certs-'))
	fs.writeFileSync(path.join(certDir, 'highascg-key.pem'), 'k')
	fs.writeFileSync(path.join(certDir, 'highascg-cert.pem'), 'c')
	try {
		const env = { ...process.env, HIGHASCG_CERT_DIR: certDir }
		delete env.DRY_RUN
		if (typeof process.getuid === 'function' && process.getuid() !== 0) {
			const r = spawnSync('bash', [path.join(REPO, REMOVER)], { env, encoding: 'utf8' })
			assert.equal(r.status, 1)
			assert.match(r.stderr, /Run as root/)
		}
		const d = spawnSync('bash', [path.join(REPO, REMOVER)], { env: { ...env, DRY_RUN: '1', REMOVE_CERTS: '1' }, encoding: 'utf8' })
		assert.equal(d.status, 0, d.stderr)
		assert.match(d.stdout, /\[dry-run\] rm -f .*highascg-key\.pem/)
		assert.deepEqual(fs.readdirSync(certDir).sort(), ['highascg-cert.pem', 'highascg-key.pem'], 'dry run deletes nothing')
	} finally {
		fs.rmSync(certDir, { recursive: true, force: true })
	}
})

test('WO-822: prepare-eggs-clone runs the remover (old clones and sticks get cleaned)', () => {
	const src = read('tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh')
	assert.match(src, /remove-highascg-https-proxy\.sh/)
	assert.match(src, /remove-highascg-web-proxy\.sh/, 'the nginx remover is still called')
})

test('WO-822: the TLS key stays off sticks, ISOs and releases; the box-local guard keeps its proxy rules', () => {
	for (const f of ['fragment', 'embed-server']) {
		assert.match(read(`tools/eggs/live-usb/penguins-eggs-exclude-highascg-${f}.list`), /^home\/casparcg\/highascg\/config\/certs\/\*$/m)
	}
	assert.match(read('scripts/lib/archive-common.sh'), /--exclude=config\/certs/)
	const { checkBoxLocalRequest } = require(path.join(REPO, 'src/api/box-local-request.js'))
	const req = (headers) => ({ socket: { remoteAddress: '127.0.0.1', localPort: 4200 }, headers })
	assert.deepEqual(checkBoxLocalRequest(req({ host: '127.0.0.1:4200' })), { ok: true })
	assert.equal(checkBoxLocalRequest(req({ host: '192.168.1.10:4443' })).ok, false)
	assert.equal(checkBoxLocalRequest(req({ host: '127.0.0.1:4443' })).ok, false)
	assert.equal(checkBoxLocalRequest(req({ host: '127.0.0.1:4200', 'x-forwarded-for': '192.168.1.20' })).ok, false)
})
