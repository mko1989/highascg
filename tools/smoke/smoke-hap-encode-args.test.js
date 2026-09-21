'use strict'

/* WO-575: pure helpers behind the media browser's "Encode to HAP" (src/media/hap-encode-args.js).
 * The numbers in the size estimate are the real intro clips encoded by hand on 2026-09-21:
 * L_INTRO 5760x1728x3069 frames -> 15 GB on disk, s_INTRO 1920x2304x3069 -> 2.7 GB. */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const A = require('../../src/media/hap-encode-args')
const { parseProbeJson } = require('../../src/media/hap-encode-probe')
const { sweepStaleParts } = require('../../src/media/hap-encode-queue')

test('format mapping: alpha/HQ toggles; alpha+HQ falls back to HAP Alpha (D1)', () => {
	assert.deepStrictEqual(A.pickHapFormat({}), { format: 'hap', downgraded: false })
	assert.deepStrictEqual(A.pickHapFormat({ alpha: false, hq: false }), { format: 'hap', downgraded: false })
	assert.deepStrictEqual(A.pickHapFormat({ alpha: true }), { format: 'hap_alpha', downgraded: false })
	assert.deepStrictEqual(A.pickHapFormat({ hq: true }), { format: 'hap_q', downgraded: false })
	assert.deepStrictEqual(A.pickHapFormat({ alpha: true, hq: true }), { format: 'hap_alpha', downgraded: true })
	// Only a real `true` counts — a truthy string from a sloppy client must not turn alpha on.
	assert.strictEqual(A.pickHapFormat({ alpha: 'yes', hq: 1 }).format, 'hap')
})

test('output naming: same folder, _HAP suffix, always .mov', () => {
	assert.strictEqual(A.deriveOutputPath('/m/INTRA_OUTRA/L_INTRO.mov'), '/m/INTRA_OUTRA/L_INTRO_HAP.mov')
	assert.strictEqual(A.deriveOutputPath('/m/clip.mp4'), '/m/clip_HAP.mov')
	assert.strictEqual(A.deriveOutputPath('/m/a b/My.Clip v2.mkv'), '/m/a b/My.Clip v2_HAP.mov')
	assert.strictEqual(A.partPathFor('/m/x_HAP.mov'), '/m/x_HAP.mov.part')
	assert.strictEqual(A.deriveOutputId('proj/NOTCH/L_INTRO.mov'), 'proj/NOTCH/L_INTRO_HAP.mov')
	assert.strictEqual(A.deriveOutputId('clip.mp4'), 'clip_HAP.mov')
	assert.strictEqual(A.deriveOutputId('proj/CLIP'), 'proj/CLIP_HAP')
})

test('ffmpeg args never touch the frame rate (R6) and write to the .part file', () => {
	const args = A.buildFfmpegArgs({
		input: '/m/a.mov',
		outputPart: '/m/a_HAP.mov.part',
		format: 'hap_alpha',
		audioMode: 'copy',
	})
	assert.ok(!args.includes('-r'), 'no -r: 25/29.97/30/50/59.94/VFR sources must pass through unchanged')
	assert.ok(!args.some((a) => /^-(vf|filter:v|framerate)$/.test(a)), 'no filters that could resample')
	const at = (flag) => args[args.indexOf(flag) + 1]
	assert.strictEqual(at('-fps_mode'), 'passthrough')
	assert.strictEqual(at('-c:v'), 'hap')
	assert.strictEqual(at('-format'), 'hap_alpha')
	assert.strictEqual(at('-compressor'), 'snappy')
	assert.strictEqual(at('-chunks'), '4')
	assert.strictEqual(at('-pix_fmt'), 'rgba')
	assert.strictEqual(at('-c:a'), 'copy')
	assert.strictEqual(at('-i'), '/m/a.mov')
	assert.deepStrictEqual(args.slice(-3), ['-f', 'mov', '/m/a_HAP.mov.part'])
	assert.ok(!args.includes('-y'), 'must not be able to overwrite')
})

