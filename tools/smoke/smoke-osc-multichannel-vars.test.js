'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { applyOscSnapshotToVariables } = require('../../src/osc/osc-variables')

describe('osc-variables multichannel audio', () => {
	it('exports per-bus dBFS variables c1..cN and legacy L/R', () => {
		const vars = {}
		const ctx = {
			state: {
				setVariable(k, v) {
					vars[k] = v
				},
			},
		}
		applyOscSnapshotToVariables(ctx, {
			channels: {
				1: {
					audio: {
						nbChannels: 8,
						levels: [
							{ dBFS: -6 },
							{ dBFS: -12 },
							{ dBFS: -18 },
							{ dBFS: -24 },
							{ dBFS: -30 },
							{ dBFS: -36 },
							{ dBFS: -42 },
							{ dBFS: -48 },
						],
					},
				},
			},
		})
		assert.equal(vars.osc_ch1_audio_c1_dBFS, '-6')
		assert.equal(vars.osc_ch1_audio_c8_dBFS, '-48')
		assert.equal(vars.osc_ch1_audio_L, '-6')
		assert.equal(vars.osc_ch1_audio_R, '-12')
		assert.equal(vars.osc_ch1_audio_c9_dBFS, '')
	})
})
