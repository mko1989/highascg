'use strict'

/**
 * WO-576 — a look layer's clip start point ("Start from beginning" / "Relative to the clip
 * playing on this layer") must survive a take. buildIncomingScenePayload is a layer whitelist and
 * the take response replaces the deck look's layers (applySceneFromTakePayload), so a field
 * missing from that whitelist reverted to the inspector default on every play.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')

test('take payload whitelist carries layer.startBehaviour', () => {
	const src = read('client/components/scenes-shared.js')
	assert.match(src, /startBehaviour: l\.startBehaviour/)
})

test('inspector offers exactly two start options and no "inherit"', () => {
	const src = read('client/components/inspector-scene-layer.js')
	assert.doesNotMatch(src, /Same as timeline clip/)
	assert.match(src, /<option value="beginning">/)
	assert.match(src, /<option value="relativeToPrevious">/)
	assert.doesNotMatch(src, /<option value="inherit">/)
})

test('layer logic never leaves startBehaviour unset', async () => {
	const { patchLayer, applyLayerStyleData } = await import('../../client/lib/scene-state-layer-logic.js')
	const L = { fill: {} }
	patchLayer(L, { startBehaviour: 'relativeToPrevious' })
	assert.equal(L.startBehaviour, 'relativeToPrevious')
	patchLayer(L, { startBehaviour: null })
	assert.equal(L.startBehaviour, 'beginning')
	applyLayerStyleData(L, { startBehaviour: 'inherit' })
	assert.equal(L.startBehaviour, 'beginning')
})

test('migrateScene gives legacy layers an explicit start point', async () => {
	const { migrateScene } = await import('../../client/lib/scene-state-helpers.js')
	const s = migrateScene({
		id: 'a',
		layers: [{ layerNumber: 10 }, { layerNumber: 11, startBehaviour: 'relativeToPrevious' }],
	})
	assert.deepEqual(s.layers.map((l) => l.startBehaviour), ['beginning', 'relativeToPrevious'])
})