test('HAP needs width/height multiples of 4: resize to the nearest, only when needed', () => {
	assert.deepStrictEqual(A.hapSafeSize(1920, 1080), { width: 1920, height: 1080, resized: false })
	assert.deepStrictEqual(A.hapSafeSize(5760, 1728), { width: 5760, height: 1728, resized: false })
	assert.deepStrictEqual(A.hapSafeSize(1366, 768), { width: 1368, height: 768, resized: true })
	assert.deepStrictEqual(A.hapSafeSize(854, 480), { width: 856, height: 480, resized: true })
	assert.deepStrictEqual(A.hapSafeSize(70, 50), { width: 72, height: 52, resized: true })
	assert.deepStrictEqual(A.hapSafeSize(1, 1), { width: 4, height: 4, resized: true })
	const base = { input: 'i', outputPart: 'o', format: 'hap', audioMode: 'none' }
	assert.ok(!A.buildFfmpegArgs(base).includes('-vf'), 'no filter when the size is already fine')
	const scaled = A.buildFfmpegArgs({ ...base, scaleTo: { width: 1368, height: 768 } })
	assert.strictEqual(scaled[scaled.indexOf('-vf') + 1], 'scale=1368:768:flags=lanczos')
	assert.ok(!scaled.includes('-r'), 'the resize filter must not touch the frame rate either')
})

test('stderr summary leads with the real cause, not the generic last line', () => {
	const raw = [
		'[hap @ 0x1] Video size 70x50 is not multiple of 4',
		'[vost#0:0/hap @ 0x1] Error while opening encoder',
		'Error while filtering: Invalid data found when processing input',
		'[out#0/mov @ 0x2] Nothing was written into output file',
	].join('\n')
	assert.strictEqual(
		A.summarizeStderr(raw),
		'[hap @ 0x1] Video size 70x50 is not multiple of 4 | [vost#0:0/hap @ 0x1] Error while opening encoder'
	)
	assert.strictEqual(A.summarizeStderr('a\nb\nc\nd'), 'b | c | d')
	assert.strictEqual(A.summarizeStderr(''), '')
})

test('ffmpeg args: audio modes', () => {
	const base = { input: 'i', outputPart: 'o', format: 'hap' }
	const none = A.buildFfmpegArgs({ ...base, audioMode: 'none' })
	assert.ok(!none.includes('-map') || !none.includes('0:a'))
	assert.ok(!none.includes('-c:a'))
	assert.strictEqual(
		A.buildFfmpegArgs({ ...base, audioMode: 'pcm_s16le' })
			.join(' ')
			.includes('-c:a pcm_s16le'),
		true
	)
	assert.strictEqual(A.pickAudioMode([]), 'none')
	assert.strictEqual(A.pickAudioMode(['pcm_s16le']), 'copy')
	assert.strictEqual(A.pickAudioMode(['aac', 'pcm_s24le']), 'copy')
	assert.strictEqual(A.pickAudioMode(['opus']), 'pcm_s16le')
	assert.strictEqual(A.pickAudioMode(['aac', 'vorbis']), 'pcm_s16le')
})

test('size estimate is an upper bound for the real intro encodes', () => {
	const L = A.estimateOutputBytes({ width: 5760, height: 1728, frames: 3069, format: 'hap_alpha' })
	const s = A.estimateOutputBytes({ width: 1920, height: 2304, frames: 3069, format: 'hap_alpha' })
	assert.ok(L > 15e9 && L < 32e9, `L estimate ${L}`)
	assert.ok(s > 2.7e9 && s < 15e9, `s estimate ${s}`)
	assert.strictEqual(
		A.estimateOutputBytes({ width: 100, height: 100, frames: 10, format: 'hap' }) * 2,
		A.estimateOutputBytes({ width: 100, height: 100, frames: 10, format: 'hap_q' })
	)
	// non-multiple-of-4 sizes round UP to whole texture blocks
	assert.strictEqual(A.estimateOutputBytes({ width: 70, height: 50, frames: 1, format: 'hap_q' }), 72 * 52)
	assert.strictEqual(A.estimateOutputBytes({ width: 0, height: 50, frames: 1, format: 'hap' }), 0)
	assert.strictEqual(A.estimateOutputBytes({ width: 64, height: 64, frames: 0, format: 'hap' }), 0)
})

test('alpha detection from pix_fmt', () => {
	for (const f of [
		'yuva444p12le',
		'yuva420p',
		'rgba',
		'bgra',
		'argb',
		'gbrap',
		'gbrap12le',
		'ayuv64le',
		'rgba64le',
		'ya8',
	]) {
		assert.strictEqual(A.pixFmtHasAlpha(f), true, f)
	}
	for (const f of ['yuv420p', 'yuv444p12le', 'rgb24', 'bgr0', 'gbrp', 'nv12', '', undefined]) {
		assert.strictEqual(A.pixFmtHasAlpha(f), false, String(f))
	}
})

