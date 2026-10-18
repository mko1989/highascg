'use strict'

/**
 * WO-600 F / WO-598 thin client — POST /api/scene/new-layer builds the layer a media drop creates in the
 * web compose frame (scenes-compose.js addLayerFromMedia): addLayer (next free number ≥ 10, defaultLayerConfig
 * + editor scene defaults) → setLayerSource (images never loop) → the file's trim/mute defaults (WO-592) → native fill for the content fit
 * (fill-math sceneLayerPixelRectForContentFit / pixelRectToFill). Built with the SAME client modules,
 * returned, never stored — the client appends it (deck sync + preview-push as any edit).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { handleNewLayer } = require('../../src/api/routes-scene-new-layer')

const deps = (over = {}) => ({
	resolveScene: () => ({ id: 'L1', mainScope: '0', layers: [{ layerNumber: 10 }, { layerNumber: 12 }] }),
	getChannelMap: () => ({ programResolutions: [{ w: 1920, h: 1080 }] }),
	editorDefaults: () => ({ scene: { loop: true, startBehaviour: 'relativeToPrevious', contentFit: 'native' } }),
	mediaResolution: async () => ({ w: 1280, h: 720 }),
	...over,
})
const body = (src) => ({ sceneId: 'L1', source: src })
const parse = (r) => JSON.parse(r.body)

describe('WO-600 new-layer — same layer the web drop builds', () => {
	it('next free layer number, defaults, source, native fill for 720p on 1080p', async () => {
		const r = parse(await handleNewLayer(body({ type: 'media', value: 'CLIPS/A', label: 'A' }), {}, deps()))
		const L = r.layer
		assert.equal(r.ok, true)
		assert.equal(L.layerNumber, 11, 'lowest free ≥ 10')
		assert.equal(L.loop, true, 'editor default loop')
		assert.equal(L.startBehaviour, 'relativeToPrevious', 'editor default start')
		assert.deepEqual(L.source, { type: 'media', value: 'CLIPS/A', label: 'A' })
		assert.deepEqual(L.fill, { x: 1 / 6, y: 1 / 6, scaleX: 2 / 3, scaleY: 2 / 3 }, 'native = 1280×720 centred on 1920×1080')
		assert.equal(L.opacity, 1)
		assert.deepEqual(L.pipOverlays, [])
	})
	it('WO-592 owner decision: the file\'s trim/mute defaults are copied into the new layer', async () => {
		const d = deps({ fileDefaults: (v) => (v === 'CLIPS/A' ? { trimInMs: 1500, trimOutMs: 9000, muted: true } : null) })
		const L = parse(await handleNewLayer(body({ type: 'media', value: 'CLIPS/A' }), {}, d)).layer
		assert.equal(L.trimInMs, 1500)
		assert.equal(L.trimOutMs, 9000)
		assert.equal(L.muted, true)
		const N = parse(await handleNewLayer(body({ type: 'media', value: 'CLIPS/B' }), {}, d)).layer
		assert.equal('trimInMs' in N, false, 'no defaults → nothing copied')
		assert.equal(N.muted, false)
	})
	it('images never loop (setLayerSource rule)', async () => {
		const L = parse(await handleNewLayer(body({ type: 'media', value: 'STILLS/logo.png' }), {}, deps())).layer
		assert.equal(L.loop, false)
	})
	it('unknown resolution → full-frame default fill', async () => {
		const L = parse(await handleNewLayer(body({ type: 'media', value: 'X' }), {}, deps({ mediaResolution: async () => null }))).layer
		assert.deepEqual(L.fill, { x: 0, y: 0, scaleX: 1, scaleY: 1 })
	})
	it('stretch content fit fills the canvas', async () => {
		const L = parse(await handleNewLayer(body({ type: 'media', value: 'X' }), {}, deps({ editorDefaults: () => ({ scene: { contentFit: 'stretch' } }) }))).layer
		assert.deepEqual(L.fill, { x: 0, y: 0, scaleX: 1, scaleY: 1 })
		assert.equal(L.contentFit, 'stretch')
	})
	it('full look → 409; bad input → 400/404; route sources refused for now', async () => {
		const full = { id: 'L1', layers: Array.from({ length: 90 }, (_, i) => ({ layerNumber: 10 + i })) }
		assert.equal((await handleNewLayer(body({ value: 'X' }), {}, deps({ resolveScene: () => full }))).status, 409)
		assert.equal((await handleNewLayer({ sceneId: 'L1' }, {}, deps())).status, 400)
		assert.equal((await handleNewLayer(body({ value: 'X' }), {}, deps({ resolveScene: () => null }))).status, 404)
		assert.equal((await handleNewLayer(body({ type: 'route', value: 'route://1' }), {}, deps())).status, 400)
	})
})
