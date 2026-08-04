'use strict'

/**
 * WO-418 smoke — review 2026-08-03 "fix first" rows 1–5:
 *  1. project slug traversal (live-verified read of config/general.json via ..%2f)
 *  2. AMCP CR/LF injection through param()/encoderPreset (line-delimited protocol)
 *  3. stream/spawn 'error' handlers (uncaughtException → process.exit(1) guard)
 *  4. take Phase-B swallow now logs
 *  5. profiler healthy flag inversion (behavior pinned in smoke-wo401, source-pinned here)
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const store = require('../../src/engine/project-store')
const { param, audioFilterParam, clipParamForPlay } = require('../../src/caspar/amcp-utils')
const { recordFfmpegArgs } = require('../../src/api/routes-streaming-channel-shared')
const { buildStreamingRtmpFfmpegArgs } = require('../../src/streaming/streaming-channel-ffmpeg')

test('WO-418.1: traversal slugs are refused everywhere, legit slugs pass', () => {
	for (const bad of ['../config/general', '..', 'a/b', 'a\\b', '.hidden', 'a\0b', '', 'x'.repeat(200)]) {
		assert.equal(store.isSafeProjectSlug(bad), false, `unsafe: ${JSON.stringify(bad)}`)
		assert.equal(store.readProjectFile(bad), null, `read must null: ${JSON.stringify(bad)}`)
		assert.equal(store.retireProjectSlug(bad), false, `retire must refuse: ${JSON.stringify(bad)}`)
		assert.throws(() => store.projectFilePath(bad), /invalid project slug/, `path must throw: ${JSON.stringify(bad)}`)
	}
	// projectSlugFromName output + Syncthing conflict copies are the legit population.
	for (const good of ['wesele', 'lap_test', 'moj1', 'llkk.sync-conflict-20260701-123456-ABCDEF']) {
		assert.equal(store.isSafeProjectSlug(good), true, `safe: ${good}`)
		assert.ok(store.projectFilePath(good).startsWith(store.projectsDir() + path.sep))
	}
	// The persisted-slug write primitive: setActiveSlug must never store a traversal slug.
	const kv = new Map()
	const persistence = { set: (k, v) => kv.set(k, v), get: (k) => kv.get(k) }
	store.setActiveSlug(persistence, '../config/general')
	assert.equal(kv.size, 0, 'unsafe slug not persisted')
	store.setActiveSlug(persistence, 'wesele')
	assert.equal(kv.get(store.ACTIVE_SLUG_KEY), 'wesele')
})

test('WO-418.2: no CR/LF survives into any AMCP-bound string', () => {
	assert.ok(!/[\r\n]/.test(param('veryfast\r\nKILL')), 'param folds CRLF')
	assert.ok(!/[\r\n]/.test(audioFilterParam('pan=x\nKILL')), 'audioFilterParam folds LF')
	assert.ok(!/[\r\n]/.test(clipParamForPlay('clip\r\nKILL')), 'clipParamForPlay folds CRLF')

	const rec = recordFfmpegArgs({ encoderPreset: 'veryfast\r\nKILL' })
	assert.ok(!/[\r\n]/.test(rec), 'record args single-line')
	assert.match(rec, /-preset:v veryfast/, 'bad preset falls back to default')

	const rtmp = buildStreamingRtmpFfmpegArgs('medium', { encoderPreset: 'x\r\nKILL 1' })
	assert.ok(!/[\r\n]/.test(rtmp), 'rtmp args single-line')
	assert.match(rtmp, /-preset:v veryfast/, 'bad preset falls back to quality default')
	// Legit non-default presets still pass the whitelist.
	assert.match(buildStreamingRtmpFfmpegArgs('medium', { encoderPreset: 'slow' }), /-preset:v slow/)
})

test('WO-418.3/4/5: error handlers + take log + healthy semantics (source pins)', () => {
	// Row 3: every spawn/stream site the review named now registers 'error'.
	assert.match(read('src/audio/live-audio-bridge.js'), /proc\.on\('error'/, 'live-audio-bridge')
	assert.match(read('src/capture/v4l2-input-bridge.js'), /proc\.on\('error'/, 'v4l2-input-bridge')
	assert.match(read('src/preview/gui-stream-ingest.js'), /proc\.on\('error'/, 'gui-stream-ingest')
	assert.match(read('src/media/usb-drives-discovery.js'), /child\.on\('error'/, 'usb-drives-discovery')
	const ingest = read('src/api/routes-ingest.js')
	assert.match(ingest, /writeStream\.on\('error', onStreamError\)/, 'ingest write stream')
	assert.match(ingest, /file\.on\('error', onStreamError\)/, 'ingest busboy file stream')

	// Row 4: the take Phase-B catch is no longer silent.
	assert.match(
		read('src/engine/scene-take-lbg-amcp-pipeline.js'),
		/take Phase B \(PLAY\/crossfade\/COMMIT\) failed on ch/,
		'Phase-B failure logs with channel context',
	)

	// Row 5: healthy means MEETING the frame budget (no inverted negation).
	const oscState = read('src/osc/osc-state.js')
	assert.match(oscState, /const healthy = !measurable \|\| actual <= expected \* 1\.05/, 'healthy = within budget')
	assert.ok(!oscState.includes('const healthy = !(Number.isFinite'), 'inverted form gone')
})
