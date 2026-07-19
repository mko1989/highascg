/**
 * todos19.07.26 — dropping new media onto an EXISTING layer (compose frame box or layer-strip
 * row) exchanges its content and must keep the operator's visual transform: fill rect
 * (position/size), rotation, crop and other effects, opacity, aspect lock, audio routing.
 * Only an EMPTY layer gets the native/content-fit rect from applyNativeFillForSource.
 *
 * Covers:
 *  - isLayerSourceExchange — the pure decision helper (client/lib/scene-state-layer-logic.js)
 *  - setLayerSource never touches transform fields (client/lib/scene-state-layer-ops.js mixin);
 *    content-owned behaviour (loop off for still images) still applies on exchange
 *  - static guard: both drop-handler files gate the refit on isLayerSourceExchange, so a
 *    refactor can't quietly reintroduce the unconditional applyNativeFillForSource call
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const CLIENT = path.join(__dirname, '../../client')

const logicPromise = import(pathToFileURL(path.join(CLIENT, 'lib/scene-state-layer-logic.js')).href)
const opsPromise = import(pathToFileURL(path.join(CLIENT, 'lib/scene-state-layer-ops.js')).href)

test('isLayerSourceExchange: true only when the layer already has a usable source', async () => {
	const { isLayerSourceExchange } = await logicPromise
	assert.equal(isLayerSourceExchange(null), false)
	assert.equal(isLayerSourceExchange(undefined), false)
	assert.equal(isLayerSourceExchange({}), false)
	assert.equal(isLayerSourceExchange({ source: null }), false)
	assert.equal(isLayerSourceExchange({ source: {} }), false)
	assert.equal(isLayerSourceExchange({ source: { value: '' } }), false)
	assert.equal(isLayerSourceExchange({ source: { type: 'media', value: 'CLIP.mp4' } }), true)
	// Placeholder layers were positioned deliberately — exchanging one keeps the box too.
	assert.equal(
		isLayerSourceExchange({ source: { type: 'media', value: 'ph', isPlaceholder: true } }),
		true,
	)
})

test('setLayerSource replaces content but never touches the visual transform', async () => {
	const { mixinSceneStateLayerOps } = await opsPromise

	class FakeSceneState {
		constructor(scene) {
			this._scene = scene
			this.saves = 0
		}
		getScene() {
			return this._scene
		}
		_save() {
			this.saves++
		}
		_softSave() {}
	}
	mixinSceneStateLayerOps(FakeSceneState)

	const fill = { x: 0.25, y: 0.1, scaleX: 0.4, scaleY: 0.4 }
	const effects = [{ type: 'crop', params: { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 } }]
	const layer = {
		layerNumber: 10,
		source: { type: 'media', value: 'OLD.mp4', label: 'OLD' },
		fill: { ...fill },
		rotation: 12,
		opacity: 0.8,
		aspectLocked: false,
		audioRoute: '3+4',
		volume: 0.5,
		loop: true,
		effects: JSON.parse(JSON.stringify(effects)),
	}
	const state = new FakeSceneState({ id: 's1', layers: [layer] })

	state.setLayerSource('s1', 0, { type: 'media', value: 'NEW.mp4', label: 'NEW' })
	assert.equal(layer.source.value, 'NEW.mp4')
	// Visual transform + audio routing preserved on exchange:
	assert.deepEqual(layer.fill, fill)
	assert.equal(layer.rotation, 12)
	assert.equal(layer.opacity, 0.8)
	assert.equal(layer.aspectLocked, false)
	assert.equal(layer.audioRoute, '3+4')
	assert.equal(layer.volume, 0.5)
	assert.deepEqual(layer.effects, effects)
	// Video → loop preference untouched.
	assert.equal(layer.loop, true)

	// Content-owned behaviour still applies: still image forces loop off, transform stays.
	state.setLayerSource('s1', 0, { type: 'media', value: 'STILL.png', label: 'STILL' })
	assert.equal(layer.loop, false)
	assert.deepEqual(layer.fill, fill)
	assert.equal(layer.rotation, 12)
})

test('static guard: drop handlers gate the content-fit refit on isLayerSourceExchange', () => {
	const compose = fs.readFileSync(path.join(CLIENT, 'components/scenes-compose.js'), 'utf8')
	const row = fs.readFileSync(path.join(CLIENT, 'components/scene-layer-row.js'), 'utf8')

	// Both exchange entry points import the shared decision helper…
	assert.match(compose, /isLayerSourceExchange.*scene-state-layer-logic\.js/s)
	assert.match(row, /isLayerSourceExchange.*scene-state-layer-logic\.js/s)

	// …and use it (compose has two drop branches: multi-item and single-item).
	const composeUses = (compose.match(/isLayerSourceExchange\(/g) || []).length
	const rowUses = (row.match(/isLayerSourceExchange\(/g) || []).length
	assert.ok(composeUses >= 2, `scenes-compose.js should gate both drop branches (found ${composeUses})`)
	assert.ok(rowUses >= 1, `scene-layer-row.js should gate its drop handler (found ${rowUses})`)
})
