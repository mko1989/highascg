'use strict'

/** WO-797 — the previs fixtures are decoded only while a client looks: `tracking:fixtures_watch {on}` from the views
 * that draw the rig; the tick decodes with ≥ 1 watcher and sends to the watchers alone. */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { createFixturesWatch, MAX_BUFFERED } = require('../../src/tracking/fixtures-watch')

function sock() {
	const ws = new EventEmitter()
	ws.readyState = 1
	ws.bufferedAmount = 0
	ws.got = []
	ws.send = (m) => ws.got.push(JSON.parse(m))
	return ws
}

test('nobody watching: nothing is decoded or sent', () => {
	const w = createFixturesWatch()
	let decodes = 0
	for (let i = 0; i < 30; i++) assert.equal(w.tick(() => ++decodes && { fixtures: [] }), 0)
	assert.equal(decodes, 0, 'visual() never ran')
})

test('watchers get each change once; a newcomer gets the current state at once', () => {
	const w = createFixturesWatch()
	const a = sock()
	const b = sock()
	let level = 0
	const visual = () => ({ fixtures: [{ id: 'mvr-1', axes: {}, beams: { Beam: { i: level } } }] })
	assert.equal(w.handle({ type: 'tracking:fixtures_watch', data: { on: true } }, a), true)
	assert.equal(w.tick(visual), 1)
	assert.deepEqual(a.got.at(-1), { type: 'tracking:fixtures', data: visual() })
	assert.equal(w.tick(visual), 0, 'unchanged: nothing sent')
	w.handle({ type: 'tracking:fixtures_watch', data: { on: true } }, b)
	assert.equal(w.tick(visual), 1, 'only the newcomer')
	assert.equal(b.got.length, 1)
	level = 1
	assert.equal(w.tick(visual), 2)
	assert.equal(a.got.length, 2)
	assert.equal(a.got.at(-1).data.fixtures[0].beams.Beam.i, 1)
	w.reset()
	assert.equal(w.tick(visual), 2, 'reset (new follow service): everyone gets a fresh snapshot')
	assert.equal(w.handle({ type: 'tracking:marker', data: {} }, a), false, 'other types are not ours')
})

test('off, close and a dead socket stop the watch; a backed-up socket skips a frame and catches up', () => {
	const w = createFixturesWatch()
	const a = sock()
	const b = sock()
	const on = { type: 'tracking:fixtures_watch', data: { on: true } }
	w.handle(on, a)
	w.handle(on, a)
	w.handle(on, b)
	assert.equal(w.count(), 2)
	assert.equal(a.listenerCount('close'), 1, 'one close hook however often it says on')
	b.bufferedAmount = MAX_BUFFERED + 1
	let n = 0
	const visual = () => ({ fixtures: [{ id: 'x', n }] })
	assert.equal(w.tick(visual), 1, 'b is backed up')
	assert.equal(b.got.length, 0)
	b.bufferedAmount = 0
	assert.equal(w.tick(visual), 1, 'b catches up with the same frame')
	assert.equal(b.got.length, 1)
	w.handle({ type: 'tracking:fixtures_watch', data: { on: false } }, a)
	assert.equal(w.count(), 1)
	b.emit('close')
	assert.equal(w.count(), 0)
	let decodes = 0
	assert.equal(w.tick(() => ++decodes && visual()), 0)
	assert.equal(decodes, 0)
	const c = sock()
	w.handle(on, c)
	c.readyState = 3
	n++
	assert.equal(w.tick(visual), 0)
	assert.equal(w.count(), 0, 'a closed socket is dropped')
})

test('the tracking module routes the watch and its tick decodes through it (no broadcast to every client)', () => {
	const tracking = require('../../src/tracking/register')
	const ws = sock()
	assert.equal(tracking.handleWs({ type: 'tracking:fixtures_watch', data: { on: true } }, { ws }), true)
	const src = fs.readFileSync(path.join(__dirname, '../../src/tracking/register.js'), 'utf8')
	assert.match(src, /function fixturesTick\(\) \{\n\tif \(_follow\?\.visual\) fixturesWatch\.tick\(_follow\.visual\)\n\}/)
	assert.doesNotMatch(src, /_wsBroadcast\(\s*'tracking:fixtures'|FIXTURES_EVENT/)
	ws.emit('close')
})

test('the Godot rig holds the watch while its viewport renders', () => {
	const gd = (p) => fs.readFileSync(path.join(__dirname, '../../godot/client', p), 'utf8')
	assert.match(gd('features/previs/fixtures/fixtures_3d.gd'), /_watch = preload\("res:\/\/features\/previs\/fixtures\/fixtures_watch\.gd"\)\.new\(\)/)
	assert.match(gd('features/previs/fixtures/fixtures_3d.gd'), /if c != _watch:\n\t\t\tc\.queue_free\(\)/, 'a rebuild keeps it')
	assert.match(gd('features/previs/fixtures/fixtures_watch.gd'), /const TYPE := "tracking:fixtures_watch"/)
	assert.match(gd('features/previs/fixtures/fixtures_watch.gd'), /Ws\.watch\(TYPE, self, on\)/)
	assert.match(gd('core/ws.gd'), /for t in _watches:/, 'said again after a reconnect')
})
