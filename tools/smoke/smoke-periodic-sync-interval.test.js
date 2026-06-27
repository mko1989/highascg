'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { resolveIntervalSec } = require('../../src/utils/periodic-sync')

describe('periodic-sync interval', () => {
	it('returns null when OSC listener is active (no AMCP poll loop)', () => {
		const self = {
			config: { periodic_sync_interval_sec: 10, periodic_sync_interval_sec_osc: 1 },
		}
		const tracker = require('../../src/state/playback-tracker')
		const orig = tracker.isOscPlaybackActive
		tracker.isOscPlaybackActive = () => true
		try {
			assert.equal(resolveIntervalSec(self), null)
		} finally {
			tracker.isOscPlaybackActive = orig
		}
	})

	it('uses periodic_sync_interval_sec when OSC is off', () => {
		const self = { config: { periodic_sync_interval_sec: 10 } }
		const tracker = require('../../src/state/playback-tracker')
		const orig = tracker.isOscPlaybackActive
		tracker.isOscPlaybackActive = () => false
		try {
			assert.equal(resolveIntervalSec(self), 10)
		} finally {
			tracker.isOscPlaybackActive = orig
		}
	})

	it('returns null when periodic sync disabled', () => {
		assert.equal(resolveIntervalSec({ config: {} }), null)
	})
})
