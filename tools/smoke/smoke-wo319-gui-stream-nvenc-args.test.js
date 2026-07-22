'use strict'

/**
 * WO-319 — the GUI live-stream consumer's AMCP arguments.
 *
 * Every assertion here encodes something that was VERIFIED or that FAILED on the live box on
 * 2026-07-21 (Caspar 2.6.0 253c16c Dev, tested on the on-air 2160p50 operator channel). The three
 * traps below each cost a failed attach, so they are pinned rather than trusted to review:
 *
 *  1. The audio downmix args are MANDATORY — the default mp2 encoder cannot take this box's
 *     16-channel bus ("channel layout 'hexadecagonal' is not supported"), which kills the WHOLE
 *     consumer, video included, and makes Caspar retry every 2s forever.
 *  2. `-an` is silently ignored (not a `-name:stream` option), so audio cannot be disabled — it
 *     must be downmixed.
 *  3. The muxer needs `-format mpegts`, not `-f mpegts`, or ffmpeg cannot choose an output format.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	buildGuiStreamNvencArgs,
	buildGuiStreamAddCommand,
	buildGuiStreamRemoveCommand,
	guiStreamUdpUri,
	DEFAULT_GOP,
} = require('../../src/preview/gui-stream-nvenc-args')

test('TRAP 1+2: the audio downmix is always emitted — omitting it kills the whole consumer', () => {
	const args = buildGuiStreamNvencArgs()
	assert.match(
		args,
		/-filter:a aformat=channel_layouts=stereo,aresample=48000/,
		'without the stereo downmix the mp2 default fails on the 16-channel bus and takes video down with it',
	)
	assert.match(args, /-codec:a aac/)
	assert.doesNotMatch(args, /(^|\s)-an(\s|$)/, '-an is silently ignored by this consumer; it must not be relied on')
})

test('TRAP 3: the muxer is set with -format, never -f', () => {
	const args = buildGuiStreamNvencArgs()
	assert.match(args, /-format mpegts/)
	assert.doesNotMatch(args, /(^|\s)-f mpegts/, '-f is dropped as an unused option; ffmpeg then cannot pick a format')
})

test('every option uses the -name:stream grammar Caspar actually forwards', () => {
	const args = buildGuiStreamNvencArgs()
	// The bare forms are silently dropped by ffmpeg_consumer's option map.
	for (const bare of [/(^|\s)-vf\s/, /(^|\s)-g\s/, /(^|\s)-ac\s/, /(^|\s)-r\s/]) {
		assert.doesNotMatch(args, bare, `bare option ${bare} would be ignored — use the :v/:a suffixed form`)
	}
	assert.match(args, /-codec:v h264_nvenc/, 'hardware encode, verified available in this build')
	assert.match(args, /-filter:v /)
	assert.match(args, /-g:v /)
	assert.match(args, /-b:v /)
})

test('yuv420p is forced — browsers cannot hardware-decode 4:4:4', () => {
	assert.match(buildGuiStreamNvencArgs(), /-filter:v format=yuv420p/)
	assert.match(
		buildGuiStreamNvencArgs({ scale: '1920:1080' }),
		/-filter:v scale=1920:1080,format=yuv420p/,
		'scaling must still end in yuv420p',
	)
})

test('the default GOP caps the stale-freeze after a drop to ~a quarter second', () => {
	assert.equal(DEFAULT_GOP, 12, '~0.24s keyframe interval at 50p — every drop resyncs at the next key')
	assert.match(buildGuiStreamNvencArgs(), new RegExp(`-g:v ${DEFAULT_GOP}\\b`))
	assert.match(buildGuiStreamNvencArgs({ gop: 25 }), /-g:v 25\b/)
})

test('low-latency NVENC tuning is on by default', () => {
	const args = buildGuiStreamNvencArgs()
	assert.match(args, /-preset:v p1\b/, 'p1 is the fastest preset')
	assert.match(args, /-tune:v ull\b/, 'ultra-low-latency tuning')
})

test('bitrate and fps are clamped rather than trusted', () => {
	assert.match(buildGuiStreamNvencArgs({ bitrateKbps: 999999 }), /-b:v 60000k/)
	assert.match(buildGuiStreamNvencArgs({ bitrateKbps: 1 }), /-b:v 500k/)
	assert.match(buildGuiStreamNvencArgs({ bitrateKbps: 'nonsense' }), /-b:v 8000k/)
	assert.match(buildGuiStreamNvencArgs({ gop: -5 }), /-g:v 1\b/)
})

test('the loopback URI binds a DIFFERENT local port so sender and reader do not collide', () => {
	const uri = guiStreamUdpUri(52300)
	assert.equal(uri, 'udp://127.0.0.1:52300?localport=52301')
	const m = /:(\d+)\?localport=(\d+)$/.exec(uri)
	assert.notEqual(m[1], m[2], 'a shared port is the classic "address already in use" failure here')
})

test('the ADD command is well formed and carries the full argument string', () => {
	const cmd = buildGuiStreamAddCommand({ channel: 7, consumerIndex: 702, port: 52300 })
	assert.match(cmd, /^ADD 7-702 STREAM udp:\/\/127\.0\.0\.1:52300\?localport=52301 /)
	assert.match(cmd, /-codec:v h264_nvenc/)
	assert.match(cmd, /-format mpegts$/, 'the muxer flag closes the command')
	assert.equal(buildGuiStreamRemoveCommand({ channel: 7, consumerIndex: 702 }), 'REMOVE 7-702')
})

test('a missing channel or consumer index throws instead of emitting a malformed command', () => {
	for (const bad of [{}, { channel: 7 }, { consumerIndex: 702 }, { channel: 0, consumerIndex: 702 },
		{ channel: -1, consumerIndex: 702 }, { channel: 1.5, consumerIndex: 702 }, { channel: 999, consumerIndex: 702 }]) {
		assert.throws(() => buildGuiStreamAddCommand(bad), /valid channel and consumer index/)
	}
	assert.throws(() => buildGuiStreamRemoveCommand({}), /valid channel and consumer index/)
})

test('the consumer index does not collide with any index already in use', () => {
	// 701 = compose-preview FILE consumer, 720 = meter null, 721 = DMX, 303/900 seen live on ch3.
	// A collision silently REPLACES the other consumer, so the chosen index must stay distinct —
	// see tools/smoke/smoke-consumer-index-collisions.test.js for the registry this complements.
	const TAKEN = [96, 97, 98, 303, 700, 701, 720, 721, 900]
	const cmd = buildGuiStreamAddCommand({ channel: 7, consumerIndex: 702, port: 52300 })
	const idx = parseInt(/^ADD \d+-(\d+)/.exec(cmd)[1], 10)
	assert.ok(!TAKEN.includes(idx), `consumer index ${idx} is already used by another subsystem`)
})
