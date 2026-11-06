'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const schedule = require('../../src/engine/timeline-playback-amcp-schedule')
const send = require('../../src/engine/timeline-playback-amcp-send')

function harness() {
	return {
		self: { amcp: {} },
		_lastKfValues: new Map(),
		_lastKfSegment: new Map(),
		_interpProp: (_clip, _prop, ms) => ms / 1000,
	}
}
const clip = {
	keyframes: [
		{ property: 'opacity', time: 0, value: 0 },
		{ property: 'opacity', time: 1000, value: 1 },
	],
}

function apply(ctx, localMs, extra = {}) {
	const lines = []
	const sent = schedule._applyKeyedMixerProp.call(ctx, 1, 210, clip, 'opacity', localMs, 0, true, false, 25, { collectLines: lines, ...extra })
	return { sent, lines }
}

test('segment entry emits one deferred tween; same segment does not resend', () => {
	const ctx = harness()
	assert.deepEqual(apply(ctx, 0), { sent: true, lines: ['MIXER 1-210 OPACITY 0 0', 'MIXER 1-210 OPACITY 1 25 linear DEFER'] })
	assert.deepEqual(apply(ctx, 400), { sent: false, lines: [] })
})

test('take fade owns opacity and leaves segment uncached for the next tick', () => {
	const ctx = harness()
	assert.deepEqual(apply(ctx, 0, { takeFade: true }), { sent: false, lines: [] })
	assert.equal(ctx._lastKfSegment.size, 0)
	assert.equal(apply(ctx, 0).sent, true)
})

test('late entry must finish the tween at the existing segment end', { todo: 'WO-983: late-entry duration/easing policy needs coordinated scheduler change' }, () => {
	assert.deepEqual(apply(harness(), 400).lines, [
		'MIXER 1-210 OPACITY 0.4 0',
		'MIXER 1-210 OPACITY 1 15 linear DEFER',
	], '600 ms remain at 25 fps; using all 25 frames ends 400 ms late')
})

test('clearing a layer preserves similarly prefixed layers and other channels', () => {
	const ctx = harness()
	for (const map of [ctx._lastKfValues, ctx._lastKfSegment]) {
		for (const key of ['1-21-fill', '1-210-fill', '2-21-fill']) map.set(key, 1)
	}
	schedule._clearLayerMixerSchedule.call(ctx, 1, 21)
	for (const map of [ctx._lastKfValues, ctx._lastKfSegment]) assert.deepEqual([...map.keys()], ['1-210-fill', '2-21-fill'])
})

test('measure full-map visits when clearing 100 layers', (t) => {
	let visits = 0
	class CountingMap extends Map {
		*keys() {
			for (const key of super.keys()) {
				visits++
				yield key
			}
		}
	}
	const ctx = { _lastKfValues: new CountingMap(), _lastKfSegment: new CountingMap() }
	for (let layer = 210; layer < 310; layer++) {
		ctx._lastKfValues.set(`1-${layer}-fill`, 1)
		ctx._lastKfSegment.set(`1-${layer}-fill-seg`, 0)
	}
	for (let layer = 210; layer < 310; layer++) schedule._clearLayerMixerSchedule.call(ctx, 1, layer)
	assert.equal(ctx._lastKfValues.size + ctx._lastKfSegment.size, 0)
	// Diagnostic only: an indexing optimization is welcome to reduce this number.
	t.diagnostic(`100 layers / 200 initial keys: ${visits} key visits`)
})

test('resume validation rejects stale identity, route type, loop mode or frame', () => {
	const prev = { clipId: 'c', isRoute: false, loopAlways: false, frame: 2147483648 }
	const media = { id: 'c', source: { value: 'clip.mov' } }
	const validate = (p, c = media, meta = { frame: 2147483648 }) => send._validateClipStateForResume(p, c, meta)
	assert.equal(validate(prev), true)
	assert.equal(validate(null), false)
	assert.equal(validate({ ...prev, clipId: 'other' }), false)
	assert.equal(validate(prev, { ...media, source: { value: 'route://1-10' } }), false)
	assert.equal(validate(prev, { ...media, loopAlways: true }), false)
	assert.equal(validate(prev, media, { frame: 2147483649 }), false)
})

const { abortFailedTake } = require('../../src/engine/scene-take-lbg-phase-b-abort')
const { sendTakeJobsLoadAndMixerBatch } = require('../../src/engine/scene-take-lbg-amcp-pipeline-batch')

for (const [activeBank, inactiveBank, isMergeTransition, expected] of [
	['a', 'b', false, ['STOP 1-110', 'STOP 1-111']],
	['a', 'a', false, []],
	['a', 'b', true, []],
]) {
	test(`failed take cleanup protects outgoing bank: ${activeBank}/${inactiveBank}, merge=${isMergeTransition}`, async () => {
		const calls = []
		const cause = new Error('synthetic PLAY failure')
		const result = await abortFailedTake({ batchSend: async lines => calls.push(...lines) }, {
			self: {}, channel: 1, takeJobs: [{ pLayer: 110 }, { pLayer: 111 }], activeBank, inactiveBank, isMergeTransition, error: cause,
		})
		assert.deepEqual(calls, expected)
		assert.equal(result.cause, cause)
		assert.match(result.message, /synthetic PLAY failure/)
	})
}

test('failed cleanup keeps the original take error as its cause', async () => {
	const cause = new Error('PLAY failed')
	const logs = []
	const result = await abortFailedTake({ batchSend: async () => { throw new Error('STOP failed') } }, {
		self: { log: (...args) => logs.push(args) }, channel: 1, takeJobs: [{ pLayer: 110 }],
		activeBank: 'a', inactiveBank: 'b', isMergeTransition: false, error: cause,
	})
	assert.equal(result.cause, cause)
	assert.equal(logs[0][0], 'warn')
	assert.match(logs[0][1], /STOP failed/)
})

test('empty look phase A emits no commands in either batching mode', async () => {
	for (const twoPhaseBatch of [false, true]) {
		// An empty amcp object makes any accidental transport call fail this test.
		await sendTakeJobsLoadAndMixerBatch({}, {
			self: {}, channel: 1, takeJobs: [], mergeMixerExtras: [], borderLines: [],
			twoPhaseBatch, currentSceneLayers: [], currentMap: new Map(),
		})
	}
})
