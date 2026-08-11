'use strict'

/* WO-488. Owner: "even though my config has no audio outputs, at the top of the caspar config there
 * is a portaudio called to existance."
 *
 * `buildCustomLiveRootXml` gated the root `<portaudio>` block on
 * `countPortAudioConsumers(config) <= 1` — and `<= 1` also catches ZERO. The block exists to carry
 * the settings of THE single global PortAudio consumer (the per-consumer `<portaudio/>` is emitted
 * empty in that case), so it needs that consumer to exist. With none, Caspar was told to open a
 * PortAudio device nobody had configured.
 *
 * Especially wrong now that a fresh box ships zero audio outputs by default (WO-468/470/473). */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildCustomLiveRootXml } = require('../../src/config/config-generator-audio-xml')

const BASE = { caspar_build_profile: 'custom_live', caspar_global_portaudio: true }

test('WO-488: no audio outputs -> no root <portaudio>', () => {
	const xml = buildCustomLiveRootXml(BASE)
	assert.doesNotMatch(xml, /<portaudio>/, 'nothing to configure, so nothing to open')
})

test('WO-488: the single global consumer still gets its settings block', () => {
	const xml = buildCustomLiveRootXml({ ...BASE, screen_1_portaudio_consumers: [{ deviceName: 'hw:0,0' }] })
	assert.match(xml, /<portaudio>/, 'one consumer keeps the root settings block (that is its purpose)')
	assert.match(xml, /<device-name>hw:0,0<\/device-name>/)
})

test('WO-488: two or more consumers keep their own settings, not the root block', () => {
	const xml = buildCustomLiveRootXml({
		...BASE,
		screen_1_portaudio_consumers: [{ deviceName: 'hw:0,0' }],
		screen_2_portaudio_consumers: [{ deviceName: 'hw:1,0' }],
	})
	assert.doesNotMatch(xml, /<portaudio>/, 'per-consumer settings take over above one — unchanged behaviour')
})

test('WO-488: the global-portaudio flag off never emits it', () => {
	const xml = buildCustomLiveRootXml({
		caspar_build_profile: 'custom_live',
		caspar_global_portaudio: false,
		screen_1_portaudio_consumers: [{ deviceName: 'hw:0,0' }],
	})
	assert.doesNotMatch(xml, /<portaudio>/)
})
