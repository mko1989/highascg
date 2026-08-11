'use strict'

/* WO-484. A screen set to `custom` minted a `<video-mode>` from its width/height/fps even when that
 * triple already IS a shipped mode. On highascg0916 the operator-GUI screen (1920x1080@50) produced
 *
 *     <video-mode><id>1920x1080</id>…<time-scale>50000</time-scale><duration>1000</duration>
 *                 <cadence>960</cadence></video-mode>
 *
 * which is `1080p5000` spelled differently — CasparCG's own table has exactly those numbers
 * (video_format.cpp: `x1080p5000, … 50000, 1000, L"1080p5000", {960}`).
 *
 * It is not only redundant: the channel then runs as `video_format::custom`, so a DeckLink consumer
 * cannot match it to a BMDDisplayMode by identity and falls back to conversion — the box logs
 * "Device supports video-format with conversion: 1080p50" on exactly those channels.
 *
 * A genuinely non-standard size (6144x1536, the two-head PGM1 canvas) must still get its mode. */

const test = require('node:test')
const assert = require('node:assert/strict')

const { getModeDimensions, findStandardModeId, STANDARD_VIDEO_MODES } = require('../../src/config/config-modes')
const { pushCustomMode } = require('../../src/config/config-generator-custom-modes')

/** A config with screen `idx` set to custom WxH@fps. */
function customScreen(idx, w, h, fps) {
	return {
		[`screen_${idx}_mode`]: 'custom',
		[`screen_${idx}_custom_width`]: String(w),
		[`screen_${idx}_custom_height`]: String(h),
		[`screen_${idx}_custom_fps`]: String(fps),
	}
}

test('WO-484: custom dimensions that match a shipped mode resolve to that mode', () => {
	const dims = getModeDimensions('custom', customScreen(4, 1920, 1080, 50), 4)
	assert.equal(dims.modeId, '1080p5000', '1920x1080@50 IS 1080p5000')
	assert.equal(dims.isCustom, false, 'so nothing custom needs registering')
	assert.equal(dims.width, 1920)
	assert.equal(dims.height, 1080)
	assert.equal(dims.fps, 50)
})

test('WO-484: a genuinely non-standard canvas still gets a custom mode', () => {
	const dims = getModeDimensions('custom', customScreen(1, 6144, 1536, 50), 1)
	assert.equal(dims.modeId, '6144x1536')
	assert.equal(dims.isCustom, true, 'PGM1 spans two heads — no shipped mode covers it')
})

test('WO-484: the emitter refuses to register a duplicate of a shipped mode', () => {
	const out = []
	const ids = new Set()
	pushCustomMode(out, ids, { modeId: '1920x1080', width: 1920, height: 1080, fps: 50 })
	assert.equal(out.length, 0, 'hand-built dims must not reintroduce 1080p5000 under another name')
	pushCustomMode(out, ids, { modeId: '6144x1536', width: 6144, height: 1536, fps: 50 })
	assert.equal(out.length, 1)
	assert.match(out[0], /<id>6144x1536<\/id>/)
	/* Cadence and time-scale are validated against each other by CasparCG's parser
	 * (server.cpp: `cadence_sum * timescale != 48000 * duration * cadence.size()` throws), so a
	 * mode that fails this arithmetic stops the server from loading its config at all. */
	assert.match(out[0], /<time-scale>50000<\/time-scale>/)
	assert.match(out[0], /<duration>1000<\/duration>/)
	assert.match(out[0], /<cadence>960<\/cadence>/)
	assert.equal(960 * 50000, 48000 * 1000, 'CasparCG cadence check: cadence*timescale == 48000*duration')
})

test('WO-484: the fractional families match on their stored rates', () => {
	assert.equal(findStandardModeId(1920, 1080, 59.94), '1080p5994')
	assert.equal(findStandardModeId(1920, 1080, 23.98), '1080p2398')
	assert.equal(findStandardModeId(3840, 2160, 50), '2160p5000')
	assert.equal(findStandardModeId(6144, 1536, 50), '', 'no shipped mode for the PGM1 canvas')
	for (const [id, spec] of Object.entries(STANDARD_VIDEO_MODES)) {
		const hit = findStandardModeId(spec.width, spec.height, spec.fps)
		assert.ok(hit, `${id} must be findable by its own dimensions`)
	}
})
