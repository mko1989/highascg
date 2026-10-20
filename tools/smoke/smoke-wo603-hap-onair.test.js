'use strict'

/**
 * WO-603 slice 4 — the HAP dialog's on-air warning is decided in node: POST /api/media/hap-encode/probe returns
 * `onAir` from the server playback matrix (the web read the browser's copy of it, hap-encode-status.js).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { isAnythingPlaying } = require('../../src/api/routes-media-hap')

describe('WO-603 isAnythingPlaying — the probe reply\'s onAir', () => {
	it('true only when a matrix cell is playing', () => {
		assert.equal(isAnythingPlaying({}), false, 'empty matrix')
		assert.equal(isAnythingPlaying({ _playbackMatrix: { '1-10': { playing: false } } }), false)
		assert.equal(isAnythingPlaying({ _playbackMatrix: { '1-10': { playing: false }, '2-20': { playing: true } } }), true)
	})
})
