'use strict'

/**
 * WO-955 — a look layer's trim in / out edit reloads PRV (a preview take carries SEEK / LENGTH) instead of a MIXER
 * nudge that cannot show it (WO-954: the trimmed loop kept its black tail on PRV until the look was staged again).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const { decidePreviewPush, handlePreviewPush } = require('../../src/api/routes-scene-preview-push')

const look = () => ({
	id: 'L1',
	name: 'Look',
	mainScope: '0',
	layers: [
		{
			layerNumber: 10,
			source: { type: 'media', value: 'LOOP' },
			loop: true,
			fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
			opacity: 1,
		},
		{
			layerNumber: 11,
			source: { type: 'media', value: 'LOGO' },
			fill: { x: 0.7, y: 0.1, scaleX: 0.2, scaleY: 0.2 },
			opacity: 1,
		},
	],
})

describe('WO-955 trim edits reload PRV', () => {
	it('trim out / trim in set, changed or cleared → take', async () => {
		const trimmed = look()
		trimmed.layers[0].trimOutMs = 3940
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: look() }, trimmed, 'L1'), 'take', 'out set')
		const moved = look()
		moved.layers[0].trimOutMs = 3900
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: trimmed }, moved, 'L1'), 'take', 'out moved')
		const cleared = look()
		cleared.layers[0].trimOutMs = null
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: trimmed }, cleared, 'L1'), 'take', 'out cleared')
		const inSet = look()
		inSet.layers[1].trimInMs = 240
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: look() }, inSet, 'L1'), 'take', 'in set')
	})
	it('the same trim with a geometry change stays a MIXER nudge', async () => {
		const staged = look()
		staged.layers[0].trimOutMs = 3940
		const edited = look()
		edited.layers[0].trimOutMs = 3940
		edited.layers[0].opacity = 0.5
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: staged }, edited, 'L1'), 'nudge')
		const noTrim = look()
		noTrim.layers[1].fill = { x: 0.5, y: 0.5, scaleX: 0.3, scaleY: 0.3 }
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: look() }, noTrim, 'L1'), 'nudge', 'absent = null')
	})
	it('the handler takes the look to PRV (forceCut) for a trim edit', async () => {
		const calls = []
		const edited = look()
		edited.layers[0].trimOutMs = 3940
		const res = await handlePreviewPush(
			{ sceneId: 'L1', mainIdx: 0 },
			{},
			{
				resolveSceneById: () => edited,
				getChannelMap: () => ({
					programChannels: [2],
					previewChannels: [3],
					programResolutions: [{ w: 1920, h: 1080, fps: 50 }],
				}),
				getStaged: () => ({ sceneId: 'L1', scene: look() }),
				nudge: async (b) => {
					calls.push(['nudge', b])
					return { status: 200, body: JSON.stringify({ ok: true }) }
				},
				takeLook: async (b) => {
					calls.push(['take', b])
					return { status: 200, body: JSON.stringify({ ok: true }) }
				},
			}
		)
		assert.equal(JSON.parse(res.body).mode, 'take')
		assert.deepEqual(calls, [['take', { sceneId: 'L1', mainIdx: 0, target: 'preview', forceCut: true }]])
	})
})
