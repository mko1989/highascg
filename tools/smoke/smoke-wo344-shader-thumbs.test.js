'use strict'

/**
 * WO-344 smoke — shader look-deck thumbnails.
 *
 * The crop half shipped in `465d071` (the WO's status line was stale). What this pins is the rest,
 * found by actually running the pipeline on the box:
 *
 *  1. `sh-audio` produced NO thumbnail at all — every attempt died on
 *     "CDP command timeout: Page.captureScreenshot". The CDP client had a hard 5 s per-command
 *     timeout, and a fullscreen raymarcher renders through SwiftShader here (headless has no GPU).
 *     Shader pages now get a half-size 16:9 viewport and a raised per-command budget.
 *  2. Re-saving a shader kept serving the OLD picture: the cache hash was built from the request
 *     alone (id + cgData + size), none of which change when Shader Live rewrites the .html.
 *  3. `?shaderThumb=1` gives the player a synthetic spectrum when no real audio is flowing, and
 *     skips getUserMedia (no capture device in headless). Real WS frames still outrank it.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

test('WO-344 slow shader pages get a bigger CDP budget than the 5s default', () => {
	const cdp = read('src/system/cef-cdp-client.js')
	assert.ok(/send\(method, params = \{\}, sendOpts = \{\}\)/.test(cdp), 'send() must accept a per-command override')
	assert.ok(
		/const timeoutMs = Number\(sendOpts\?\.timeoutMs\) > 0 \? Number\(sendOpts\.timeoutMs\) : CDP_COMMAND_TIMEOUT_MS/.test(cdp),
		'the default must still apply when no override is passed',
	)

	const page = read('src/media/headless-chrome-cdp.js')
	assert.ok(/commandTimeoutMs\?: number/.test(page), 'openPage must document the option')
	assert.ok(/timeoutMs: shotOpts\.timeoutMs \|\| commandTimeoutMs/.test(page), 'screenshots must honour it')

	const render = read('src/media/cg-look-thumb-render.js')
	assert.ok(/const SHADER_CDP_TIMEOUT_MS = (\d+)/.test(render))
	assert.ok(Number(/const SHADER_CDP_TIMEOUT_MS = (\d+)/.exec(render)[1]) >= 15000, 'must clear the observed ~10.6s render')
	assert.ok(/commandTimeoutMs: shaderReq \? SHADER_CDP_TIMEOUT_MS : undefined/.test(render), 'shader pages only')
})

test('WO-344 shader thumbs render at a smaller 16:9 viewport', () => {
	const render = read('src/media/cg-look-thumb-render.js')
	const w = Number(/const SHADER_VIEWPORT_W = (\d+)/.exec(render)?.[1])
	const h = Number(/const SHADER_VIEWPORT_H = (\d+)/.exec(render)?.[1])
	assert.ok(w > 0 && h > 0)
	assert.equal(w / h, 16 / 9, 'a non-16:9 thumb viewport would letterbox every shader')
	assert.ok(w < 1920, 'the point is fewer pixels for the CPU rasteriser')
	assert.ok(w >= 640, 'must stay above the deck button size (640×360) so the thumb is not upscaled')
})

test('WO-344 the cache busts when the shader file changes', () => {
	const { hashCgThumbRequest } = require('../../src/media/cg-look-thumb-cache.js')

	// Any template file works — the fingerprint is generic; shaders are just where it bit.
	const shaders = fs
		.readdirSync(path.join(repoRoot, 'template/shaders'))
		.filter((f) => /^sh-.*\.html$/.test(f))
	if (!shaders.length) return // box-owned store may be empty on a fresh checkout
	const slug = shaders[0].replace(/\.html$/, '')
	const req = { sourceValue: `shaders/${slug}`, width: 640, height: 360 }

	const a = hashCgThumbRequest(req)
	assert.equal(hashCgThumbRequest(req), a, 'hash must be stable while the file is untouched')

	const file = path.join(repoRoot, 'template/shaders', shaders[0])
	const st = fs.statSync(file)
	try {
		fs.utimesSync(file, st.atime, new Date(st.mtimeMs + 60_000))
		assert.notEqual(hashCgThumbRequest(req), a, 're-saving a shader must produce a different cache key')
	} finally {
		fs.utimesSync(file, st.atime, st.mtime)
	}
})

test('WO-344 an unresolvable template still hashes (fingerprint is best-effort)', () => {
	const { hashCgThumbRequest } = require('../../src/media/cg-look-thumb-cache.js')
	const h = hashCgThumbRequest({ sourceValue: 'shaders/does-not-exist-anywhere' })
	assert.match(h, /^[a-f0-9]{32}$/, 'a missing file must not throw or empty the hash')
})

test('WO-344 thumbnail audio mode is opt-in and never outranks real audio', () => {
	const player = read('template/shaders/player.js')
	assert.ok(/const THUMB_MODE = query\.get\('shaderThumb'\) === '1'/.test(player), 'must be query-gated')
	assert.ok(
		/if \(THUMB_MODE && Date\.now\(\) - lastFftAt >= FFT_FRESH_MS\)/.test(player),
		'a fresh real audio_fft frame must still win — the synthetic spectrum is a floor, not an override',
	)
	assert.ok(/if \(!THUMB_MODE\) void initTierA\(\)/.test(player), 'getUserMedia is pointless headless')

	const render = read('src/media/cg-look-thumb-render.js')
	assert.ok(/\?shaderThumb=1/.test(render), 'the renderer must actually pass the flag')
	// Playout must never get it: the flag lives only in the thumbnail navigation URL.
	const exporter = read('src/shaderfx/shader-template-export.js')
	assert.ok(!/shaderThumb/.test(exporter), 'exported templates must not carry the thumbnail flag')
})
