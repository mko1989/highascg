'use strict'

/**
 * WO-747 — the first settings save after every boot reloaded every subsystem (AMCP reconnect + routing) whatever
 * changed: the recycle signature started as null. It is now seeded with what boot applied.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const { hashSubsystemReload } = require('../../src/config/config-reload-signature')

test('index.js: the recycle signature is seeded at boot (no null start)', () => {
	const s = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
	assert.ok(s.includes('let subsystemReloadSig = hashSubsystemReload(config)\n'))
	assert.ok(!s.includes('let subsystemReloadSig = null'))
	const seed = s.indexOf('let subsystemReloadSig = hashSubsystemReload(config)')
	const listen = s.indexOf("configManager.on('change'", seed)
	assert.ok(seed > 0 && listen > seed, 'seeded before the change listener is registered')
})

test('hashSubsystemReload: an editor default does not change it, a covered key does', () => {
	const base = { caspar: { host: '127.0.0.1', port: 5250 }, periodic_sync_interval_sec: 10, editorDefaults: { timeline: { loopAlways: false } } }
	const sig = hashSubsystemReload(base)
	assert.equal(hashSubsystemReload({ ...base, editorDefaults: { timeline: { loopAlways: true } } }), sig, 'Loop always: skip')
	assert.notEqual(hashSubsystemReload({ ...base, periodic_sync_interval_sec: 17 }), sig, 'periodic sync: reload')
})
