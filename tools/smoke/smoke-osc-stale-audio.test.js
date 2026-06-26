'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { OscState } = require('../../src/osc/osc-state')

describe('osc-state stale audio decay', () => {
	it('decays mixer levels after staleTimeoutMs with no fresh OSC', () => {
		const osc = new OscState(() => {}, {
			enabled: true,
			listenPort: 6251,
			listenAddress: '0.0.0.0',
			peakHoldMs: 2000,
			emitIntervalMs: 50,
			staleTimeoutMs: 100,
			wsDeltaBroadcast: false,
		})
		osc.handleOscMessage({
			address: '/channel/5/mixer/audio/nb_channels',
			args: [2],
		})
		osc.handleOscMessage({
			address: '/channel/5/mixer/audio/1/dBFS',
			args: [-12],
		})
		const hot = osc.getSnapshot()
		assert.equal(hot.channels['5'].audio.levels[0].dBFS, -12)

		osc._channels[5].audio._lastUpdateAt = Date.now() - 500
		const cold = osc.getSnapshot()
		assert.equal(cold.channels['5'].audio.levels[0].dBFS, -120)
		osc.destroy()
	})

	it('does not inflate nb_channels from padded volume bundle after nb_channels OSC', () => {
		const osc = new OscState(() => {}, {
			enabled: true,
			listenPort: 6251,
			listenAddress: '0.0.0.0',
			peakHoldMs: 2000,
			emitIntervalMs: 50,
			staleTimeoutMs: 100,
			wsDeltaBroadcast: false,
		})
		osc.handleOscMessage({
			address: '/channel/1/mixer/audio/nb_channels',
			args: [8],
		})
		osc.handleOscMessage({
			address: '/channel/1/mixer/audio/volume',
			args: Array.from({ length: 16 }, (_, i) => (i < 2 ? 8000 : 0)),
		})
		const snap = osc.getSnapshot()
		assert.equal(snap.channels['1'].audio.nbChannels, 8)
		assert.equal(snap.channels['1'].audio.levels.length, 8)
		osc.destroy()
	})
})
