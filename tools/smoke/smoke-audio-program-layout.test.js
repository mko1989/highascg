'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
	resolveEffectiveProgramLayout,
	resolveProgramAudioLayoutsForConfig,
} = require('../../src/config/program-audio-layouts')

test('resolveProgramAudioLayoutsForConfig uses destination audioLayout per main', () => {
	const config = {
		screen_count: 2,
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', audioLayout: '8ch' },
				{ id: 'd2', label: 'Main2', mainScreenIndex: 1, mode: 'pgm_only', audioLayout: 'stereo' },
			],
		},
		audioRouting: { programLayout: '8ch' },
		audioOutputs: [
			{ id: 'audio_1', enabled: true, type: 'portaudio', channelLayout: '8ch' },
		],
	}
	assert.deepEqual(resolveProgramAudioLayoutsForConfig(config, 2), ['8ch', 'stereo'])
	assert.equal(resolveEffectiveProgramLayout(config.audioRouting, config.audioOutputs, config), '8ch')
})

test('resolveProgramAudioLayoutsForConfig widens stereo destination with cabled PortAudio 8ch', () => {
	const config = {
		screen_count: 1,
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', audioLayout: 'stereo' },
			],
		},
		audioOutputs: [
			{
				id: 'audio_1',
				enabled: true,
				type: 'portaudio',
				channelLayout: '8ch',
			},
		],
		deviceGraph: {
			connectors: [
				{ id: 'dst_in_d1', kind: 'destination_in', externalRef: 'd1' },
				{ id: 'audio_1', kind: 'audio_out' },
			],
			edges: [{ sourceId: 'dst_in_d1', sinkId: 'audio_1' }],
		},
	}
	assert.deepEqual(resolveProgramAudioLayoutsForConfig(config, 1), ['8ch'])
	assert.equal(resolveEffectiveProgramLayout(config.audioRouting, config.audioOutputs, config), '8ch')
})

test('resolveEffectiveProgramLayout ignores uncabled outputs without config', () => {
	const layout = resolveEffectiveProgramLayout(
		{ programLayout: '8ch' },
		[
			{ id: 'a1', enabled: true, type: 'portaudio', channelLayout: '8ch' },
		],
	)
	assert.equal(layout, '8ch')
})

test('resolveEffectiveProgramLayout defaults to stereo without config', () => {
	const layout = resolveEffectiveProgramLayout({ programLayout: 'stereo' }, [])
	assert.equal(layout, 'stereo')
})