test('ffprobe json → probe result (NotchLC intro shape, still image, audio-only)', () => {
	const notch = parseProbeJson(
		JSON.stringify({
			streams: [
				{
					codec_type: 'video',
					codec_name: 'notchlc',
					width: 5760,
					height: 1728,
					pix_fmt: 'yuva444p12le',
					r_frame_rate: '30/1',
					nb_frames: '3069',
					duration: '102.300000',
				},
				{ codec_type: 'audio', codec_name: 'pcm_s16le' },
			],
			format: { duration: '102.3' },
		})
	)
	assert.strictEqual(notch.codec, 'notchlc')
	assert.strictEqual(notch.hasAlpha, true)
	assert.strictEqual(notch.fps, 30)
	assert.strictEqual(notch.frames, 3069)
	assert.deepStrictEqual(notch.audioCodecs, ['pcm_s16le'])
	// mkv: no nb_frames → estimate from duration×fps, exact count stays 0 (so verification uses duration)
	const mkv = parseProbeJson(
		JSON.stringify({
			streams: [
				{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p', r_frame_rate: '50/1' },
			],
			format: { duration: '10' },
		})
	)
	assert.strictEqual(mkv.frames, 0)
	assert.strictEqual(mkv.framesEst, 500)
	assert.strictEqual(
		parseProbeJson(JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'mp3' }], format: {} })).hasVideo,
		false
	)
	assert.strictEqual(parseProbeJson('not json'), null)
	// cover art in an mp3 is not "the video"
	const art = parseProbeJson(
		JSON.stringify({
			streams: [
				{ codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
				{ codec_type: 'audio', codec_name: 'mp3' },
			],
			format: {},
		})
	)
	assert.strictEqual(art.hasVideo, false)
})

test('progress parsing across split chunks; pct from frames, else from time', () => {
	const st = { buf: '', cur: {} }
	assert.deepStrictEqual(A.feedProgress(st, 'frame=10\nfps=30\nout_ti'), [])
	const blocks = A.feedProgress(st, 'me_us=333333\nspeed=1.5x\nprogress=continue\nframe=20\nprogress=end\n')
	assert.strictEqual(blocks.length, 2)
	assert.strictEqual(blocks[0].frame, '10')
	assert.strictEqual(blocks[0].out_time_us, '333333')
	assert.deepStrictEqual(A.progressFromBlock(blocks[0], { frames: 100 }), { pct: 0.1, speed: 1.5 })
	const byTime = A.progressFromBlock({ out_time_us: '5000000' }, { frames: 0, durationSec: 10 })
	assert.strictEqual(byTime.pct, 0.5)
	assert.strictEqual(A.progressFromBlock({ frame: '500' }, { frames: 100 }).pct, 1, 'clamped')
	assert.strictEqual(A.progressFromBlock({}, {}).pct, null)
})

test('verification: codec, size, frame count, duration tolerance', () => {
	const src = { width: 1920, height: 1080, frames: 100, durationSec: 4, fps: 25 }
	const good = { codec: 'hap', width: 1920, height: 1080, frames: 100, durationSec: 4 }
	assert.strictEqual(A.verifyEncoded(src, good), null)
	assert.match(A.verifyEncoded(src, { ...good, codec: 'h264' }), /codec/)
	assert.match(A.verifyEncoded(src, { ...good, width: 1280 }), /1280/)
	assert.match(A.verifyEncoded(src, { ...good, frames: 99 }), /99 frames/)
	assert.match(A.verifyEncoded(src, { ...good, frames: 0, durationSec: 3 }), /duration/)
	assert.strictEqual(A.verifyEncoded(src, { ...good, frames: 0, durationSec: 4.05 }), null, 'sub-frame drift is fine')
})

test('ffprobe sits next to a configured ffmpeg', () => {
	assert.strictEqual(A.ffprobeBinFor('ffmpeg'), 'ffprobe')
	assert.strictEqual(A.ffprobeBinFor('/opt/ff/bin/ffmpeg'), '/opt/ff/bin/ffprobe')
	assert.strictEqual(A.ffprobeBinFor('/opt/ff/bin/ffmpeg-static'), 'ffprobe')
})

test('startup sweep removes only stale *_HAP.mov.part, recursively', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-sweep-'))
	try {
		fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true })
		const stale = [path.join(dir, 'x_HAP.mov.part'), path.join(dir, 'a', 'b', 'y_HAP.mov.part')]
		const keep = [
			path.join(dir, 'x_HAP.mov'),
			path.join(dir, 'x.mov'),
			path.join(dir, 'other.part'),
			path.join(dir, 'a', 'z.mov.part'),
		]
		for (const f of [...stale, ...keep]) fs.writeFileSync(f, 'x')
		const removed = sweepStaleParts([dir, dir, null])
		assert.deepStrictEqual(removed.sort(), stale.sort())
		for (const f of keep) assert.ok(fs.existsSync(f), `${f} must survive`)
		for (const f of stale) assert.ok(!fs.existsSync(f))
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
