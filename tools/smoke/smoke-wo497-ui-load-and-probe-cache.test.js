'use strict'

/**
 * WO-497 — the two measured, in-repo costs behind "the whole thing feels slugish as hell".
 *
 * A. Static assets were served `no-cache, no-store, must-revalidate` — including Vite
 *    CONTENT-HASHED bundles, whose filenames change whenever their bytes do. So every client
 *    re-downloaded the full eager bundle (~1.7 MB uncompressed here) on every load and every
 *    reload, through the same single-threaded Node process that drives playout.
 * B. `/api/state` re-spawned `ffprobe` for the same files forever: the selector asked "does this
 *    have a resolution", and the write-back only cached NON-EMPTY probes. A file that fails to
 *    probe (`probeMedia` resolves `{}`) was never cached; an audio-only file probed successfully
 *    but without a resolution, so it was cached AND re-selected every call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

// ---------------------------------------------------------------------------
// A — cache headers
// ---------------------------------------------------------------------------

/** Recover the shipped predicate rather than restating it, so the test cannot drift from the code. */
function loadIsContentHashedAsset() {
	const src = read('src/server/http-server.js')
	const m = src.match(/function isContentHashedAsset\(filePath\)[\s\S]*?\n}/)
	assert.ok(m, 'isContentHashedAsset must exist in http-server.js')
	return new Function('return ' + m[0].replace('function isContentHashedAsset', 'function'))()
}

test('WO-497 A: content-hashed bundles are recognised, hand-written files are not', () => {
	const isHashed = loadIsContentHashedAsset()
	for (const p of [
		'/srv/dist-web/assets/main-Uwb3-Ep9.js',
		'/srv/dist-web/assets/device-view-BWaLJ1_8.js',
		'/srv/dist-web/assets/main-CcWOg-3C.css',
	]) {
		assert.equal(isHashed(p), true, `${p} is immutable by construction and must be cacheable`)
	}
	for (const p of [
		'/srv/dist-web/index.html', // NOT hashed — it is what points at the new hashes
		'/srv/templates/led_grid_test.js',
		'/srv/dist-web/assets/logo.png', // no hash segment
		'/srv/dist-web/app.js',
	]) {
		assert.equal(isHashed(p), false, `${p} must keep revalidating`)
	}
})

/* WO-538: this one asserts on BUILD OUTPUT, and `dist-web/` is gitignored. CI's `verify` job never
 * builds the client (that is the separate `build-client` job), so on a clean machine there is no
 * index.html to read and this threw — invisibly, because the unwired-exports gate ran first and
 * aborted the job before the offline tests. Skip when the artefact is absent rather than assert
 * against a file that cannot exist: the guarantee is still enforced on every machine that has
 * built, which includes the box and any pre-push run. Restoring CI coverage means running this
 * file in `build-client` after its build step — noted in WO-538 §6. */
test('WO-497 A: the real built bundles match, and index.html does not', (t) => {
	if (!fs.existsSync(path.join(REPO, 'dist-web/index.html'))) {
		t.skip('dist-web/ not built here — run npm run build:client to exercise this')
		return
	}
	const isHashed = loadIsContentHashedAsset()
	const indexHtml = read('dist-web/index.html')
	const refs = [...indexHtml.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
	assert.ok(refs.length >= 3, `expected eager asset refs in dist-web/index.html, got ${refs.length}`)
	for (const r of refs) {
		assert.equal(isHashed('/srv/dist-web/' + r), true, `${r} is eagerly loaded and must be cacheable`)
	}
	assert.equal(isHashed('/srv/dist-web/index.html'), false)
})

test('WO-497 A: hashed assets get immutable caching, everything else still no-store', () => {
	const src = read('src/server/http-server.js')
	const block = src.slice(src.indexOf("if (ext === '.html' || ext === '.js'", src.indexOf('const relPath')))
	assert.match(block, /isContentHashedAsset\(fullPath\)/, 'the static branch must consult the predicate')
	assert.match(block, /public, max-age=31536000, immutable/)
	assert.match(block, /no-cache, no-store, must-revalidate/, 'the non-hashed branch must survive')
})

// ---------------------------------------------------------------------------
// B — probe cache
// ---------------------------------------------------------------------------

/** The shipped selector + write-back, exercised against a fake probe. */
function runProbePass(cache, media, probe) {
	const toProbe = media.filter((c) => !(c.id in cache)).slice(0, 120)
	for (const c of toProbe) {
		const p = probe(c.id)
		cache[c.id] = p && Object.keys(p).length ? p : {}
	}
	return toProbe.map((c) => c.id)
}

test('WO-497 B: a file that fails to probe is never re-probed', () => {
	const cache = {}
	const media = [{ id: 'broken.mov' }]
	const probe = () => ({}) // probeMedia resolves {} on spawn error / non-zero exit
	assert.deepEqual(runProbePass(cache, media, probe), ['broken.mov'], 'probed once')
	assert.deepEqual(runProbePass(cache, media, probe), [], 'and never again')
	assert.deepEqual(runProbePass(cache, media, probe), [])
})

test('WO-497 B: an audio-only file is probed once, not on every call', () => {
	const cache = {}
	const media = [{ id: 'stinger.wav' }]
	// Probes SUCCESSFULLY but has no resolution and no fps — the old filter matched it forever.
	const probe = () => ({ hasAudio: true, durationMs: 4200, fileSize: 123456 })
	assert.deepEqual(runProbePass(cache, media, probe), ['stinger.wav'])
	assert.deepEqual(runProbePass(cache, media, probe), [], 'the previous selector re-spawned ffprobe here')
	assert.equal(cache['stinger.wav'].hasAudio, true, 'and the useful metadata is kept')
})

test('WO-497 B: a normal video is probed once and its metadata retained', () => {
	const cache = {}
	const media = [{ id: 'clip.mp4' }]
	const probe = () => ({ resolution: '1920x1080', fps: 50, durationMs: 1000 })
	assert.deepEqual(runProbePass(cache, media, probe), ['clip.mp4'])
	assert.deepEqual(runProbePass(cache, media, probe), [])
	assert.equal(cache['clip.mp4'].fps, 50)
})

test('WO-497 B: only genuinely new files are probed on a later call', () => {
	const cache = {}
	const probe = () => ({})
	runProbePass(cache, [{ id: 'a' }, { id: 'b' }], probe)
	assert.deepEqual(runProbePass(cache, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], probe), ['c'])
})

test('WO-497 B: the shipped selector keys on presence, not on the probe result', () => {
	const src = read('src/api/routes-state.js')
	assert.match(src, /!\(c\.id in ctx\._mediaProbeCache\)/, 'selection must be "have we probed it yet"')
	assert.equal(
		/return !existing\?\.resolution/.test(src),
		false,
		'the resolution-based selector is what re-spawned ffprobe forever',
	)
	assert.match(src, /ctx\._mediaProbeCache\[c\.id\] = p && Object\.keys\(p\)\.length \? p : \{\}/, 'empties cached too')
})
