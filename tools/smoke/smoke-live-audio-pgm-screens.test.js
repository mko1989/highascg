'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	resolveLiveAudioPgmTargetScreens,
	resolveLiveAudioSlotPgmChannels,
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

	// WO-571: a slot never saved through the Live Audio Mixer's per-slot "Route to program"
	// buttons has no `live_audio_input_N_pgm_channels` key at all, and falls back to the legacy
	// blanket behavior above. Once that key is written — even as '' — it is authoritative.
	it('an unconfigured slot falls back to the legacy blanket screens', () => {
		assert.deepEqual(resolveLiveAudioSlotPgmChannels(dualScreenCfg, 1), [
			getChannelMap(dualScreenCfg).programCh(1),
			getChannelMap(dualScreenCfg).programCh(2),
		])
	})

	it('an explicit empty selection means routed to nothing, not the blanket fallback', () => {
		const cfg = {
			...dualScreenCfg,
			casparServer: { ...dualScreenCfg.casparServer, live_audio_input_1_pgm_channels: '' },
		}
		assert.deepEqual(resolveLiveAudioSlotPgmChannels(cfg, 1), [])
		assert.deepEqual(listLiveAudioPgmProtectedLayers(cfg), [])
	})

	it('an explicit selection routes only to the chosen channel(s)', () => {
		const map = getChannelMap(dualScreenCfg)
		const cfg = {
			...dualScreenCfg,
			casparServer: { ...dualScreenCfg.casparServer, live_audio_input_1_pgm_channels: String(map.programCh(1)) },
		}
		assert.deepEqual(resolveLiveAudioSlotPgmChannels(cfg, 1), [map.programCh(1)])
		const protectedLayers = listLiveAudioPgmProtectedLayers(cfg)
		assert.equal(protectedLayers.length, 1)
		assert.equal(protectedLayers[0].channel, map.programCh(1))
	})
})
