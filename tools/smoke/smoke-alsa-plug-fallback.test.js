'use strict'

/**
 * Live-audio capture on a card that only offers a format ffmpeg does not ask for.
 *
 * Observed on this box after a Yamaha DM3 was connected: slot 1 captured `dsnoop:2,0` and ffmpeg
 * died with "cannot set sample format 0x10000 2 (Invalid argument)" on every respawn. `dsnoop:`
 * and `hw:` pass the device format straight through; `plughw:` runs ALSA's plug converter. Verified
 * by hand at the time: `ffmpeg -f alsa -i dsnoop:2,0` failed, `-i plughw:2,0` succeeded.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const bridge = require('../../src/audio/live-audio-bridge')

describe('ALSA plug fallback for format-rejecting cards', () => {
	it('maps dsnoop: and hw: to their plug-converting equivalent', () => {
		assert.equal(bridge.plugFallbackDevice('dsnoop:2,0'), 'plughw:2,0')
		assert.equal(bridge.plugFallbackDevice('hw:2,0'), 'plughw:2,0')
		assert.equal(bridge.plugFallbackDevice('dsnoop:CARD=DM3,DEV=0'), 'plughw:CARD=DM3,DEV=0')
	})

	it('does not rewrite a device that already converts, or an unknown form', () => {
		assert.equal(bridge.plugFallbackDevice('plughw:2,0'), null, 'plughw is already converting')
		assert.equal(bridge.plugFallbackDevice('default'), null)
		assert.equal(bridge.plugFallbackDevice(''), null)
	})

	it('recognises the ALSA format-negotiation failure and only that', () => {
		assert.equal(bridge.isAlsaFormatError('cannot set sample format 0x10000 2 (Invalid argument)'), true)
		assert.equal(bridge.isAlsaFormatError('[alsa @ 0x1] snd_pcm_hw_params failed'), true)
		assert.equal(bridge.isAlsaFormatError('Device or resource busy'), false, 'busy is a different fault')
		assert.equal(bridge.isAlsaFormatError('Error opening input: Input/output error'), false)
		assert.equal(bridge.isAlsaFormatError(''), false)
	})

	it('the retry is guarded so a broken device cannot respawn-loop', () => {
		const fs = require('fs')
		const path = require('path')
		const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'audio', 'live-audio-bridge.js'), 'utf8')
		assert.match(src, /!cur\.plugRetried/, 'the fallback must be gated on a not-yet-retried entry')
		assert.match(src, /plugRetried: true/, 'the retry must mark the entry so it happens at most once')
	})
})

describe('the working-device memo survives the internal stop', () => {
	it('reads the memo BEFORE stopLiveAudioBridge clears it', () => {
		const fs = require('fs')
		const path = require('path')
		const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'audio', 'live-audio-bridge.js'), 'utf8')
		const readIdx = src.indexOf('const remembered = _workingDeviceBySlot.get(n)')
		const stopIdx = src.indexOf('stopLiveAudioBridge(n)', readIdx > 0 ? readIdx : 0)
		assert.ok(readIdx > 0, 'start() must snapshot the remembered device')
		assert.ok(
			readIdx < stopIdx,
			'the memo must be read before stopLiveAudioBridge(n), which clears it — otherwise every start re-probes the failing device',
		)
	})
})
