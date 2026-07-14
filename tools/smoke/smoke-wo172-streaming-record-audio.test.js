'use strict'

/**
 * WO-172 T172.4/T172.5/T172.6/T172.8 — record audio filter fix + layout-aware downmix +
 * dedicated streaming-channel <channel-layout>.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { recordFfmpegArgs, resolveSourceProgramAudioLayout } = require('../../src/api/routes-streaming-channel-shared')
const { buildStreamingRtmpFfmpegArgs, buildAudioDownmixFilterChain } = require('../../src/streaming/streaming-channel-ffmpeg')
const { buildStreamingChannel } = require('../../src/config/config-generator-consumer-attach')

describe('WO-172 T172.4: record ffmpeg args — chained two-pass -filter:a (not comma-joined)', () => {
	it('never emits a comma-joined -filter:a (the documented 400 COMMAND_UNKNOWN_DATA trigger)', () => {
		const args = recordFfmpegArgs({ crf: 26 })
		assert.doesNotMatch(args, /-filter:a[^-]*,/, 'comma inside a single -filter:a value')
		assert.match(args, /-filter:a aresample=48000 -filter:a aformat=channel_layouts=stereo/)
	})

	it('matches the RTMP two-pass audio filter shape exactly for stereo (same helper)', () => {
		const recordArgs = recordFfmpegArgs({ crf: 26, audioBitrateKbps: 128 })
		const rtmpArgs = buildStreamingRtmpFfmpegArgs('medium', { audioBitrateKbps: 128 })
		const recordAudioTail = recordArgs.slice(recordArgs.indexOf('-filter:a'))
		const rtmpAudioTail = rtmpArgs.slice(rtmpArgs.indexOf('-filter:a'), rtmpArgs.indexOf('-format flv')).trim()
		assert.equal(recordAudioTail, rtmpAudioTail)
	})

	it('-an / -codec:a copy overrides are untouched by the filter-chain change', () => {
		assert.match(recordFfmpegArgs({ audioCodec: 'none' }), / -an$/)
		assert.match(recordFfmpegArgs({ audioCodec: 'copy' }), /-codec:a copy$/)
	})
})

describe('WO-172 T172.5: layout-aware downmix — stereo byte-identical, discrete-8ch explicit pan=', () => {
	it('buildAudioDownmixFilterChain: stereo (default/unset) → aformat=channel_layouts=stereo, no -ac', () => {
		assert.deepEqual(buildAudioDownmixFilterChain(), { filterA: ['aresample=48000', 'aformat=channel_layouts=stereo'], ac: null })
		assert.deepEqual(buildAudioDownmixFilterChain('stereo'), { filterA: ['aresample=48000', 'aformat=channel_layouts=stereo'], ac: null })
	})

	it('buildAudioDownmixFilterChain: 8ch (discrete-8ch program bus) → explicit pan= c0/c1, -ac 2', () => {
		const chain = buildAudioDownmixFilterChain('8ch')
		assert.deepEqual(chain, { filterA: ['aresample=48000', 'pan=stereo|c0=c0|c1=c1'], ac: 2 })
	})

	it('4ch / 16ch also downmix via the explicit c0/c1 pan (PGM 1+2 pair)', () => {
		assert.equal(buildAudioDownmixFilterChain('4ch').filterA[1], 'pan=stereo|c0=c0|c1=c1')
		assert.equal(buildAudioDownmixFilterChain('16ch').filterA[1], 'pan=stereo|c0=c0|c1=c1')
	})

	it('CRITICAL: stereo source RTMP args are byte-identical to the pre-T172.5 (post-T172.4) chain', () => {
		const withoutLayout = buildStreamingRtmpFfmpegArgs('medium', { videoBitrateKbps: 4500, fps: 50, audioBitrateKbps: 128 })
		const withStereoLayout = buildStreamingRtmpFfmpegArgs('medium', {
			videoBitrateKbps: 4500,
			fps: 50,
			audioBitrateKbps: 128,
			programLayout: 'stereo',
		})
		assert.equal(withStereoLayout, withoutLayout)
		assert.doesNotMatch(withoutLayout, /-ac \d/)
		assert.match(withoutLayout, /-filter:a aresample=48000 -filter:a aformat=channel_layouts=stereo -codec:a aac/)
	})

	it('CRITICAL: stereo source record args are byte-identical whether programLayout is passed or not', () => {
		const withoutLayout = recordFfmpegArgs({ crf: 26, audioBitrateKbps: 128 })
		const withStereoLayout = recordFfmpegArgs({ crf: 26, audioBitrateKbps: 128, programLayout: 'stereo' })
		assert.equal(withStereoLayout, withoutLayout)
	})

	it('8ch source RTMP args use an explicit pan= + -ac 2 (not blind channel_layouts=stereo)', () => {
		const args = buildStreamingRtmpFfmpegArgs('medium', { audioBitrateKbps: 128, programLayout: '8ch' })
		assert.match(args, /-filter:a aresample=48000 -filter:a pan=stereo\|c0=c0\|c1=c1 -ac 2 -codec:a aac/)
	})

	it('8ch source record args use the same explicit pan= + -ac 2', () => {
		const args = recordFfmpegArgs({ crf: 26, audioBitrateKbps: 128, programLayout: '8ch' })
		assert.match(args, /-filter:a aresample=48000 -filter:a pan=stereo\|c0=c0\|c1=c1 -ac 2 -codec:a aac/)
	})

	it('resolveSourceProgramAudioLayout: reads the cabled destination audioLayout by mainScreenIndex', () => {
		const config = {
			screenDestinations: {
				version: 1,
				destinations: [
					{ id: 'd1', mainScreenIndex: 0, mode: 'pgm_prv', audioLayout: 'stereo' },
					{ id: 'd2', mainScreenIndex: 1, mode: 'pgm_prv', audioLayout: '8ch' },
				],
			},
		}
		assert.equal(resolveSourceProgramAudioLayout(config, 'program_1'), 'stereo')
		assert.equal(resolveSourceProgramAudioLayout(config, 'program_2'), '8ch')
		assert.equal(resolveSourceProgramAudioLayout(config, 'preview_2'), '8ch')
		assert.equal(resolveSourceProgramAudioLayout(config, 'multiview'), 'stereo')
		assert.equal(resolveSourceProgramAudioLayout(config, undefined), 'stereo')
	})
})

describe('WO-172 T172.6: dedicated streaming-channel <channel-layout>', () => {
	it('emits <channel-layout>stereo</channel-layout> when the source resolves to a stereo program bus', () => {
		const config = { streamingChannel: { videoSource: 'program_1', videoMode: '1080p5000' }, screen_1_audio_layout: 'stereo' }
		const xml = buildStreamingChannel(config, 90)
		assert.match(xml, /<channel-layout>stereo<\/channel-layout>/)
	})

	it('resolves discrete-8ch from screen_N_audio_layout (Caspar id discrete-8ch, not stock 8ch)', () => {
		const config = { streamingChannel: { videoSource: 'program_2', videoMode: '1080p5000' }, screen_2_audio_layout: '8ch' }
		const xml = buildStreamingChannel(config, 90)
		assert.match(xml, /<channel-layout>discrete-8ch<\/channel-layout>/)
	})

	it('falls back to stereo for multiview / unresolved sources', () => {
		const config = { streamingChannel: { videoSource: 'multiview', videoMode: '1080p5000' } }
		const xml = buildStreamingChannel(config, 90)
		assert.match(xml, /<channel-layout>stereo<\/channel-layout>/)
	})
})

describe('WO-172 T172.5: record route integration — layout-aware downmix when record source is 8ch', () => {
	it('record output with 8ch source produces args with explicit pan= downmix via resolved layout', () => {
		// Simulates the record route resolving an 8ch audio layout from the cabled destination
		const recordSource = 'program_2'
		const config = {
			screenDestinations: {
				version: 1,
				destinations: [
					{ id: 'd1', mainScreenIndex: 0, mode: 'pgm_prv', audioLayout: 'stereo' },
					{ id: 'd2', mainScreenIndex: 1, mode: 'pgm_prv', audioLayout: '8ch' },
				],
			},
		}
		const resolvedLayout = resolveSourceProgramAudioLayout(config, recordSource)
		const args = recordFfmpegArgs({ crf: 26, audioBitrateKbps: 128, programLayout: resolvedLayout })
		// Verify the 8ch layout produces the explicit pan= downmix, not a blind stereo remix
		assert.equal(resolvedLayout, '8ch')
		assert.match(args, /-filter:a aresample=48000 -filter:a pan=stereo\|c0=c0\|c1=c1 -ac 2 -codec:a aac/)
	})
})
