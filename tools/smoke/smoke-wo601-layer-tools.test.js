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
	it('serves MIXER_EFFECTS + categories', async () => {
		const { handleEffectRegistry } = require('../../src/api/routes-scene-layer-tools')
		const reg = await import(require('url').pathToFileURL(require('path').join(__dirname, '../../client/lib/effect-registry.js')).href)
		const r = JSON.parse((await handleEffectRegistry()).body)
		assert.deepStrictEqual(r.effects, JSON.parse(JSON.stringify(reg.MIXER_EFFECTS)))
		assert.deepStrictEqual(r.categories, reg.EFFECT_CATEGORIES)
	})
})
