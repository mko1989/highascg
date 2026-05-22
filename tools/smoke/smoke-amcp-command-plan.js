'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildClipCommandPlan, serializeClipCommandPlan } = require('../../src/caspar/amcp-command-plan')
const { msToFrames, normalizeTransitionForAmcp, diffCasparLayerPlan } = require('../../src/caspar/amcp-layer-diff-plan')

test('serialize LOADBG with MIX transition', () => {
	const plan = buildClipCommandPlan('LOADBG', 1, 10, 'AMB/template.mp4', {
		transition: 'MIX',
		duration: 25,
		tween: 'linear',
		direction: 'RIGHT',
	})
	assert.equal(serializeClipCommandPlan(plan), 'LOADBG 1-10 AMB/template.mp4 MIX 25 linear RIGHT')
})

test('serialize PLAY swap omits clip-scoped params', () => {
	const plan = buildClipCommandPlan('PLAY', 1, 10, '', {
		transition: 'MIX',
		duration: 25,
		tween: 'linear',
		seek: 12,
		length: 100,
	})
	assert.equal(serializeClipCommandPlan(plan), 'PLAY 1-10')
})

test('serialize PLAY with clip keeps transition + seek + length', () => {
	const plan = buildClipCommandPlan('PLAY', 1, 10, 'AMB/next.mp4', {
		transition: 'MIX',
		duration: 25,
		tween: 'linear',
		seek: 12,
		length: 100,
	})
	assert.equal(serializeClipCommandPlan(plan), 'PLAY 1-10 AMB/next.mp4 MIX 25 linear SEEK 12 LENGTH 100')
})

test('msToFrames converts transition ms using fps', () => {
	assert.equal(msToFrames(500, 25), 12)
	assert.equal(msToFrames(500, 50), 25)
})

test('normalizeTransitionForAmcp maps ms + easing to clip opts', () => {
	assert.deepEqual(
		normalizeTransitionForAmcp({ type: 'mix', durationMs: 500, easing: 'LINEAR', direction: 'RIGHT' }, 50),
		{ transition: 'MIX', duration: 25, tween: 'LINEAR', direction: 'RIGHT' }
	)
})

test('diffCasparLayerPlan emits LOADBG then PLAY swap', () => {
	const plan = diffCasparLayerPlan(
		{ channel: 1, layer: 10, nextUp: { clip: 'AMB/old.mp4' }, playing: true },
		{
			channel: 1,
			layer: 10,
			nextUp: { clip: 'AMB/new.mp4', loop: true, transition: { type: 'MIX', durationMs: 500, easing: 'LINEAR', direction: 'RIGHT' } },
			playing: true,
		},
		{ fps: 50 }
	)
	assert.equal(plan.length, 2)
	assert.equal(serializeClipCommandPlan(plan[0]), 'LOADBG 1-10 AMB/new.mp4 LOOP MIX 25 LINEAR RIGHT')
	assert.equal(serializeClipCommandPlan(plan[1]), 'PLAY 1-10')
})
