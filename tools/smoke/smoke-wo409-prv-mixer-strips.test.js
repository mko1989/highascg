'use strict'

/**
 * WO-409 smoke — PRV bus strips in the audio mixer (todos03.08 item: "prv channels need
 * to appear in audio mixer, so operators can monitor the audio of video before taking
 * it to pgm").
 *
 * The row model only iterated `cm.programChannels`; now every screen also gets a
 * `prv:<ch>` master strip (meter + fader + SOLO). PRV SOLO reuses the WO-406 solo bus
 * with a LAYER-LESS target — `{channel}` without `layer` → `route://<ch>` (whole
 * channel) on the monitor channel. One key→target mapper replaces the two inline
 * parsers that would have produced `route://2-NaN` for such keys.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('WO-409: soloKeyToTarget maps layer keys and whole-channel keys correctly', async () => {
	const { soloKeyToTarget } = await import('../../client/lib/audio-mixer-state.js')
	assert.deepEqual(soloKeyToTarget('pgm:1:layer:10'), { channel: 1, layer: 10 })
	assert.deepEqual(soloKeyToTarget('prv:2'), { channel: 2 })
	assert.deepEqual(soloKeyToTarget('prv:12'), { channel: 12 })
})

test('WO-409: row model emits a PRV master strip per screen', () => {
	const rows = read('client/lib/audio-mixer-rows.js')
	assert.match(rows, /const prvCh = Number\(cm\.previewChannels\?\.\[i\]\)/, 'PRV channel resolved per screen index')
	assert.match(rows, /key: pKey,[\s\S]{0,240}isPreview: true,/, 'strip is flagged isPreview')
})

test('WO-409: console masters render PRV badge + SOLO through the shared mapper', () => {
	const masters = read('client/components/audio-mixer-console-masters.js')
	assert.match(masters, /\$\{r\.isPreview \? 'PRV' : 'PGM'\}/, 'badge says PRV on preview strips')
	// WO-604 slice 2: the clients post the solo KEYS and the server maps them with the same shared mapper
	// (src/audio/mixer-state.js soloKeyToTarget) — a prv key still never becomes { layer: NaN }.
	for (const f of ['client/components/audio-mixer-console-masters.js', 'client/components/audio-mixer-console-input-groups.js', 'client/components/audio-mixer-panel-input-layers.js']) {
		const src = read(f)
		assert.match(src, /api\.post\('\/api\/audio\/solo', \{ keys: audioMixerState\.getSoloedLayers\(\) \}\)/, `${f} posts the solo keys`)
		assert.doesNotMatch(src, /parseInt\(parts\[3\], 10\)/, `${f} inline parser removed`)
	}
	const routes = read('src/api/routes-audio.js')
	assert.match(routes, /b\.keys\.filter\(mixerState\.isMixerKey\)\.map\(mixerState\.soloKeyToTarget\)/, 'the server maps keys with the shared mapper')
	const { soloKeyToTarget } = require('../../src/audio/mixer-state')
	assert.deepEqual(soloKeyToTarget('prv:2'), { channel: 2 })
	assert.deepEqual(soloKeyToTarget('pgm:1:layer:10'), { channel: 1, layer: 10 })
})

test('WO-409: solo API routes a layer-less target as the whole channel', () => {
	const routes = read('src/api/routes-audio.js')
	assert.match(routes, /const src = s\.layer != null \? `route:\/\/\$\{s\.channel\}-\$\{s\.layer\}` : `route:\/\/\$\{s\.channel\}`/, 'layer-less solo → route://channel')
})

test('WO-409: bus meter keys accept prv strips', () => {
	const meters = read('client/lib/audio-mixer-bus-meters.js')
	assert.match(meters, /\^\(\?:pgm\|prv\):/, 'meter key regex covers prv masters')
})
