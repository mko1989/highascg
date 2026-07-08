'use strict'

// WO-154 — app-managed loop restart for long looping clips.

const test = require('node:test')
const assert = require('node:assert/strict')
const { pollLoopRestarts, normalizeAppManagedLoop } = require('../../src/engine/loop-restart-watchdog')

const CFG = { minDurationSec: 600, marginMs: 2500 }
const PLAY_LINE = 'PLAY 1-10 "testowe/long.mov" LOOP AF pan=8c|c0=c0|c1=c1'

function matrixEntry(over = {}) {
	return {
		channel: 1,
		layer: 10,
		clip: 'testowe/long.mov',
		playing: true,
		loop: true,
		durationMs: 2850_400,
		playLine: PLAY_LINE,
		...over,
	}
}
function snap(elapsedSec) {
	return { channels: { 1: { layers: { 10: { file: { elapsed: elapsedSec } } } } } }
}

test('config defaults: disabled; margin floors above poll interval', () => {
	assert.equal(normalizeAppManagedLoop(undefined).enabled, false)
	assert.equal(normalizeAppManagedLoop({ enabled: true }).minDurationSec, 600)
	assert.equal(normalizeAppManagedLoop({ enabled: true, marginMs: 100 }).marginMs, 2500)
	assert.equal(normalizeAppManagedLoop({ enabled: true, marginMs: 5000 }).marginMs, 5000)
})

test('re-issues the ORIGINAL play line (AF preserved) near the wrap, once', () => {
	const sent = []
	const m = { '1-10': matrixEntry() }
	let t = 1_000_000
	const now = () => t
	// mid-clip: nothing
	assert.equal(pollLoopRestarts(m, snap(1000), CFG, (l) => sent.push(l), now), 0)
	// 2s before wrap (remaining 2000ms <= 2500ms margin): restart with the exact line
	assert.equal(pollLoopRestarts(m, snap(2848.4), CFG, (l) => sent.push(l), now), 1)
	assert.deepEqual(sent, [PLAY_LINE])
	// cooldown: same window, no double fire
	t += 1500
	assert.equal(pollLoopRestarts(m, snap(2849.5), CFG, (l) => sent.push(l), now), 0)
	// next wrap after cooldown fires again
	t += 60_000
	assert.equal(pollLoopRestarts(m, snap(2848.9), CFG, (l) => sent.push(l), now), 1)
})

test('unmanaged cases: short clip, no loop, not playing, no captured line, no OSC elapsed', () => {
	const sent = []
	const send = (l) => sent.push(l)
	assert.equal(pollLoopRestarts({ k: matrixEntry({ durationMs: 30_000 }) }, snap(29.5), CFG, send), 0)
	assert.equal(pollLoopRestarts({ k: matrixEntry({ loop: false }) }, snap(2849), CFG, send), 0)
	assert.equal(pollLoopRestarts({ k: matrixEntry({ playing: false }) }, snap(2849), CFG, send), 0)
	assert.equal(pollLoopRestarts({ k: matrixEntry({ playLine: undefined }) }, snap(2849), CFG, send), 0)
	assert.equal(pollLoopRestarts({ k: matrixEntry() }, { channels: {} }, CFG, send), 0)
	assert.equal(sent.length, 0)
})
