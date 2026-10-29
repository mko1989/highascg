'use strict'

/**
 * WO-800 option A: the HighAsCG Caspar build sends `/channel/N/mixer/audio/layer/L/volume` (int32 sample peak per
 * audio channel, same unit as the channel `volume`). Node keeps it outside the channel snapshot and serves it on
 * GET /api/osc/audio-layers[/:ch].
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { OscState } = require('../../src/osc/osc-state')
const routesOsc = require('../../src/api/routes-osc')

const CFG = {
	enabled: true,
	listenPort: 6251,
	listenAddress: '0.0.0.0',
	peakHoldMs: 2000,
	emitIntervalMs: 50,
	staleTimeoutMs: 500,
	wsDeltaBroadcast: true,
}
const I32 = 2147483647
const db = (v) => 20 * Math.log10(v / I32)
const pad16 = (l, r) => [l, r, ...new Array(14).fill(0)]

/** Live values captured on the box 29.10 (ch 2: layer 11 back track, layer 12 click). */
const L11 = pad16(271315712, 320672512)
const L12 = pad16(966990336, 966989312)

describe('WO-800 per-layer audio levels', () => {
	it('parses layer/<L>/volume into per-layer dBFS (same conversion as the channel volume)', () => {
		const osc = new OscState(() => {}, CFG)
		osc.handleOscMessage({ address: '/channel/2/mixer/audio/volume', args: L12 })
		osc.handleOscMessage({ address: '/channel/2/mixer/audio/layer/11/volume', args: L11 })
		osc.handleOscMessage({ address: '/channel/2/mixer/audio/layer/12/volume', args: L12 })
		const lv = osc.getLayerAudioLevels()
		assert.deepEqual(Object.keys(lv), ['2'])
		assert.deepEqual(Object.keys(lv['2']).sort(), ['11', '12'])
		assert.equal(lv['2']['11'].nbChannels, 16)
		assert.ok(Math.abs(lv['2']['11'].levels[0].dBFS - -17.969) < 0.01)
		assert.ok(Math.abs(lv['2']['11'].levels[1].dBFS - -16.517) < 0.01)
		assert.ok(Math.abs(lv['2']['12'].levels[0].dBFS - db(966990336)) < 1e-9)
		assert.equal(lv['2']['11'].levels[2].dBFS, -120)
		// channel meter is untouched by the layer messages and equals the single loud layer
		const ch = osc.getSnapshot().channels['2'].audio
		assert.equal(ch.levels[0].dBFS, lv['2']['12'].levels[0].dBFS)
		osc.destroy()
	})

	it('keeps layer levels out of the channel snapshot and never dirties the channel', () => {
		const osc = new OscState(() => {}, CFG)
		osc._dirtyChannels.clear()
		osc.handleOscMessage({ address: '/channel/3/mixer/audio/layer/10/volume', args: L11 })
		assert.equal(osc._dirtyChannels.has(3), false)
		const snap = osc.getSnapshot()
		assert.equal(snap.channels['3'], undefined)
		assert.equal(JSON.stringify(snap).includes('layer/10'), false)
		osc.destroy()
	})

	it('caps to nb_channels when Caspar sent it, filters by channel, and drops stale layers', () => {
		const osc = new OscState(() => {}, CFG)
		osc.handleOscMessage({ address: '/channel/1/mixer/audio/nb_channels', args: [2] })
		osc.handleOscMessage({ address: '/channel/1/mixer/audio/layer/20/volume', args: L11 })
		osc.handleOscMessage({ address: '/channel/4/mixer/audio/layer/10/volume', args: L12 })
		assert.equal(osc.getLayerAudioLevels(1)['1']['20'].levels.length, 2)
		assert.deepEqual(Object.keys(osc.getLayerAudioLevels(4)), ['4'])
		osc._layerAudio[1][20]._lastUpdateAt = Date.now() - 5000
		const after = osc.getLayerAudioLevels()
		assert.equal(after['1'], undefined)
		assert.ok(after['4']['10'])
		osc.clear()
		assert.deepEqual(osc.getLayerAudioLevels(), {})
		osc.destroy()
	})

	it('serves GET /api/osc/audio-layers and /api/osc/audio-layers/:ch', () => {
		const osc = new OscState(() => {}, CFG)
		osc.handleOscMessage({ address: '/channel/2/mixer/audio/layer/11/volume', args: L11 })
		osc.handleOscMessage({ address: '/channel/5/mixer/audio/layer/11/volume', args: L12 })
		const ctx = { config: {}, oscState: osc }
		const all = routesOsc.handleGet('/api/osc/audio-layers', ctx)
		assert.equal(all.status, 200)
		assert.deepEqual(Object.keys(JSON.parse(all.body).channels).sort(), ['2', '5'])
		const one = JSON.parse(routesOsc.handleGet('/api/osc/audio-layers/2/', ctx).body)
		assert.deepEqual(Object.keys(one.channels), ['2'])
		assert.ok(Math.abs(one.channels['2']['11'].levels[1].dBFS - -16.517) < 0.01)
		osc.destroy()
	})
})
