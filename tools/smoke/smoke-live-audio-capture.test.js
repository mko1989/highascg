'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const {
	resolveLiveAudioCaptureBaseUri,
	listLiveAudioPlayClipVariants,
	listPortAudioHwIdentities,
	resolveLiveAudioPlayClip,
} = require('../../src/config/live-audio-input')
const { isLiveAlsaLayerHealthy } = require('../../src/audio/live-audio-health')
const {
	isLiveAudioBridgeEnabled,
	liveAudioBridgePlayClip,
	resolveFfmpegAlsaInputDevice,
	buildLiveAudioBridgeFfmpegArgs,
} = require('../../src/audio/live-audio-bridge')

const cfgBase = {
	caspar_global_portaudio: true,
	configPath: path.join(__dirname, '../../config/casparcg.config'),
	live_audio_input_count: 1,
	live_audio_input_1_device: 'alsa://hw:0,0',
	live_audio_alsa_buffer_size: 131072,
}

describe('live-audio capture device resolution', () => {
	it('uses dsnoop when capture hw matches global PortAudio hw', () => {
		const cfg = {
			...cfgBase,
			default_alsa_card: '0',
			default_alsa_device: '0',
		}
		const uris = listPortAudioHwIdentities(cfg)
		assert.ok(uris.includes('0,0'), `expected portaudio hw 0,0 in ${JSON.stringify(uris)}`)
		const uri = resolveLiveAudioCaptureBaseUri(cfg, 1)
		assert.equal(uri, 'alsa://dsnoop:0,0')
	})

	it('does not force dsnoop when PortAudio uses a different card', () => {
		const cfg = {
			...cfgBase,
			live_audio_input_1_device: 'alsa://hw:2,0',
			live_audio_capture_dsnoop: true,
		}
		const uri = resolveLiveAudioCaptureBaseUri(cfg, 1)
		assert.equal(uri, 'alsa://hw:2,0')
	})

	it('lists dsnoop before plughw/hw in PLAY variants when bridge disabled', () => {
		const cfg = {
			...cfgBase,
			live_audio_capture_bridge: false,
			default_alsa_card: '0',
			default_alsa_device: '0',
		}
		const variants = listLiveAudioPlayClipVariants(cfg, 1)
		assert.ok(variants.length >= 2)
		assert.match(variants[0], /^alsa:\/\/dsnoop:0,0/)
		assert.ok(variants.some((v) => v.includes('plughw:0,0')))
	})

	it('detects dead ffmpeg alsa producers from INFO text', () => {
		assert.equal(isLiveAlsaLayerHealthy('<type>ffmpeg</type><clip>alsa://dsnoop:0,0</clip>'), true)
		assert.equal(
			isLiveAlsaLayerHealthy(
				'<type>ffmpeg</type><clip>udp://127.0.0.1:52201?overrun_nonfatal=1&fifo_size=65536</clip><time>0.5</time><time>0</time>',
			),
			true,
		)
		assert.equal(
			isLiveAlsaLayerHealthy('<type>ffmpeg</type><clip>udp://127.0.0.1:52201?overrun_nonfatal=1&fifo_size=65536</clip><time>0</time><time>0</time>'),
			false,
		)
		assert.equal(isLiveAlsaLayerHealthy('<type>empty</type>'), false)
		assert.equal(isLiveAlsaLayerHealthy('type empty'), false)
	})

	it('uses UDP bridge clip by default (Caspar alsa:// input unsupported)', () => {
		const clip = resolveLiveAudioPlayClip(cfgBase, 1)
		assert.match(clip, /^udp:\/\/127\.0\.0\.1:52201\?overrun_nonfatal=1&fifo_size=65536$/)
		const variants = listLiveAudioPlayClipVariants(cfgBase, 1)
		assert.deepEqual(variants, [liveAudioBridgePlayClip(1)])
	})

	it('bridge disabled keeps alsa PLAY variants', () => {
		const cfg = { ...cfgBase, live_audio_capture_bridge: false }
		assert.equal(isLiveAudioBridgeEnabled(cfg), false)
		const clip = resolveLiveAudioPlayClip(cfg, 1)
		assert.match(clip, /^alsa:\/\//)
	})

	it('ffmpeg bridge uses hw/dsnoop device string', () => {
		const cfg = { ...cfgBase, live_audio_input_1_device: 'alsa://hw:2,0' }
		assert.equal(resolveFfmpegAlsaInputDevice(cfg, 1), 'hw:2,0')
		const args = buildLiveAudioBridgeFfmpegArgs(cfg, 1, 'hw:2,0')
		assert.ok(args.includes('-f'))
		assert.ok(args.includes('alsa'))
		assert.ok(args.includes('hw:2,0'))
		assert.ok(args.some((a) => /^udp:\/\/127\.0\.0\.1:52201/.test(a)))
		assert.ok(args.some((a) => String(a).includes('repeat-headers=1')))
		assert.ok(args.includes('-g'))
		assert.ok(args.includes('1'))
	})
})
