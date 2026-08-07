'use strict'
/**
 * WO-49 — snapshot validation + dry-run API (no running server).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const ds = require('../../src/config/device-snapshot')
const routes = require('../../src/api/routes-device-snapshot')

function cloneCfg() {
	return JSON.parse(JSON.stringify(defaults))
}

test('extractPayloadFromConfig + parseAndValidate round-trip', () => {
	const cfg = cloneCfg()
	const payload = ds.extractPayloadFromConfig(cfg)
	const snap = {
		kind: ds.DEVICE_SNAPSHOT_KIND,
		version: ds.DEVICE_SNAPSHOT_VERSION,
		payload,
	}
	const p = ds.parseAndValidateDeviceSnapshot(snap)
	assert.equal(p.ok, true)
})

test('POST /api/device-snapshot/apply dryRun reports diffs', async () => {
	const cfg = cloneCfg()
	cfg.screen_1_system_id = 'SCREEN_A'
	const payload = ds.extractPayloadFromConfig(cfg)
	payload.settingsPatches.screen_1_system_id = 'SCREEN_B'
	const snap = {
		kind: ds.DEVICE_SNAPSHOT_KIND,
		version: ds.DEVICE_SNAPSHOT_VERSION,
		payload,
	}
	const ctx = {
		config: cfg,
		configManager: {
			get: () => cfg,
			save: () => {},
		},
	}
	const res = await routes.handlePost(JSON.stringify({ snapshot: snap, mode: 'full', dryRun: true }), ctx)
	assert.equal(res.status, 200)
	const body = JSON.parse(res.body)
	assert.equal(body.ok, true)
	assert.equal(body.dryRun, true)
	assert.ok(Array.isArray(body.changedKeys))
	assert.ok(body.changedKeys.some((k) => String(k).includes('screen_1_system_id')))
})

test('GET schema returns JSON', () => {
	const r = routes.handleGet('/api/device-snapshot/schema', { config: defaults })
	assert.equal(r.status, 200)
	const j = JSON.parse(r.body)
	assert.equal(j.title, 'HighAsCG device snapshot')
})
