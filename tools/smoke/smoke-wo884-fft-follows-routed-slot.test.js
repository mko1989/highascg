'use strict'

/**
 * WO-884 — the shader-FFT engine follows a live-audio slot routed AFTER boot by anything but the inspector's apply.
 * Observed 31.10: the node booted with no FFT source, a project's casparServer.audio_fft_source_slot = 1 was applied,
 * the bridge started teeing PCM to :52221 — and nothing listened, so every audio-reactive visual sat still.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const { createAudioCaptureLifecycle } = require('../../src/bootstrap/audio-capture-lifecycle')

function harness() {
	const lines = []
	const config = { casparServer: {} }
	const appCtx = {}
	const lc = createAudioCaptureLifecycle({
		appCtx,
		config,
		logger: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
	})
	return { lc, config, appCtx, lines }
}

test('a slot routed after boot rebinds the engine on the next live-audio setup; unchanged → no rebind', () => {
	const { lc, config, appCtx, lines } = harness()
	try {
		lc.startAudioCapture()
		assert.ok(lines.some((l) => l.includes('no source routed')), 'boot: nothing routed')
		assert.equal(appCtx.getAudioCaptureStatus, undefined, 'no engine yet')

		config.casparServer.audio_fft_source_slot = 8 // what apply-hardware / project load writes (port 52228 here)
		assert.equal(lc.syncAudioCapture(), true, 'the routed slot rebinds')
		assert.ok(lines.some((l) => l.includes('source: live-audio slot 8 bridge tee')), 'listening on the slot tee')
		assert.equal(typeof appCtx.getAudioCaptureStatus, 'function', 'engine running')

		assert.equal(lc.syncAudioCapture(), false, 'same source → left alone (no gap in the frames)')

		delete config.casparServer.audio_fft_source_slot
		assert.equal(lc.syncAudioCapture(), true, 'unrouted → rebinds to nothing')
		assert.equal(appCtx.getAudioCaptureStatus(), null, 'engine stopped')
	} finally {
		lc.stopAudioCapture()
	}
})

test('live-audio setup syncs the FFT engine before the bridges start their tee', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/config/routing-setup-live-inputs.js'), 'utf8')
	const fn = src.slice(src.indexOf('async function setupLiveAudioInputs'))
	assert.ok(fn.indexOf('syncAudioCapture') > -1, 'setupLiveAudioInputs calls syncAudioCapture')
	assert.ok(fn.indexOf('syncAudioCapture') < fn.indexOf('playLiveAlsaClipWithRecovery'), '… before any bridge PLAY')
})
