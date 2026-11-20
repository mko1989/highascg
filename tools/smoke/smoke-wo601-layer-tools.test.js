'use strict'

/** WO-601 — layer-fit (web reapplyLayerFrameForContentFit) and layer-options (web inspector-mixer route choices). */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { pathToFileURL } = require('url')

const { handleLayerFit, handleLayerOptions } = require('../../src/api/routes-scene-layer-tools')

const look = { id: 'L1', mainScope: '0', layers: [{ layerNumber: 10, source: { type: 'media', value: 'A' }, contentFit: 'native' }, { layerNumber: 11, source: null }] }
const fitDeps = (over = {}) => ({ resolveScene: () => look, getChannelMap: () => ({ programResolutions: [{ w: 1920, h: 1080 }] }), mediaResolution: async () => ({ w: 1280, h: 720 }), ...over })
const P = (r) => JSON.parse(r.body)

describe('WO-601 layer-fit', () => {
	it('native 720p on 1080p → centred 2/3; stretch → full frame', async () => {
		assert.deepEqual(P(await handleLayerFit({ sceneId: 'L1', layerNumber: 10 }, {}, fitDeps())).fill, { x: 1 / 6, y: 1 / 6, scaleX: 2 / 3, scaleY: 2 / 3 })
		assert.deepEqual(P(await handleLayerFit({ sceneId: 'L1', layerNumber: 10, contentFit: 'stretch' }, {}, fitDeps())).fill, { x: 0, y: 0, scaleX: 1, scaleY: 1 })
	})
	it('WO-758: no injected map → the live canvas (3840×1792), not the 1920×1080 fallback', async () => {
		const ctx = { config: {}, state: { getState: () => ({ channelMap: { programResolutions: [{ w: 3840, h: 1792, fps: 25 }] } }) } }
		const deps = { resolveScene: () => look, mediaResolution: async () => ({ w: 1920, h: 896 }) }
		const r = P(await handleLayerFit({ sceneId: 'L1', layerNumber: 10, contentFit: 'fill-canvas' }, ctx, deps))
		assert.deepEqual(r.fill, { x: 0, y: 0, scaleX: 1, scaleY: 1 })
		const native = P(await handleLayerFit({ sceneId: 'L1', layerNumber: 10, contentFit: 'native' }, ctx, deps))
		assert.deepEqual(native.fill, { x: 0.25, y: 0.25, scaleX: 0.5, scaleY: 0.5 })
	})
	it('unknown resolution → ok:false, fill null (client keeps its fill)', async () => {
		const r = P(await handleLayerFit({ sceneId: 'L1', layerNumber: 10 }, {}, fitDeps({ mediaResolution: async () => null })))
		assert.equal(r.ok, false)
		assert.equal(r.fill, null)
	})
	it('400 / 404 (no look, no such layer, layer without source)', async () => {
		assert.equal((await handleLayerFit({ sceneId: 'L1' }, {}, fitDeps())).status, 400)
		assert.equal((await handleLayerFit({ sceneId: 'X', layerNumber: 10 }, {}, fitDeps({ resolveScene: () => null }))).status, 404)
		assert.equal((await handleLayerFit({ sceneId: 'L1', layerNumber: 99 }, {}, fitDeps())).status, 404)
		assert.equal((await handleLayerFit({ sceneId: 'L1', layerNumber: 11 }, {}, fitDeps())).status, 404)
	})
	it('a layer the server has not saved yet: the source in the request is fitted (was a 404 → 16:9 editor box)', async () => {
		const seen = []
		const deps = fitDeps({ mediaResolution: async (src) => (seen.push(src.value), { w: 832, h: 1248 }) })
		const r = P(await handleLayerFit({ sceneId: 'L1', layerNumber: 99, contentFit: 'vertical', source: { type: 'media', value: 'zegarek.jpg' } }, {}, deps))
		assert.equal(r.ok, true)
		assert.deepEqual(r.contentResolution, { w: 832, h: 1248 })
		assert.deepEqual(seen, ['zegarek.jpg'])
		const unsaved = P(await handleLayerFit({ sceneId: 'X', layerNumber: 10, source: { value: 'zegarek.jpg' } }, {}, fitDeps({ resolveScene: () => null, mediaResolution: async () => ({ w: 832, h: 1248 }) })))
		assert.equal(unsaved.ok, true, 'a look not on the server yet still gets its clip size')
	})
})

describe('WO-601 layer-options = the web modules on the /api/settings payload', () => {
	it('audio routes for the main equal audioOutputRoutesForLayout(resolveProgramLayoutForMain(...))', async () => {
		const lib = (n) => import(pathToFileURL(path.join(__dirname, '../../client/lib', n)).href)
		const [layouts, routes] = await Promise.all([lib('program-audio-layouts.js'), lib('audio-routes.js')])
		for (const settings of [{ channelMap: {} }, { channelMap: { screenCount: 2 }, audioRouting: { programLayout: '8ch' } }]) {
			const r = P(await handleLayerOptions({ mainIdx: '0' }, {}, { settings }))
			const want = layouts.resolveProgramLayoutForMain(settings, settings.channelMap, 0)
			assert.equal(r.programLayout, want)
			assert.deepEqual(r.audioRoutes, routes.audioOutputRoutesForLayout(want))
			assert.deepEqual(r.sourceChannelSets, ['all', '1+2', '3+4', '5+6', '7+8'])
		}
	})
})

describe('WO-601 GET /api/scene/effect-registry (web effect-registry.js, single source)', () => {
	it('serves MIXER_EFFECTS + categories + PIP_OVERLAYS', async () => {
		const { handleEffectRegistry } = require('../../src/api/routes-scene-layer-tools')
		const reg = await import(require('url').pathToFileURL(require('path').join(__dirname, '../../client/lib/effect-registry.js')).href)
		const r = JSON.parse((await handleEffectRegistry()).body)
		assert.deepStrictEqual(r.effects, JSON.parse(JSON.stringify(reg.MIXER_EFFECTS)))
		assert.deepStrictEqual(r.categories, reg.EFFECT_CATEGORIES)
		const pip = await import(require('url').pathToFileURL(require('path').join(__dirname, '../../client/lib/pip-overlay-registry.js')).href)
		assert.deepStrictEqual(r.pipOverlays, JSON.parse(JSON.stringify(pip.PIP_OVERLAYS)))
		assert.equal(r.pipMaxStack, pip.PIP_OVERLAY_MAX_STACK)
	})
})
