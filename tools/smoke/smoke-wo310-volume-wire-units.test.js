'use strict'

/**
 * WO-310 — one unit on the volume wire.
 *
 * Every fader move used to send TWO MIXER VOLUME commands ~20ms apart in TWO different units:
 * client/lib/audio-mixer-volume-api.js fired `MIXER ch-l VOLUME <dB>` straight at AMCP, then
 * mirrored the same move to REST with the LINEAR value.
 *
 * Verified live against Caspar 2.6.0 253c16c Dev on 2026-07-21: `MIXER … VOLUME` stores its
 * argument verbatim as a LINEAR coefficient and does not clamp it. `MIXER 1-990 VOLUME 0.5`
 * read back `0.5`; `MIXER 1-990 VOLUME -60` read back `-60`. So the dB command was not a
 * harmless duplicate — a fader at −60 dB briefly set a linear gain of −60 (inverted phase,
 * 60x) until the linear mirror overwrote it a frame later.
 *
 * Fix: the REST route is the single writer (it already did the same linear AMCP send AND the
 * f343e5e route-consumer fanout). These tests pin both halves: the pure scale helpers keep dB
 * for display only, and nothing in the volume path puts dB on the wire.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const repoFile = (rel) => path.join(__dirname, '../..', rel)
const read = (rel) => fs.readFileSync(repoFile(rel), 'utf8')
const importClient = (rel) => import('file://' + repoFile(rel))

test('volumeApiPayload: `volume` is the LINEAR gain that goes on the wire', async () => {
	const { volumeApiPayload } = await importClient('client/lib/audio-volume-scale.js')

	assert.equal(volumeApiPayload(1).volume, 1, 'unity stays 1')
	assert.equal(volumeApiPayload(0).volume, 0, 'silence stays 0')
	assert.equal(volumeApiPayload(0.5).volume, 0.5, 'linear gain passes through untouched')
})

test('volumeApiPayload: `volumeDb` is display-only and never equals the wire value', async () => {
	const { volumeApiPayload } = await importClient('client/lib/audio-volume-scale.js')

	// The exact live hazard: a fader at silence. Wire value must be 0, not -60.
	const silent = volumeApiPayload(0)
	assert.equal(silent.volume, 0)
	assert.equal(silent.volumeDb, -60, 'dB figure is still computed for the readout')
	assert.notEqual(silent.volume, silent.volumeDb, 'the two must never be interchangeable')

	const half = volumeApiPayload(0.5)
	assert.ok(half.volumeDb < 0 && half.volumeDb > -7, `0.5 linear is about -6 dB, got ${half.volumeDb}`)
	assert.equal(half.volume, 0.5, 'the wire value stays linear regardless of the dB readout')
})

test('volumeApiPayload clamps gain to the fader ceiling, and never emits a NEGATIVE coefficient', async () => {
	const { volumeApiPayload } = await importClient('client/lib/audio-volume-scale.js')

	// Negative linear gain = inverted phase in Caspar. No input may produce one.
	for (const input of [-1, -60, -0.5, NaN, undefined, null, 'nonsense']) {
		const { volume } = volumeApiPayload(input)
		assert.ok(volume >= 0, `input ${String(input)} produced negative wire gain ${volume}`)
	}
	const { volume: ceiling } = volumeApiPayload(999)
	assert.ok(ceiling > 1 && ceiling < 3, `+6 dB ceiling is ~1.995 linear, got ${ceiling}`)
})

test('linear/dB conversions round-trip (the readout stays correct after the wire change)', async () => {
	const { linearGainToCasparDb, casparDbToLinearGain } = await importClient(
		'client/lib/audio-volume-scale.js',
	)
	for (const gain of [1, 0.5, 0.25, 0.1]) {
		const back = casparDbToLinearGain(linearGainToCasparDb(gain))
		assert.ok(Math.abs(back - gain) < 1e-9, `${gain} round-tripped to ${back}`)
	}
	assert.equal(linearGainToCasparDb(0), -60, 'silence floors at the fader minimum')
})

test('the volume path puts NO dB value on the wire and has exactly one writer', () => {
	const src = read('client/lib/audio-mixer-volume-api.js')

	assert.doesNotMatch(
		src,
		/VOLUME \$\{volumeDb\}/,
		'WO-310 regression: a dB figure is being sent as a MIXER VOLUME argument',
	)
	// Match an actual import or call, not the word appearing in the history comment above it.
	assert.doesNotMatch(
		src,
		/^\s*import\b[^\n]*postAmcpPreviewPipeline/m,
		'the redundant direct AMCP send is back — that is the double-send WO-310 removed',
	)
	assert.doesNotMatch(
		src,
		/\bpostAmcpPreviewPipeline\(/,
		'the redundant direct AMCP send is being called again',
	)
	assert.match(src, /api\.post\('\/api\/audio\/volume'/, 'REST remains the single writer')

	// Whatever it sends, it must be the linear payload field.
	assert.match(src, /volumeApiPayload\(linearGain\)/)
})

test('server: the REST route sends the LINEAR field to AMCP and still fans out', () => {
	const src = read('src/api/routes-audio.js')
	assert.match(
		src,
		/mixerVolume\(channel, layer, b\.volume/,
		'the route must send b.volume (linear), never b.volumeDb',
	)
	assert.doesNotMatch(src, /b\.volumeDb/, 'server must not consume the display-only dB field')
	assert.match(src, /fanOutVolumeToRouteConsumers/, 'f343e5e fanout still rides the single writer')
})

test('amcp-mixer.js records the verified unit so the dB assumption cannot come back', () => {
	const src = read('src/caspar/amcp-mixer.js')
	assert.match(src, /LINEAR coefficient/, 'mixerVolume must document the verified unit (WO-310)')
	assert.match(src, /NOT decibels/i)
})
