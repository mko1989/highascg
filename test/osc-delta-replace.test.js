'use strict'

/** WO-985: an OSC WS delta carries each dirty channel COMPLETE, so clients REPLACE their copy (a merge kept pruned layers). */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const loadClient = () => import('../client/lib/osc-client.js')

test('web client: delta channel replaces — pruned layer and audio slot are gone, other channels stay', async () => {
	const { applyOscPayload } = await loadClient()
	const cur = {
		1: { layers: { 10: { file: { elapsed: 1 } }, 20: { file: { elapsed: 5 } } }, audio: { levels: [{ dBFS: -10, peak: -3 }, { dBFS: -9, peak: -2 }] } },
		2: { layers: { 10: {} } },
	}
	const d = { delta: true, channels: { 1: { layers: { 10: { file: { elapsed: 2 } } }, audio: { levels: [{ dBFS: -120, peak: -120 }] } } } }
	const next = applyOscPayload(cur, d)
	assert.equal(next[1].layers[20], undefined)
	assert.equal(next[1].layers[10].file.elapsed, 2)
	assert.equal(next[1].audio.levels.length, 1)
	assert.equal(next[1].audio.levels[0].dBFS, -120)
	assert.ok(next[2])
	assert.ok(cur[1].layers[20], 'input not mutated')
	assert.deepEqual(Object.keys(applyOscPayload(cur, { channels: { 3: {} } })), ['3'], 'snapshot replaces all')
	assert.equal(applyOscPayload(cur, { delta: true }), cur)
})

test('server delta + client replace: a layer the server pruned disappears from the client mirror', async () => {
	const { applyOscPayload } = await loadClient()
	const { OscState } = require('../src/osc/osc-state')
	const st = new OscState(() => {}, { wsDeltaBroadcast: true, emitIntervalMs: 0 })
	const snap = () => JSON.parse(JSON.stringify(st._channels))
	st._ensureLayer(1, 10)
	st._ensureLayer(1, 20)
	let mirror = applyOscPayload({}, { channels: snap() })
	assert.ok(mirror[1].layers[20])
	delete st._channels[1].layers[20]
	st._dirtyChannels.add(1)
	const payload = st._buildChangePayload()
	assert.equal(payload.delta, true)
	mirror = applyOscPayload(mirror, payload)
	assert.equal(mirror[1].layers[20], undefined)
	assert.ok(mirror[1].layers[10])
})

test('templates apply a delta by replacement (no mergeChannel left)', () => {
	for (const f of ['playback_timers.js', 'playback_timers_helpers.js', 'multiview_master.js', 'multiview_overlay.js']) {
		const src = fs.readFileSync(path.join(__dirname, '..', 'template', f), 'utf8')
		assert.ok(!/mergeChannel/.test(src), f)
	}
	for (const f of ['playback_timers.js', 'multiview_master.js', 'multiview_overlay.js']) {
		const src = fs.readFileSync(path.join(__dirname, '..', 'template', f), 'utf8')
		assert.ok(/Object\.assign\(oscState\.channels, msg\.data\.channels\)/.test(src), f)
	}
})
