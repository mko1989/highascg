'use strict'

/**
 * Owner workflow (todos21.07.26): three DeckLink cameras, one carries the sound mixer's audio.
 * That one must ALWAYS feed its bus; the others must stay silent even with video on PGM. Plus a
 * mixer-wide AUTO MIX toggle deciding whether audio follows video on transitions.
 *
 * The policy gates the look layer's MIXER VOLUME on the program channel — the only place
 * layer-route audio can be gated (f343e5e: host-channel volume never reaches a layer route).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	liveInputAudioSendPolicy,
	isAutoMixEnabled,
	resolveLiveInputForSource,
	resolveTakeVolumeForSceneLayer,
} = require('../../src/engine/live-input-audio-policy')

/** Config with 2 decklink inputs; getChannelMap allocates their dedicated host channels. */
function cfg(overrides = {}) {
	return {
		casparServer: {
			screen_count: 2,
			decklink_input_count: 2,
			multiview_enabled: false,
			...overrides,
		},
		screenDestinations: {
			version: 1,
			edidNotes: '',
			destinations: [
				{ id: 'a', label: 'PGM 1', mode: 'pgm_prv', mainScreenIndex: 0, videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			],
		},
	}
}

function decklinkHost(config, slot) {
	const { getChannelMap } = require('../../src/config/routing')
	const e = (getChannelMap(config).inputChannels || []).find((x) => x.kind === 'decklink' && x.slot === slot)
	assert.ok(e, `decklink slot ${slot} host allocated`)
	return e
}

test('route sources resolve to their live input, plain media does not', () => {
	const c = cfg()
	const host = decklinkHost(c, 1)
	const hit = resolveLiveInputForSource(c, { type: 'route', value: `route://${host.channel}-${host.layer}` })
	assert.deepEqual(hit, { kind: 'decklink', slot: 1, channel: host.channel, layer: host.layer })
	assert.equal(resolveLiveInputForSource(c, { type: 'media', value: 'clip.mov' }), null)
	assert.equal(resolveLiveInputForSource(c, { type: 'route', value: 'route://99-1' }), null)
})

test('policy matrix: afv follows the look, always/never suppress the embedded copy', () => {
	const c = cfg()
	const host = decklinkHost(c, 1)
	const layer = { volume: 0.8, source: { type: 'route', value: `route://${host.channel}-${host.layer}` } }

	assert.equal(resolveTakeVolumeForSceneLayer(c, layer), 0.8, 'default afv + auto-mix on → authored volume')

	c.casparServer.decklink_input_1_audio_send = 'never'
	assert.equal(resolveTakeVolumeForSceneLayer(c, layer), 0, "'never': camera video comes in silent")

	c.casparServer.decklink_input_1_audio_send = 'always'
	assert.equal(
		resolveTakeVolumeForSceneLayer(c, layer),
		0,
		"'always': audio comes from the persistent strip route — the embedded copy must stay silent or the same signal doubles on the bus",
	)
})

test('auto-mix off silences AFV inputs on take, and only them', () => {
	const c = cfg({ audio_auto_mix: false })
	const host = decklinkHost(c, 1)
	const liveLayer = { volume: 1, source: { type: 'route', value: `route://${host.channel}-${host.layer}` } }
	const mediaLayer = { volume: 0.7, source: { type: 'media', value: 'clip.mov' } }

	assert.equal(resolveTakeVolumeForSceneLayer(c, liveLayer), 0, 'afv input silent when auto-mix is off')
	assert.equal(resolveTakeVolumeForSceneLayer(c, mediaLayer), 0.7, 'media layers are NOT touched by auto-mix')
	assert.equal(isAutoMixEnabled(c), false)
})

test('per-slot independence — the owner three-camera case', () => {
	const c = cfg({ decklink_input_1_audio_send: 'always', decklink_input_2_audio_send: 'never' })
	assert.equal(liveInputAudioSendPolicy(c, 'decklink', 1), 'always')
	assert.equal(liveInputAudioSendPolicy(c, 'decklink', 2), 'never')
	assert.equal(liveInputAudioSendPolicy(c, 'decklink', 3), 'afv', 'unset slots default to afv')
})

test('an authored mute always wins', () => {
	const c = cfg()
	const host = decklinkHost(c, 1)
	const layer = { muted: true, volume: 1, source: { type: 'route', value: `route://${host.channel}-${host.layer}` } }
	assert.equal(resolveTakeVolumeForSceneLayer(c, layer), 0)
})

test('the take pipeline emits VOLUME unconditionally (stale-0 defence)', () => {
	/* With the strip fanout (f343e5e) able to write 0 onto look layers, `if (vol !== 1)` would keep
	 * a retaken layer silent forever. Same defensive rule WO-217 T217.2 established for OPACITY. */
	const fs = require('fs')
	const path = require('path')
	for (const f of ['scene-take-lbg-jobs.js', 'scene-take-pgm-only.js']) {
		const src = fs
			.readFileSync(path.join(__dirname, '..', '..', 'src', 'engine', f), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/(^|[^:])\/\/.*$/gm, '$1')
		assert.ok(!/if\s*\(\s*vol\s*!==\s*1\s*\)/.test(src), `${f}: VOLUME must not be gated on vol !== 1`)
		assert.match(src, /resolveTakeVolumeForSceneLayer/, `${f}: uses the policy resolver`)
	}
})
