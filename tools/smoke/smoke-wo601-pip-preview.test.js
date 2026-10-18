'use strict'

/**
 * WO-601 PIP overlays — an overlay-only edit of the staged PRV look is pushed as nudge + overlay CG lines
 * ('overlay' mode), never a forceCut re-take (which LOADBG … SEEK 0 + PLAYs every clip of the look).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { decidePreviewPush, handlePreviewPush } = require('../../src/api/routes-scene-preview-push')
const { buildPreviewPipLines } = require('../../src/api/routes-scene-preview-pip')

const border = (over = {}) => ({ type: 'border', params: { width: 4, color: '#e63946', radius: 0, opacity: 1, side: 'outside', ...over } })
const shadow = () => ({ type: 'shadow', params: { blur: 20, offsetX: 5, offsetY: 5, color: 'rgba(0,0,0,0.6)', spread: 0, radius: 0, side: 'outside', opacity: 1 } })
const look = (pips, over = {}) => ({
	id: 'L1', mainScope: '0',
	layers: [
		{ layerNumber: 10, source: { type: 'media', value: 'CLIP_A' }, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } },
		{ layerNumber: 11, source: { type: 'media', value: 'CLIP_B' }, fill: { x: 0.5, y: 0.5, scaleX: 0.4, scaleY: 0.4 }, pipOverlays: pips, ...over },
	],
})
const staged = (pips) => ({ sceneId: 'L1', scene: look(pips) })

describe('WO-601 decidePreviewPush overlay mode', () => {
	it('overlay-only change → overlay', async () => {
		assert.equal(await decidePreviewPush(staged([]), look([border()]), 'L1'), 'overlay')
		assert.equal(await decidePreviewPush(staged([border()]), look([border({ width: 9 })]), 'L1'), 'overlay')
		assert.equal(await decidePreviewPush(staged([border()]), look([]), 'L1'), 'overlay')
	})
	it('overlay + clip change → take; geometry only → nudge', async () => {
		const edited = look([border()])
		edited.layers[0].source.value = 'CLIP_C'
		assert.equal(await decidePreviewPush(staged([]), edited, 'L1'), 'take')
		assert.equal(await decidePreviewPush(staged([border()]), look([border()], { fill: { x: 0, y: 0, scaleX: 0.5, scaleY: 0.5 } }), 'L1'), 'nudge')
	})
})

describe('WO-601 buildPreviewPipLines', () => {
	const fills = new Map([[10, { x: 0, y: 0, scaleX: 1, scaleY: 1 }], [11, { x: 0.5, y: 0.5, scaleX: 0.4, scaleY: 0.4 }]])
	const build = (prev, cur) => buildPreviewPipLines({ channel: 2, layers: look(cur).layers, stagedLayers: look(prev).layers, fills, appCtx: {} })
	it('unchanged → nothing; only the changed layer gets lines', () => {
		assert.deepStrictEqual(build([border()], [border()]), [])
		assert.ok(build([], [border()]).every((l) => / 2-26[4-7]( |$)/.test(l)), 'layer 11 slots only (260 + 1×4 …)')
	})
	it('added → clear slots, ADD template', () => {
		const lines = build([], [border()])
		assert.ok(lines.includes('CG 2-264 CLEAR'))
		assert.ok(lines.some((l) => l.startsWith('CG 2-264 ADD 0 "pip_border" 1 ')))
		assert.ok(!lines.some((l) => /^(LOADBG|PLAY|STOP) /.test(l)), 'clips untouched')
	})
	it('same inside overlay, param changed → CG UPDATE in place, no ADD', () => {
		const lines = build([border({ side: 'inside' })], [border({ side: 'inside', width: 9 })])
		assert.ok(lines.some((l) => l.startsWith('CG 2-264 UPDATE 0 ') && l.includes('9')))
		assert.ok(!lines.some((l) => / ADD /.test(l)))
	})
	it('reordered / removed → slots cleared first', () => {
		const re = build([border(), shadow()], [shadow(), border()])
		assert.ok(re.indexOf('CG 2-265 CLEAR') >= 0 && re.findIndex((l) => l.startsWith('CG 2-264 ADD 0 "pip_shadow"')) > re.indexOf('CG 2-264 CLEAR'))
		const gone = build([border(), shadow()], [])
		assert.deepStrictEqual(gone.filter((l) => / ADD /.test(l)), [])
		for (const s of [264, 265, 266, 267]) assert.ok(gone.includes(`CG 2-${s} CLEAR`), `slot ${s} cleared`)
	})
})

describe('WO-601 handlePreviewPush overlay mode', () => {
	it('nudge + overlay push, no take', async () => {
		const calls = []
		const res = await handlePreviewPush({ sceneId: 'L1' }, {}, {
			resolveSceneById: () => look([border({ width: 9 })]),
			getChannelMap: () => ({ programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080 }] }),
			getStaged: () => staged([border()]),
			nudge: async () => { calls.push('nudge'); return { status: 200, body: JSON.stringify({ ok: true, lines: 6 }) } },
			pushPip: async (a) => { calls.push(['pip', a.prvCh, a.scene.layers[1].pipOverlays[0].params.width]); return { ok: true, lines: 8 } },
			takeLook: async () => { throw new Error('an overlay edit must not re-take') },
			registerStaged: async () => { calls.push('register') },
		})
		const b = JSON.parse(res.body)
		assert.equal(b.mode, 'overlay')
		assert.equal(b.pipLines, 8)
		assert.deepStrictEqual(calls, ['nudge', ['pip', 2, 9], 'register'])
	})
})
