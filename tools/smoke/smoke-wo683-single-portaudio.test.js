'use strict'

/* WO-683. Owner: "add to the current enhanced oal, an additional single portaudio output to be able to be
 * configured."
 *
 * The custom build's PortAudio consumer reads only the global `configuration.portaudio.*`, so a server drives
 * ONE PortAudio device. A second PortAudio output used to drop the root block (WO-488's "exactly one") and
 * every consumer opened the default device in stereo. And `reconcileCustomLivePortAudioVsOpenAl` switched off
 * an OAL output the operator had cabled to the same destination. */

const test = require('node:test')
const assert = require('node:assert/strict')

const { applyAudioOutputOverridesToScreens } = require('../../src/config/build-caspar-generator-config-audio')
const { portAudioOutputId, normalizeHostApi } = require('../../src/config/portaudio-output')
const { cabledPortAudioLayoutsByMain } = require('../../src/config/program-audio-layouts')

const DESTS = {
	destinations: [
		{ id: 'd1', label: 'PGM 1', mode: 'pgm_prv', mainScreenIndex: 0 },
		{ id: 'd2', label: 'PGM 2', mode: 'pgm_prv', mainScreenIndex: 1 },
	],
}

function run(audioOutputs, edges) {
	const merged = { screen_count: 2, caspar_build_profile: 'custom_live' }
	const appConfig = {
		audioOutputs,
		screenDestinations: DESTS,
		deviceGraph: { edges: edges.map(([sinkId, dest]) => ({ id: `e_${sinkId}`, sourceId: `dst_in_${dest}`, sinkId })) },
	}
	applyAudioOutputOverridesToScreens(merged, appConfig)
	return { merged, appConfig }
}

test('WO-683: the first enabled PortAudio row is the server PortAudio output (missing type = PortAudio)', () => {
	assert.equal(portAudioOutputId([{ id: 'a', type: 'system-audio' }, { id: 'b' }, { id: 'c', type: 'portaudio' }]), 'b')
	assert.equal(portAudioOutputId([{ id: 'a', type: 'portaudio', enabled: false }, { id: 'b', type: 'portaudio' }]), 'b')
	assert.equal(portAudioOutputId([{ id: 'a', type: 'system-audio' }]), '')
})

test('WO-683: a second PortAudio output becomes no consumer and does not widen a bus', () => {
	const { merged, appConfig } = run(
		[
			{ id: 'pa1', type: 'portaudio', deviceName: 'hw:1,3', channelLayout: '8ch' },
			{ id: 'pa2', type: 'portaudio', deviceName: 'hw:0,0', channelLayout: '16ch' },
		],
		[['pa1', 'd1'], ['pa2', 'd2']]
	)
	assert.equal(merged.screen_1_portaudio_consumers.length, 1)
	assert.equal(merged.screen_1_portaudio_consumers[0].deviceName, 'hw:1,3')
	assert.equal(merged.screen_2_portaudio_consumers, undefined, 'the global settings belong to pa1 only')
	assert.notEqual(merged.screen_2_audio_layout, '16ch')
	assert.deepEqual(cabledPortAudioLayoutsByMain(appConfig), { 0: '8ch' })
})

test('WO-683: an OAL output cabled to the PortAudio destination stays on', () => {
	const { merged } = run(
		[
			{ id: 'pa1', type: 'portaudio', deviceName: 'hw:1,3', channelLayout: '8ch' },
			{ id: 'oal', type: 'system-audio', deviceName: '' },
		],
		[['pa1', 'd1'], ['oal', 'd1']]
	)
	assert.equal(merged.screen_1_portaudio_consumers.length, 1)
	assert.equal(merged.screen_1_system_audio_enabled, true, 'Enhanced OAL + one PortAudio on the same program')
})

test('WO-683: OAL nobody cabled is still switched off next to PortAudio (the reconcile rule unchanged)', () => {
	const merged = { screen_count: 1, caspar_build_profile: 'custom_live', screen_1_system_audio_enabled: true }
	applyAudioOutputOverridesToScreens(merged, {
		audioOutputs: [{ id: 'pa1', type: 'portaudio', deviceName: 'hw:1,3' }],
		screenDestinations: { destinations: [DESTS.destinations[0]] },
		deviceGraph: { edges: [{ id: 'e', sourceId: 'dst_in_d1', sinkId: 'pa1' }] },
	})
	assert.equal(merged.screen_1_system_audio_enabled, false)
})

test('WO-683: host APIs are the Linux build ones — auto / ALSA / JACK, anything else → auto', () => {
	assert.equal(normalizeHostApi('JACK'), 'JACK')
	assert.equal(normalizeHostApi('alsa'), 'ALSA')
	for (const v of ['ASIO', 'WASAPI', 'CoreAudio', '', undefined, 'nope']) assert.equal(normalizeHostApi(v), 'auto')
	const { merged } = run([{ id: 'pa1', type: 'portaudio', deviceName: 'hw:1,3', hostApi: 'ASIO' }], [['pa1', 'd1']])
	assert.equal(merged.screen_1_portaudio_consumers[0].hostApi, 'auto')
})

test('WO-683: end to end — the generated PGM channel carries OAL and PortAudio, one root block, one device', () => {
	const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
	const { buildConfigXml } = require('../../src/config/config-generator')
	const outputs = [
		{ id: 'pa1', type: 'portaudio', deviceName: 'hw:1,3', channelLayout: '8ch' },
		{ id: 'pa2', type: 'portaudio', deviceName: 'hw:0,0', channelLayout: '16ch' },
		{ id: 'oal', type: 'system-audio', deviceName: '' },
	]
	const xml = buildConfigXml(
		buildCasparGeneratorFlatConfig({
			casparServer: { caspar_build_profile: 'custom_live', screen_count: 1 },
			screenDestinations: { destinations: [DESTS.destinations[0]] },
			audioOutputs: outputs,
			deviceGraph: { edges: outputs.map((o) => ({ id: `e_${o.id}`, sourceId: 'dst_in_d1', sinkId: o.id })) },
		})
	)
	const ch1 = xml.split('<channel>')[1]
	assert.match(ch1, /<system-audio \/>/, 'buildConfigXml merges routing again — the cabled OAL must survive that too')
	assert.match(ch1, /<portaudio\/>/)
	assert.match(xml, /<portaudio>[\s\S]*<device-name>hw:1,3<\/device-name>[\s\S]*<output-channels>8<\/output-channels>/)
	assert.doesNotMatch(xml, /hw:0,0/, 'the second PortAudio output is skipped')
})
