'use strict'

/**
 * WO-961 — changing a look layer's content sizing (contentFit) while the look is staged on PRV is a MIXER nudge, not a
 * preview take: the take (forceCut PLAY) restarted the clip on PRV. The nudge resolves the layer's fill with the NEW
 * contentFit (scene-native-fill.js getResolvedFillForSceneLayer, the take's own math), so PRV still shows the new sizing.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const { decidePreviewPush, handlePreviewPush } = require('../../src/api/routes-scene-preview-push')
const { resolveSceneLayerFill } = require('../../src/engine/scene-native-fill')

const look = (fit) => ({
	id: 'L1',
	name: 'Look',
	mainScope: '0',
	layers: [
		{
			layerNumber: 10,
			source: { type: 'media', value: 'CLIP' },
			fill: { x: 0.1, y: 0.1, scaleX: 0.5, scaleY: 0.8 },
			opacity: 1,
			...(fit === undefined ? {} : { contentFit: fit }),
		},
		{ layerNumber: 11, source: { type: 'media', value: 'LOGO' }, fill: { x: 0.7, y: 0.1, scaleX: 0.2, scaleY: 0.2 }, contentFit: 'native' },
	],
})
const staged = (fit) => ({ sceneId: 'L1', scene: look(fit) })

describe('WO-961 content sizing nudges PRV', () => {
	it('a contentFit change alone → nudge (every fit, absent = native)', async () => {
		for (const [from, to] of [
			['native', 'stretch'],
			['native', 'fill-canvas'],
			['stretch', 'horizontal'],
			['horizontal', 'vertical'],
			[undefined, 'stretch'],
			['vertical', undefined],
		]) {
			assert.equal(await decidePreviewPush(staged(from), look(to), 'L1'), 'nudge', `${from} → ${to}`)
		}
	})
	it('a contentFit change with a real content change still reloads', async () => {
		const clip = look('stretch')
		clip.layers[0].source.value = 'CLIP_B'
		assert.equal(await decidePreviewPush(staged('native'), clip, 'L1'), 'take', 'clip swapped')
		const loop = look('stretch')
		loop.layers[0].loop = true
		assert.equal(await decidePreviewPush(staged('native'), loop, 'L1'), 'take', 'loop flipped')
		const trim = look('stretch')
		trim.layers[0].trimOutMs = 3000
		assert.equal(await decidePreviewPush(staged('native'), trim, 'L1'), 'take', 'trim (WO-955)')
	})
	it('the handler nudges with the new contentFit and never takes', async () => {
		const calls = []
		const res = await handlePreviewPush(
			{ sceneId: 'L1', mainIdx: 0 },
			{},
			{
				resolveSceneById: () => look('stretch'),
				getChannelMap: () => ({ programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080, fps: 50 }] }),
				getStaged: () => staged('native'),
				nudge: async (b) => {
					calls.push(['nudge', b])
					return { status: 200, body: JSON.stringify({ ok: true, lines: 5 }) }
				},
				takeLook: async (b) => {
					calls.push(['take', b])
					return { status: 200, body: JSON.stringify({ ok: true }) }
				},
				registerStaged: async () => calls.push(['register']),
			}
		)
		assert.equal(JSON.parse(res.body).mode, 'nudge')
		assert.deepEqual(calls.map((c) => c[0]), ['nudge', 'register'])
		assert.equal(calls[0][1].layers.find((l) => l.layerNumber === 10).contentFit, 'stretch', 'the nudge sees the new fit')
	})
	it('the nudge fill follows contentFit (same resolver as the take)', () => {
		const layer = (fit) => ({ ...look(fit).layers[0] })
		const media = { w: 1920, h: 1080 }
		const fill = (fit) => resolveSceneLayerFill(layer(fit), 1920, 1080, 1920, 1080, media)
		assert.deepEqual(fill('stretch'), { x: 0.1, y: 0.1, scaleX: 0.5, scaleY: 0.8 }, 'stretch = the rect')
		assert.notDeepEqual(fill('native'), fill('stretch'), 'native contain-fits the 16:9 clip inside the 5:8 rect')
		assert.notDeepEqual(fill('vertical'), fill('horizontal'))
	})
})
