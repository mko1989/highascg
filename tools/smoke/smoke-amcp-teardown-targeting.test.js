'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const tracker = require('../../src/state/playback-tracker')
const { targetTeardownLines } = require('../../src/caspar/amcp-teardown-targeting')
const { coalescePerLayerClearStorm } = require('../../src/caspar/amcp-coalesce-clears')

function freshCtx() {
	return { log: () => {} }
}

function decadeSweep(ch) {
	const lines = []
	for (let L = 10; L <= 900; L += 10) lines.push(`STOP ${ch}-${L}`, `MIXER ${ch}-${L} CLEAR`)
	lines.push(`MIXER ${ch} COMMIT`)
	return lines
}

test('recordAmcpLines tracks PLAY/MIXER/CG lines into the matrix', () => {
	const ctx = freshCtx()
	tracker.recordAmcpLines(ctx, [
		'PLAY 2-10 "PROJECTS/FOO/CLIP A" LOOP',
		'MIXER 2-10 FILL 0 0 1 1',
		'CG 2-11 ADD 0 "pip_border" 1 "{}"',
	])
	assert.deepEqual([...tracker.getOccupiedLayers(ctx, 2)].sort((a, b) => a - b), [10, 11])
	assert.deepEqual([...tracker.getMixerDirtyLayers(ctx, 2)], [10])
	assert.equal(tracker.isChannelTracked(ctx, 2), true)
	assert.equal(tracker.isChannelTracked(ctx, 3), false)
})

test('targetTeardownLines drops sweep lines for empty layers on tracked channels', () => {
	const ctx = freshCtx()
	tracker.recordAmcpLines(ctx, ['PLAY 2-10 X', 'MIXER 2-30 OPACITY 0.5'])
	const res = targetTeardownLines(decadeSweep(2), ctx)
	// kept: STOP/MIXER-CLEAR on L10 (occupied) and L30 (mixer dirty); COMMIT passes through
	assert.deepEqual(res.lines, [
		'STOP 2-10',
		'MIXER 2-10 CLEAR',
		'STOP 2-30',
		'MIXER 2-30 CLEAR',
		'MIXER 2 COMMIT',
	])
	assert.equal(res.dropped > 100, true)
	assert.deepEqual([...res.targetedChannels], [2])
})

test('untracked channels pass through and still coalesce to CLEAR <ch>', () => {
	const ctx = freshCtx()
	const sweep = decadeSweep(5)
	const res = targetTeardownLines(sweep, ctx)
	assert.equal(res.dropped, 0)
	const co = coalescePerLayerClearStorm(res.lines, { skipChannels: res.targetedChannels })
	assert.equal(co.coalesced, true)
	assert.equal(co.lines.includes('CLEAR 5'), true)
})

test('coalescing skips channels already targeted by the tracker', () => {
	const ctx = freshCtx()
	for (let L = 10; L <= 80; L += 10) tracker.recordAmcpLines(ctx, [`PLAY 2-${L} X`])
	const res = targetTeardownLines(decadeSweep(2), ctx)
	const co = coalescePerLayerClearStorm(res.lines, { skipChannels: res.targetedChannels })
	assert.equal(co.coalesced, false, 'targeted per-layer lines must not blanket to CLEAR 2')
	assert.equal(res.lines.filter((l) => /^STOP 2-/.test(l)).length, 8)
})

test('recordAmcpLines CLEAR <ch> empties matrix and mixer-dirty for that channel', () => {
	const ctx = freshCtx()
	tracker.recordAmcpLines(ctx, ['PLAY 2-10 X', 'MIXER 2-30 OPACITY 0.5', 'CLEAR 2'])
	assert.deepEqual([...tracker.getOccupiedLayers(ctx, 2)], [])
	assert.deepEqual([...tracker.getMixerDirtyLayers(ctx, 2)], [])
})

test('reconcile seeds matrix from INFO XML and marks channel tracked', async () => {
	const ctx = freshCtx()
	ctx.gatheredInfo = {
		channelXml: {
			1: '<channel><stage><layer><layer_10><foreground><producer><name>ffmpeg</name></producer></foreground></layer_10><layer_20><foreground><producer><name>empty</name></producer></foreground></layer_20></layer></stage></channel>',
		},
	}
	await tracker.reconcilePlaybackMatrixFromGatheredXml(ctx)
	assert.deepEqual([...tracker.getOccupiedLayers(ctx, 1)], [10])
	assert.equal(tracker.isChannelTracked(ctx, 1), true)
})
