'use strict'

/**
 * WO-862 smoke — two owner reports of 30.10 on the audio mixer:
 *  (a) master / group names used "PGM 1" instead of the screen's own label ("Dioda PGM", "Proj PRV");
 *  (b) a newly added live input went straight onto both PGM screens (no route selection → legacy blanket routing).
 * No AMCP; the route is driven with an in-memory ctx.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

describe('WO-862 (a) screen labels in the audio mixer', () => {
	it('web helpers: labelled screen → "Dioda PGM" / "Dioda PRV"; unlabelled keeps "PGM 2 Master"', async () => {
		const { programBusLabel, programInputsTitle } = await import('../../client/lib/screen-label.js')
		const cm = { screenLabels: ['Dioda', 'Proj'] }
		assert.equal(programBusLabel(cm, 0), 'Dioda PGM')
		assert.equal(programBusLabel(cm, 1, true), 'Proj PRV')
		assert.equal(programBusLabel({ screenLabels: ['Dioda'] }, 1), 'PGM 2 Master')
		assert.equal(programBusLabel(null, 0, true), 'PRV 1 Master')
		assert.equal(programInputsTitle(cm, 1, 3), 'Proj PGM (ch 3) Inputs')
		assert.equal(programInputsTitle({}, 0, 1), 'PGM 1 (ch 1) Inputs')
	})
	it('the web console and both input-group builders use them; the Godot rows and groups use their twins', () => {
		assert.match(
			src('client/components/audio-mixer-view-console.js'),
			/programBusLabel\(stateStore\.getState\(\)\?\.channelMap, i, true\)/
		)
		for (const f of [
			'client/components/audio-mixer-console-input-groups.js',
			'client/components/audio-mixer-panel-input-layers.js',
		])
			assert.match(src(f), /title: programInputsTitle\(channelMap, chIdx, ch\)/, f)
		const rows = src('godot/client/features/audio/audio_rows.gd')
		assert.match(rows, /"label": bus_label\(cm, i\)/)
		assert.match(rows, /"label": bus_label\(cm, i, true\)/)
		assert.match(src('godot/client/features/audio/audio_tab.gd'), /AR\.inputs_title\(cm, i, progs\[i\]\)/)
		assert.match(src('godot/client/features/audio/audio_dock.gd'), /DM\.groups\(rows, progs, cm\)/)
	})
})

describe('WO-862 (b) a new live input starts unrouted', () => {
	const { handlePost } = require('../../src/api/routes-audio')
	const { listConfiguredLiveAudioSlots } = require('../../src/config/live-audio-input')
	const { newSlotsRouteNowhere } = require('../../src/audio/live-audio-slot-prune')

	it('adding slot 1 with no selection pins it to "" (not the blanket always-on routing)', async () => {
		const ctx = { log() {}, config: { casparServer: { live_audio_input_count: 0, live_audio_pgm_always_on: true } } }
		const res = await handlePost(
			'/api/audio/live-inputs/config',
			JSON.stringify({
				live_audio_input_count: 1,
				live_audio_input_1_device: 'alsa://hw:3,0',
				live_audio_pgm_always_on: true,
			}),
			ctx
		)
		assert.equal(res.status, 200)
		assert.equal(ctx.config.casparServer.live_audio_input_1_pgm_channels, '')
		assert.deepEqual(listConfiguredLiveAudioSlots(ctx.config).slots[0].pgmChannels, [])
	})

	it('an explicit selection in the same save wins; an existing slot and a device swap keep theirs', () => {
		const prev = { live_audio_input_count: 1, live_audio_input_1_device: 'alsa://hw:1,0' }
		const cs = {
			...prev,
			live_audio_input_count: 3,
			live_audio_input_2_device: 'alsa://hw:2,0',
			live_audio_input_3_device: 'alsa://hw:3,0',
		}
		cs.live_audio_input_3_pgm_channels = '1'
		assert.deepEqual(newSlotsRouteNowhere(prev, cs, { live_audio_input_3_pgm_channels: '1' }), [2])
		assert.equal(cs.live_audio_input_2_pgm_channels, '')
		assert.equal(cs.live_audio_input_3_pgm_channels, '1')
		assert.equal('live_audio_input_1_pgm_channels' in cs, false, 'an untouched existing slot keeps the legacy routing')
		const swap = { ...prev, live_audio_input_1_device: 'alsa://hw:4,0' }
		assert.deepEqual(newSlotsRouteNowhere(prev, swap, {}), [])
	})

	it('a slot beyond the old count counts as new even when its device key was left over', () => {
		const prev = { live_audio_input_count: 1, live_audio_input_1_device: 'a', live_audio_input_2_device: 'b' }
		const cs = { ...prev, live_audio_input_count: 2 }
		assert.deepEqual(newSlotsRouteNowhere(prev, cs, {}), [2])
	})
})
