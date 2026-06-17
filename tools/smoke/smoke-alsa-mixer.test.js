'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	parseAmixerScontents,
	isLinuxAlsaMixerAvailable,
	getAlsaMixerState,
} = require('../../src/audio/alsa-mixer')

describe('alsa-mixer parser', () => {
	it('parses volume control with playback channels', () => {
		const sample = `Simple mixer control 'Master',0
  Capabilities: pvolume pvolume-joined pswitch pswitch-joined
  Playback channels: Front Left - Front Right
  Limits: Playback 0 - 65536
  Front Left: Playback 32768 [50%] [-18.06dB] [on]
  Front Right: Playback 32768 [50%] [-18.06dB] [on]
`
		const controls = parseAmixerScontents(sample)
		assert.equal(controls.length, 1)
		assert.equal(controls[0].name, 'Master')
		assert.equal(controls[0].type, 'volume')
		assert.equal(controls[0].playback, true)
		assert.equal(controls[0].percent, 50)
		assert.equal(controls[0].mute, false)
	})

	it('parses generic volume control with capture channels', () => {
		const sample = `Simple mixer control 'Front Mic Boost',0
  Capabilities: volume
  Playback channels: Front Left - Front Right
  Capture channels: Front Left - Front Right
  Limits: 0 - 3
  Front Left: 2 [67%] [20.00dB]
  Front Right: 2 [67%] [20.00dB]
`
		const controls = parseAmixerScontents(sample)
		assert.equal(controls.length, 1)
		assert.equal(controls[0].type, 'volume')
		assert.equal(controls[0].capture, true)
		assert.equal(controls[0].playback, true)
		assert.equal(controls[0].percent, 67)
		assert.equal(controls[0].dB, 20)
		assert.deepEqual(controls[0].channels, ['Front Left', 'Front Right'])
	})

	it('parses playback-only USB PCM without polluting channels', () => {
		const sample = `Simple mixer control 'PCM',0
  Capabilities: pvolume pswitch pswitch-joined
  Playback channels: Front Left - Front Right
  Limits: Playback 0 - 128
  Mono:
  Front Left: Playback 96 [75%] [-32.00dB] [on]
  Front Right: Playback 96 [75%] [-32.00dB] [on]
`
		const controls = parseAmixerScontents(sample)
		assert.equal(controls[0].playback, true)
		assert.equal(controls[0].capture, false)
		assert.deepEqual(controls[0].channels, ['Front Left', 'Front Right'])
	})

	it('parses enum control', () => {
		const sample = `Simple mixer control 'Mic Boost',0
  Capabilities: penum
  Items: '0dB' '20dB'
  Item0: '0dB'
`
		const controls = parseAmixerScontents(sample)
		assert.equal(controls[0].type, 'enum')
		assert.equal(controls[0].item, '0dB')
		assert.equal(controls[0].items.length, 2)
	})
})

describe('alsa-mixer live (linux only)', { skip: !isLinuxAlsaMixerAvailable() }, () => {
	it('GET card 0 returns controls array', () => {
		const state = getAlsaMixerState(0, { refresh: true })
		assert.ok(Array.isArray(state.controls))
		assert.ok(Array.isArray(state.cards))
	})
})
