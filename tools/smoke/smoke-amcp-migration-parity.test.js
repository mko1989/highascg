'use strict'

/**
 * Offline: compare HighAsCG AMCP strings with casparcg-connection serializers (v6).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { Commands } = require('casparcg-connection/dist/commands')
const { serializers } = require('casparcg-connection/dist/serializers')
const { chLayer } = require('../../src/caspar/amcp-utils')

/**
 * @param {string} command
 * @param {object} params
 */
function serializeLibrary(command, params) {
	const fns = serializers[command]
	assert.ok(fns, `no serializer for ${command}`)
	return fns
		.map((fn) => fn(command, params))
		.filter((p) => p !== undefined && p !== '')
		.join(' ')
}

describe('AMCP migration parity (offline)', () => {
	it('PAUSE matches library', () => {
		const ch = 1
		const layer = 10
		const highascg = `PAUSE ${chLayer(ch, layer)}`
		const lib = serializeLibrary(Commands.Pause, { channel: ch, layer })
		assert.equal(highascg, lib)
	})

	it('STOP matches library', () => {
		const ch = 2
		const layer = 5
		const highascg = `STOP ${chLayer(ch, layer)}`
		const lib = serializeLibrary(Commands.Stop, { channel: ch, layer })
		assert.equal(highascg, lib)
	})

	it('CLEAR matches library', () => {
		const ch = 1
		const layer = 3
		const highascg = `CLEAR ${chLayer(ch, layer)}`
		const lib = serializeLibrary(Commands.Clear, { channel: ch, layer })
		assert.equal(highascg, lib)
	})

	it('MIXER OPACITY (no DEFER) matches library', () => {
		const ch = 1
		const layer = 10
		const highascg = `MIXER ${chLayer(ch, layer)} OPACITY 0.5 25 linear`
		const lib = serializeLibrary(Commands.MixerOpacity, {
			channel: ch,
			layer,
			value: 0.5,
			duration: 25,
			tween: 'linear',
		})
		assert.equal(highascg, lib)
	})

	it('CG PLAY matches library', () => {
		const ch = 1
		const layer = 20
		const cgLayer = 1
		const highascg = `CG ${chLayer(ch, layer)} PLAY ${cgLayer}`
		const lib = serializeLibrary(Commands.CgPlay, { channel: ch, layer, cgLayer })
		assert.equal(highascg, lib)
	})
})
