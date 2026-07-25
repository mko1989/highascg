const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { clone, appWithCabledAudioOutput } = require('./lib/config-generator-routing-fixtures')

/*
 * Split out of tools/smoke/smoke-config-generator-routing.js for line-count hygiene — see also:
 *   tools/smoke/smoke-config-generator-routing-2.js
 *   tools/smoke/smoke-config-generator-routing-3.js
 * Shared fixture builders live in tools/smoke/lib/config-generator-routing-fixtures.js.
 */

test('WO-297: stream layout resolver agrees with the generated <channel-layout>', () => {
	const { resolveSourceProgramAudioLayout } = require('../../src/api/routes-streaming-channel-shared')
	const app = appWithCabledAudioOutput('8ch')

	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_audio_layout, '8ch', 'cabled 8ch output widens the generated program bus')

	const xml = buildConfigXml(flat)
	const pgm = xml.match(/Screen 1 program output \(PGM\)[\s\S]*?<channel-layout>([^<]+)<\/channel-layout>/)
	assert.ok(pgm, 'PGM channel carries a <channel-layout>')
	assert.equal(pgm[1], 'discrete-8ch', 'generated PGM channel is the discrete 8ch bus')

	assert.equal(
		resolveSourceProgramAudioLayout(app, 'program_1'),
		flat.screen_1_audio_layout,
		'stream/record downmix layout must match the generated channel layout, not the destination field alone',
	)
})

test('WO-297: stream consumer carries an audio codec and an explicit pan for the configured pair', () => {
	const { resolveSourceProgramAudioLayout } = require('../../src/api/routes-streaming-channel-shared')
	const { buildStreamingRtmpFfmpegArgs } = require('../../src/streaming/streaming-channel-ffmpeg')
	const app = appWithCabledAudioOutput('8ch')
	const programLayout = resolveSourceProgramAudioLayout(app, 'program_1')

	const argsAll = buildStreamingRtmpFfmpegArgs('medium', { programLayout, audioSourcePair: 'all' })
	assert.match(argsAll, /-codec:a aac/, 'stream must encode audio (never silently video-only)')
	assert.doesNotMatch(argsAll, /(^|\s)-an(\s|$)/, 'stream must not be muted')
	assert.doesNotMatch(argsAll, /-map\b/, 'no video-only -map may reach the consumer')
	assert.match(argsAll, /-filter:a pan=stereo\|c0=c0\|c1=c1/, 'discrete bus needs an explicit pan, not a blind stereo remix')
	assert.match(argsAll, /-ac 2/, 'downmixed bus declares 2 channels')

	const argsPair = buildStreamingRtmpFfmpegArgs('medium', { programLayout, audioSourcePair: '3+4' })
	assert.match(argsPair, /-filter:a pan=stereo\|c0=c2\|c1=c3/, 'configured audioSourcePair selects that pair')
	assert.match(argsPair, /-codec:a aac/, 'pair selection still encodes audio')
})

test('WO-297: record consumer follows the same resolved layout', () => {
	const { resolveSourceProgramAudioLayout, recordFfmpegArgs } = require('../../src/api/routes-streaming-channel-shared')
	const app = appWithCabledAudioOutput('8ch')
	const programLayout = resolveSourceProgramAudioLayout(app, 'program_1')
	const args = recordFfmpegArgs({ programLayout, audioSourcePair: 'all' })
	assert.match(args, /-codec:a aac/, 'record must encode audio')
	assert.match(args, /-filter:a pan=stereo\|c0=c0\|c1=c1/, 'record downmixes the discrete bus explicitly')
})

test('WO-297: a genuinely stereo program bus is unchanged (on-air stream stays byte-identical)', () => {
	const { resolveSourceProgramAudioLayout } = require('../../src/api/routes-streaming-channel-shared')
	const { buildStreamingRtmpFfmpegArgs } = require('../../src/streaming/streaming-channel-ffmpeg')

	// Stereo output cabled to a stereo destination — nothing to widen.
	const stereoApp = appWithCabledAudioOutput('stereo')
	assert.equal(resolveSourceProgramAudioLayout(stereoApp, 'program_1'), 'stereo', 'stereo cabling stays stereo')

	// No audio output cabled at all — the PGM 2 / ch3 shape that is currently on air.
	const bare = clone(defaults)
	bare.screen_count = 2
	bare.casparServer = { ...bare.casparServer, screen_count: 2 }
	bare.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'pgm1', label: 'PGM 1', mainScreenIndex: 0, mode: 'pgm_prv', audioLayout: 'stereo', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'pgm2', label: 'PGM 2', mainScreenIndex: 1, mode: 'pgm_only', audioLayout: 'stereo', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	assert.equal(resolveSourceProgramAudioLayout(bare, 'program_2'), 'stereo', 'uncabled stereo PGM 2 stays stereo')

	const args = buildStreamingRtmpFfmpegArgs('medium', { programLayout: 'stereo', audioSourcePair: 'all' })
	assert.match(args, /-filter:a aresample=48000 -filter:a aformat=channel_layouts=stereo -codec:a aac/, 'stereo arg string is unchanged')
	assert.doesNotMatch(args, /pan=/, 'stereo bus emits no pan')
	assert.doesNotMatch(args, /-ac /, 'stereo bus emits no -ac')
})
