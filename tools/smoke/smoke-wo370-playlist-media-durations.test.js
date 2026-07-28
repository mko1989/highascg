'use strict'

/**
 * WO-370 smoke — playlist rows show each clip's REAL length, never the timeless default.
 *
 * (a) media-duration.js resolves durations off `state.media`, including the live duplicate-entry
 *     trap: the CINF-derived row for "0.0_VB1_OPENING TREEFILM MASTER" claims 30257742 ms (8.4 h,
 *     fps 0.04) for a clip the ffprobe row measures at 52636 ms. Normalisation collapses both onto
 *     one basename key, so the tie-break is load-bearing — the fixtures below are real
 *     `GET /api/media` output from the box (WO-370 §1d).
 * (b) inspector-layer-playlist.js no longer renders the hardcoded `5` on media rows: the duration
 *     INPUT is gated on isTimelessItem and timed media renders static text instead.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')

/* Real rows from GET /api/media on this box (28.07.26), trimmed to the fields the index reads. */
const LIVE_MEDIA = [
	{ id: '0.0_VB1_OPENING TREEFILM MASTER', type: 'MOVIE', fps: 0.04, durationMs: 30257742, cinf: '... 1262 1001/24000' },
	{ id: '0.0_VB1_Opening Treefilm Master.mp4', durationMs: 52636, hasAudio: true, resolution: '1920×1080', codec: 'h264', fps: 23.98 },
	{ id: '0.1_VB2_Summer Rally intro video_short video SR 2026.mp4', durationMs: 17584, resolution: '1920×1080', codec: 'h264', fps: 29.97 },
	{ id: '01_Grzegorz Zytka.mov', durationMs: 10000, fps: 30, type: 'MOVIE', cinf: '... 300 1/30', resolution: '1920×1080', codec: 'hap' },
	{ id: 'no-duration.mp4', resolution: '1920×1080', codec: 'h264', fps: 25 },
]

test('WO-370 media duration index', async (t) => {
	const mod = await import('../../client/lib/media-duration.js')
	mod._setMediaForTest(LIVE_MEDIA)

	await t.test('probed row wins over the broken CINF row on the same basename', () => {
		// The 8.4-hour lie must never surface, under either id spelling.
		assert.equal(mod.mediaDurationMs('0.0_VB1_Opening Treefilm Master.mp4'), 52636)
		assert.equal(mod.mediaDurationMs('0.0_VB1_OPENING TREEFILM MASTER'), 52636)
		assert.equal(mod.formatClipDuration(mod.mediaDurationMs('0.0_VB1_Opening Treefilm Master.mp4')), '0:53')
	})

	await t.test('plain lookups, case/extension/path tolerant like media-exists', () => {
		assert.equal(mod.mediaDurationMs('0.1_VB2_Summer Rally intro video_short video SR 2026.mp4'), 17584)
		assert.equal(mod.mediaDurationMs('0.1_vb2_summer rally intro video_short video sr 2026'), 17584)
		assert.equal(mod.mediaDurationMs('media\\01_Grzegorz Zytka.mov'), 10000)
	})

	await t.test('unknown / duration-less values return null — never a made-up number', () => {
		assert.equal(mod.mediaDurationMs('no-duration.mp4'), null)
		assert.equal(mod.mediaDurationMs('nowhere-near-the-index.mp4'), null)
		assert.equal(mod.mediaDurationMs(''), null)
		assert.equal(mod.mediaDurationMs(null), null)
	})

	await t.test('a sub-1 fps row alone is refused, not trusted', () => {
		mod._setMediaForTest([LIVE_MEDIA[0], LIVE_MEDIA[2]])
		assert.equal(mod.mediaDurationMs('0.0_VB1_OPENING TREEFILM MASTER'), null)
		mod._setMediaForTest(LIVE_MEDIA)
	})

	await t.test('two probed rows disagreeing by >10x resolve to null', () => {
		mod._setMediaForTest([
			{ id: 'dup/clip.mp4', durationMs: 5000, codec: 'h264', fps: 25 },
			{ id: 'other/clip.mov', durationMs: 900000, codec: 'prores', fps: 25 },
		])
		assert.equal(mod.mediaDurationMs('dup/clip.mp4'), 5000) // exact id still wins
		assert.equal(mod.mediaDurationMs('elsewhere/clip'), null) // basename-only → contradictory
		mod._setMediaForTest(LIVE_MEDIA)
	})

	await t.test('compact formatting: m:ss and h:mm:ss, empty when unknown', () => {
		assert.equal(mod.formatClipDuration(52636), '0:53')
		assert.equal(mod.formatClipDuration(17584), '0:18')
		assert.equal(mod.formatClipDuration(5046000), '1:24:06')
		assert.equal(mod.formatClipDuration(null), '')
		assert.equal(mod.formatClipDuration(0), '')
	})
})

test('WO-370 inspector rows are gated on isTimelessItem', () => {
	const src = fs.readFileSync(path.join(repoRoot, 'client/components/inspector-layer-playlist.js'), 'utf8')

	// The defect: a hardcoded 5 on every row's number input.
	assert.ok(!/item\.duration \?\? 5/.test(src), 'the hardcoded 5 fallback must be gone')
	assert.ok(!/duration: 5,?$/m.test(src), 'new playlist items must not be stamped with duration: 5')

	// The fix: input only for timeless items, static length text for timed media.
	assert.ok(/const timeless = isTimelessItem\(item\)/.test(src), 'row render must classify the item')
	assert.ok(
		/playlist-item-duration[\s\S]{0,400}item\.duration \?\? timelessSecsOf\(playlist\)/.test(src),
		'the timeless input must default to the playlist timeless setting',
	)
	assert.ok(/playlist-item-length/.test(src), 'timed media must render a static length cell')
	assert.ok(
		/mediaDurationMs|formatClipDuration/.test(src),
		'row render must read real lengths from the media-duration index',
	)
})

test('WO-370 duration index is wired at app init', () => {
	const app = fs.readFileSync(path.join(repoRoot, 'client/app.js'), 'utf8')
	assert.ok(/initMediaDurationIndex\(stateStore\)/.test(app), 'index must be initialised (unwired = dead)')
})
