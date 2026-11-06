'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { serializeClipCommandPlan, buildClipCommandPlan } = require('../../src/caspar/amcp-command-plan')
const { normalizeSpeed, atempoChain, clipSupportsSpeed } = require('../../src/caspar/clip-speed')
const { diffCasparLayerPlan } = require('../../src/caspar/amcp-layer-diff-plan')
const { layerVisuallyEqual } = require('../../src/engine/scene-transition')

const ser = (cmd, clip, opts) => serializeClipCommandPlan(buildClipCommandPlan(cmd, 3, 10, clip, opts))

test('WO-973 normalizeSpeed: 1 / junk = null, clamped 0.25-4', () => {
	for (const v of [undefined, null, '', 'x', 0, -1, 1, 1.0001]) assert.strictEqual(normalizeSpeed(v), null)
	assert.strictEqual(normalizeSpeed(2), 2)
	assert.strictEqual(normalizeSpeed(0.1), 0.25)
	assert.strictEqual(normalizeSpeed(9), 4)
	assert.strictEqual(normalizeSpeed(0.333), 0.33)
})

test('WO-973 atempo chains below 0.5', () => {
	assert.strictEqual(atempoChain(2), 'atempo=2')
	assert.strictEqual(atempoChain(0.5), 'atempo=0.5')
	assert.strictEqual(atempoChain(0.25), 'atempo=0.5,atempo=0.5')
	assert.strictEqual(atempoChain(0.3), 'atempo=0.5,atempo=0.6')
})

test('WO-973 LOADBG string: IN/SEEK kept, LENGTH scaled, VF + AF appended', () => {
	assert.strictEqual(
		ser('LOADBG', 'clip', { speed: 2, in: 50, seek: 50, length: 100 }),
		'LOADBG 3-10 clip IN 50 SEEK 50 LENGTH 50 VF "setpts=(PTS-STARTPTS)/2+STARTPTS" AF "atempo=2"'
	)
	assert.strictEqual(ser('LOADBG', 'clip', { speed: 0.5, loop: true }), 'LOADBG 3-10 clip LOOP VF "setpts=(PTS-STARTPTS)/0.5+STARTPTS" AF "atempo=0.5"')
})

test('WO-973 speed joins the audio route filter (pan first)', () => {
	const c = ser('LOADBG', 'clip', { speed: 4, audioFilter: 'pan=8c|c2=c0|c3=c1' })
	assert.ok(c.endsWith('VF "setpts=(PTS-STARTPTS)/4+STARTPTS" AF "pan=8c|c2=c0|c3=c1,atempo=4"'), c)
})

test('WO-973 LENGTH is output time: divided by the speed', () => {
	assert.ok(ser('LOADBG', 'clip', { speed: 0.5, length: 50 }).includes('LENGTH 100 '))
	assert.ok(ser('LOADBG', 'clip', { length: 50 }).endsWith('LENGTH 50'))
})

test('WO-973 no speed / speed 1 / bare PLAY: command unchanged', () => {
	assert.strictEqual(ser('LOADBG', 'clip', { speed: 1 }), 'LOADBG 3-10 clip')
	assert.strictEqual(ser('PLAY', '', { speed: 2 }), 'PLAY 3-10')
	assert.strictEqual(ser('LOADBG', 'clip', { audioFilter: 'pan=2c|c0=c1' }), 'LOADBG 3-10 clip AF "pan=2c|c0=c1"')
})

test('WO-973 diff plan carries speed to the LOADBG', () => {
	const plans = diffCasparLayerPlan({ channel: 3, layer: 10, nextUp: null }, { channel: 3, layer: 10, nextUp: { clip: 'clip', speed: 2 }, playing: false })
	assert.ok(serializeClipCommandPlan(plans[0]).includes('VF "setpts=(PTS-STARTPTS)/2+STARTPTS"'))
})

test('WO-973 which clips take speed', () => {
	assert.ok(clipSupportsSpeed('folder/clip'))
	assert.ok(clipSupportsSpeed('"a.mp4"'))
	for (const c of ['x.png', 'route://1', 'ndi://a', '[HTML] x', 'shm://r', 'https://a/b.mp4', '']) assert.ok(!clipSupportsSpeed(c), c)
})

test('WO-973 a speed change makes the layer differ (take reloads it)', () => {
	const l = { source: { type: 'media', value: 'c' } }
	assert.strictEqual(layerVisuallyEqual(l, { ...l, speed: 2 }), false)
	assert.strictEqual(layerVisuallyEqual(l, { ...l, speed: 1 }), true)
})
