'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const {
	resolveLiveAudioCaptureBaseUri,
	listLiveAudioPlayClipVariants,
	listPortAudioHwIdentities,
} = require('../../src/config/live-audio-input')
const { isLiveAlsaLayerHealthy } = require('../../src/audio/live-audio-health')

const cfgBase = {
	caspar_global_portaudio: true,
	configPath: path.join(__dirname, '../../config/casparcg.config'),
	live_audio_input_count: 1,
	live_audio_input_1_device: 'alsa://hw:0,0',
	live_audio_alsa_buffer_size: 131072,
}

describe('live-audio capture device resolution', () => {
	it('uses dsnoop when capture hw matches global PortAudio hw', () => {
		const uris = listPortAudioHwIdentities(cfgBase)
		assert.ok(uris.includes('0,0'), `expected portaudio hw 0,0 in ${JSON.stringify(uris)}`)
		const uri = resolveLiveAudioCaptureBaseUri(cfgBase, 1)
		assert.equal(uri, 'alsa://dsnoop:0,0')
	})

	it('lists dsnoop before plughw/hw in PLAY variants', () => {
		const variants = listLiveAudioPlayClipVariants(cfgBase, 1)
		assert.ok(variants.length >= 2)
		assert.match(variants[0], /^alsa:\/\/dsnoop:0,0/)
		assert.ok(variants.some((v) => v.includes('plughw:0,0')))
	})

	it('detects dead ffmpeg alsa producers from INFO text', () => {
		assert.equal(isLiveAlsaLayerHealthy('<type>ffmpeg</type><clip>alsa://dsnoop:0,0</clip>'), true)
		assert.equal(isLiveAlsaLayerHealthy('<type>empty</type>'), false)
		assert.equal(isLiveAlsaLayerHealthy('type empty'), false)
	})
})
