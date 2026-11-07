'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { collectFilesForImport } = require('../../src/media/usb-drives-copy')
const { resolveSafe } = require('../../src/media/local-media-paths')
const { isSafeProjectSlug } = require('../../src/engine/project-store')
const { param } = require('../../src/caspar/amcp-utils')
const { checkHttpAuth, checkWebSocketAuth, isOriginAllowed } = require('../../src/server/auth')
const { redactObject } = require('../../src/support/redact-settings')

function fixture(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo986-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const root = path.join(dir, 'usb')
	const outside = path.join(dir, 'outside')
	fs.mkdirSync(root)
	fs.mkdirSync(outside)
	fs.writeFileSync(path.join(outside, 'private.mp4'), 'synthetic-private-data')
	fs.symlinkSync(outside, path.join(root, 'escape'))
	fs.mkdirSync(path.join(root, 'normal'))
	fs.writeFileSync(path.join(root, 'normal', 'clip.mp4'), 'normal')
	return { root, outside }
}

test('USB explicit item cannot traverse a symlinked parent', t => {
	const { root } = fixture(t)
	const result = collectFilesForImport(root, ['escape/private.mp4'])
	assert.equal(result.files.length, 0)
	assert.ok(result.error)
})

test('USB ordinary nested files and a symlinked mount root still work', t => {
	const { root } = fixture(t)
	const alias = root + '-alias'
	fs.symlinkSync(root, alias)
	const result = collectFilesForImport(alias, ['normal'])
	assert.equal(result.error, undefined)
	assert.deepEqual(result.files.map(f => f.rel), ['normal/clip.mp4'])
})

test('USB directory scan still skips symlink entries without aborting', t => {
	const { root } = fixture(t)
	fs.symlinkSync('/nonexistent-wo986-target', path.join(root, 'dangling'))
	const result = collectFilesForImport(root, [''])
	assert.equal(result.error, undefined)
	assert.deepEqual(result.files.map(f => f.rel), ['normal/clip.mp4'])
})

// WO-986 finding 2 — executable TODO: media deliberately follows bridge/project links, so the fix is an allowlist of
// canonical roots (proposal), not a blanket no-symlink rule. Flip `todo` off when that lands.
test('media guard refuses a directory link that leaves every allowed root', { todo: 'WO-986 finding 2: canonical media-root allowlist' }, t => {
	const { root } = fixture(t)
	assert.equal(resolveSafe(root, 'escape/private.mp4'), null)
})

test('project slugs refuse traversal and AMCP quoting folds command delimiters', () => {
	for (const slug of ['../config/security', '..\\config\\security', '/tmp/x', 'x\0y']) {
		assert.equal(isSafeProjectSlug(slug), false)
	}
	assert.equal(isSafeProjectSlug('show_01'), true)
	const quoted = param('clip"\r\nCLEAR 1\r\n(foo)')
	assert.ok(!/[\r\n]/.test(quoted))
	assert.ok(quoted.startsWith('"') && quoted.endsWith('"'))
	assert.ok(quoted.includes('\\"'))
})

test('design contract (WO-811, enforceAuth off): LAN-open mode admits unauthenticated mutations and foreign origins', () => {
	const config = { security: { enforceAuth: false } }
	const req = { headers: { origin: 'https://attacker.example', host: 'playout:4200' } }
	assert.equal(checkHttpAuth('POST', '/api/settings', req, { config }).ok, true)
	assert.equal(checkWebSocketAuth(req, { config }).ok, true)
	assert.equal(isOriginAllowed(req, config), true)
})

test('base redaction masks token keys; support redaction masks credential-bearing stream URLs', () => {
	const input = { rtmpServerUrl: 'rtmp://example.invalid/live/synthetic-key', apiToken: 'synthetic-token' }
	assert.equal(redactObject(input).apiToken, '[REDACTED]')
	assert.notEqual(redactObject(input, { forSupport: true }).rtmpServerUrl, input.rtmpServerUrl)
})

// WO-986 finding 4 — executable TODO: settings GET returns stream server URLs for the inspector round-trip, so the
// fix is a credential-free URL + has-credential flag (proposal), not support-mode redaction on GET (WO-830c).
test('base redaction does not return a stream key embedded in a URL', { todo: 'WO-986 finding 4: credential-free stream URL round-trip' }, () => {
	const input = { rtmpServerUrl: 'rtmp://example.invalid/live/synthetic-key' }
	assert.ok(!String(redactObject(input).rtmpServerUrl).includes('synthetic-key'))
})
