'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	resolveLiveAudioPgmTargetScreens,
	listLiveAudioPgmProtectedLayers,
} = require('../../src/config/live-audio-input')
const { getChannelMap } = require('../../src/config/routing-map')

const dualScreenCfg = {
	screen_count: 2,
	multiview_enabled: true,
	live_audio_input_count: 1,
	live_audio_input_1_device: 'hw:0,0',
	casparServer: {
		screen_count: 2,
		multiview_enabled: true,
		live_audio_input_count: 1,
		live_audio_input_1_device: 'hw:0,0',
		live_audio_pgm_always_on: true,
	},
}

describe('live-audio PGM screen targets', () => {
	it('defaults to all PGM screens when screen_count > 1', () => {
		assert.deepEqual(resolveLiveAudioPgmTargetScreens(dualScreenCfg), [1, 2])
	})

	it('honours live_audio_pgm_screen when all-screens is off', () => {
		const cfg = {
			...dualScreenCfg,
			casparServer: {
				...dualScreenCfg.casparServer,
				live_audio_pgm_all_screens: false,
				live_audio_pgm_screen: 1,
			},
		}
		assert.deepEqual(resolveLiveAudioPgmTargetScreens(cfg), [1])
	})

	it('protects audio track layers on every targeted PGM channel', () => {
		const map = getChannelMap(dualScreenCfg)
		const protectedLayers = listLiveAudioPgmProtectedLayers(dualScreenCfg)
		assert.equal(protectedLayers.length, 2)
		assert.deepEqual(
			protectedLayers.map((p) => p.channel).sort(),
			[map.programCh(1), map.programCh(2)].sort(),
		)
	})
})
