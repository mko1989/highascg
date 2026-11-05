'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { handleLayerScrub } = require('../../src/api/routes-scene-layer-scrub')

const scene = { mainScope: 0, layers: [{ layerNumber: 3, source: { type: 'media', value: 'clip' } }] }
const deps = (calls) => ({
	resolveScene: () => scene,
	getChannelMap: () => ({ programChannels: [1], previewChannels: [2] }),
	getStaged: () => ({ sceneId: 's1', scene }),
	transportAct: async (ch, l, kind) => calls.push([ch, l, kind]),
})

test('WO-962 transport pause/resume goes to the PRV channel, no ms needed', async () => {
	const calls = []
	const r = await handleLayerScrub({ sceneId: 's1', layerNumber: 3, transport: 'pause' }, {}, deps(calls))
	const b = JSON.parse(r.body)
	assert.strictEqual(b.onPrv, true)
	assert.deepStrictEqual(calls, [[2, 3, 'pause']])
})

test('WO-962 transport on a look not on PRV sends nothing', async () => {
	const calls = []
	const d = { ...deps(calls), getStaged: () => ({ sceneId: 'other' }) }
	const b = JSON.parse((await handleLayerScrub({ sceneId: 's1', layerNumber: 3, transport: 'resume' }, {}, d)).body)
	assert.strictEqual(b.onPrv, false)
	assert.deepStrictEqual(calls, [])
})
