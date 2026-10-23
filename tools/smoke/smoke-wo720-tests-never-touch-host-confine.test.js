'use strict'

/**
 * WO-720 — offline smokes that POST settings reach syncOperatorPointerConfine → stopPointerConfine, whose
 * `pkill -f confine-pointer-barriers.py` killed the LIVE operator's barrier daemon every time `npm run test:ci` ran on
 * the playout box (caught with a logging pkill shim: 24 calls from 5 smokes). Under `node --test` the module must
 * treat itself as a sandbox and run nothing on the host.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const cp = require('child_process')

const spawned = []
const realExecFile = cp.execFile
const realSpawn = cp.spawn
cp.execFile = (file, args, ...rest) => {
	spawned.push([file, ...(args || [])].join(' '))
	const cb = rest.find((a) => typeof a === 'function')
	if (cb) cb(new Error('blocked by test'))
	return { on() {}, kill() {} }
}
cp.spawn = (file, args) => {
	spawned.push([file, ...(args || [])].join(' '))
	return { on() {}, unref() {}, kill() {}, pid: 0 }
}
const confine = require('../../src/system/pointer-confine')
cp.execFile = realExecFile
cp.spawn = realSpawn

test('stop / start / sync run no process at all inside a test process', async () => {
	assert.ok(process.env.NODE_TEST_CONTEXT, 'precondition: running under node --test')
	const desired = { casparServer: { screen_3_operator_monitor: true } }
	confine.stopPointerConfine()
	const started = await confine.startPointerConfine(desired, { log: () => {} })
	const synced = confine.syncOperatorPointerConfine({}, { log: () => {} })
	await new Promise((r) => setTimeout(r, 20))
	assert.deepEqual(spawned, [], 'no pkill / python / unclutter from a test')
	assert.equal(started.ok, false)
	assert.match(started.reason, /sandbox/)
	assert.equal(synced?.enabled, false)
})
