'use strict'

/**
 * WO-601 effects editor — effect edits on a staged look are not content changes (web isGeometryOnlyPreview),
 * so they ride the MIXER nudge. Pins: preview-push asks the nudge for ALL effects (the web's geometry-only
 * push sends every effectToAmcpLines line), every line DEFERs into the nudge COMMIT, and an effect removed
 * since the staged look is reset to identity.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { buildNudgeLinesForLayer, NEUTRAL_EFFECT_PARAMS } = require('../../src/api/routes-preview-nudge')
const { handlePreviewPush, removedEffectTypes } = require('../../src/api/routes-scene-preview-push')

const fill = { x: 0, y: 0, scaleX: 1, scaleY: 1 }
const layer = {
	layerNumber: 10,
	source: { type: 'media', value: 'CLIP_A' },
	effects: [
		{ type: 'brightness', params: { value: 1.4 } },
		{ type: 'crop', params: { left: 0.1, top: 0, right: 0.9, bottom: 1 } },
		{ type: 'chroma_key', params: { key: 'Green', threshold: 0.3, softness: 0.4, spill: 1, blur: 0 } },
	],
}

describe('WO-601 nudge effect lines', () => {
	it('default (web drag nudge) keeps crop only', () => {
		const lines = buildNudgeLinesForLayer(2, layer, fill)
		assert.ok(lines.includes('MIXER 2-10 CROP 0.1 0 0.9 1 0 DEFER'))
		assert.ok(!lines.some((l) => /BRIGHTNESS|CHROMA/.test(l)))
	})
	it('allEffects → every effect, deferred', () => {
		const lines = buildNudgeLinesForLayer(2, layer, fill, null, { allEffects: true })
		assert.ok(lines.includes('MIXER 2-10 BRIGHTNESS 1.4 0 DEFER'))
		assert.ok(lines.includes('MIXER 2-10 CHROMA Green 0.3 0.4 1 0 DEFER'))
		assert.ok(lines.includes('MIXER 2-10 CROP 0.1 0 0.9 1 0 DEFER'))
		assert.ok(lines.filter((l) => /BRIGHTNESS|CHROMA|CROP/.test(l)).every((l) => / DEFER$/.test(l)), lines.join('\n'))
	})
	it('removed effects reset to identity', () => {
		const lines = buildNudgeLinesForLayer(2, { ...layer, effects: [] }, fill, null, { allEffects: true, resetEffectTypes: ['levels', 'blend_mode', 'grid', 'perspective', 'keyer'] })
		assert.ok(lines.includes('MIXER 2-10 LEVELS 0 1 1 0 1 0 DEFER'))
		assert.ok(lines.includes('MIXER 2-10 BLEND NORMAL DEFER'))
		assert.ok(lines.includes('MIXER 2-10 GRID 1 0 DEFER'))
		assert.ok(lines.includes('MIXER 2-10 PERSPECTIVE 0 0 1 0 1 1 0 1 0 DEFER'))
		assert.ok(!lines.some((l) => / KEYER /.test(l)), 'keyer belongs to straight alpha')
		assert.ok(!('rotation' in NEUTRAL_EFFECT_PARAMS) && !('anchor' in NEUTRAL_EFFECT_PARAMS))
	})
})

describe('WO-601 preview-push → nudge with all effects + resets', () => {
	const staged = { sceneId: 'L1', scene: { id: 'L1', layers: [{ ...layer, effects: [...layer.effects, { type: 'saturation', params: { value: 0 } }] }] } }
	it('removedEffectTypes diffs per layer', () => {
		assert.deepStrictEqual(removedEffectTypes(staged.scene, { layers: [layer] }), { 10: ['saturation'] })
		assert.deepStrictEqual(removedEffectTypes(staged.scene, { layers: [] }), {}, 'a removed layer is a take, not a reset')
		assert.deepStrictEqual(removedEffectTypes(null, { layers: [layer] }), {})
	})
	it('handler sends allEffects + resetEffects to the nudge', async () => {
		const calls = []
		const res = await handlePreviewPush({ sceneId: 'L1' }, {}, {
			resolveSceneById: () => ({ id: 'L1', mainScope: '0', layers: [layer] }),
			getChannelMap: () => ({ programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080 }] }),
			getStaged: () => staged,
			nudge: async (b) => { calls.push(b); return { status: 200, body: JSON.stringify({ ok: true, lines: 9 }) } },
			takeLook: async () => { throw new Error('effect edit must not re-take') },
			registerStaged: async () => {},
		})
		assert.equal(JSON.parse(res.body).mode, 'nudge')
		assert.equal(calls[0].allEffects, true)
		assert.deepStrictEqual(calls[0].resetEffects, { 10: ['saturation'] })
	})
})
