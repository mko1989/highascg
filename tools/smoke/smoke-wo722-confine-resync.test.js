'use strict'

/**
 * WO-722 — pointer confine lost after a New project (journal 24.10 07:55): the reload's sync ran on a config without
 * the operator cable (no rect → "not started", and its stop killed the running barrier daemon); the two project loads
 * that brought the cable logged "subsystem recycle skipped", and that path never looked at confine again.
 * Now: a skipped recycle re-syncs when the verdict changed or the last start failed, and a no-rect start retries.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const confine = require('../../src/system/pointer-confine')
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const WANT = { desired: true, reason: 'operator_monitor_port_3' }
const OFF = { desired: false, reason: 'no_operator_monitor_port' }

test('confineResyncNeeded: the 07:55 sequence, and the saves that must stay X-free', () => {
	const need = confine.confineResyncNeeded
	assert.equal(need(WANT, 'operator_monitor_port_3', true), true, 'reload sync failed (no rect) → the next project load re-syncs')
	assert.equal(need(WANT, 'operator_monitor_port_3', false), false, 'confine running: an unrelated save does nothing')
	assert.equal(need(OFF, '', false), false, 'not wanted and not wanted before: nothing')
	assert.equal(need(OFF, '', true), false, 'not wanted: a failed start before does not matter')
	assert.equal(need(WANT, '', false), true, 'became wanted → sync')
	assert.equal(need(OFF, 'operator_monitor_port_3', false), true, 'no longer wanted → sync (it stops)')
	assert.equal(need({ desired: true, reason: 'operator_monitor_port_2' }, 'operator_monitor_port_3', false), true, 'another port → sync')
	assert.equal(need(WANT, null, false), true, 'never synced (no boot sync) → sync')
})

test('index.js: the recycle-skipped path re-syncs confine', () => {
	const s = src('index.js')
	const skip = s.indexOf("subsystem recycle skipped (Caspar / OSC / streaming / DMX signature unchanged).')")
	const ret = s.indexOf('return', skip)
	const hook = s.indexOf("require('./src/system/pointer-confine').resyncPointerConfineIfNeeded(config, { log: (level, msg) => appCtx.log(level, msg) }) // WO-722", skip)
	assert.ok(skip > 0 && hook > skip && hook < ret, 'resync sits between the skip log and its return')
})

test('pointer-confine.js: a no-rect start retries, bounded', () => {
	const s = src('src/system/pointer-confine.js')
	assert.match(s, /if \(r\.reason === 'no_operator_monitor' && left > 0\)/)
	assert.match(s, /syncOperatorPointerConfine\(config, \{ \.\.\.opts, noRectRetriesLeft: left - 1 \}\)/)
	assert.match(s, /const NO_RECT_RETRIES = 3\n/)
	assert.match(s, /lastSyncFailed = !r\.ok/)
})

test('inside a test process the resync touches nothing (WO-720)', () => {
	assert.equal(confine.resyncPointerConfineIfNeeded({ casparServer: { screen_3_operator_monitor: true } }), false)
})
