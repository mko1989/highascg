'use strict'
/**
 * WO-690 — Previs + Tracking are on by default: a factory / stick reset (eggs produce) left the Godot Previs tab without
 * its fixture engine ("the programmer is gone"). Opt-out stays: features flag false, env 0, or a plugin-store entry.
 */
const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const pluginManager = require('../../src/plugins/plugin-manager')

const ENV = ['HIGHASCG_PREVIS', 'HIGHASCG_TRACKING']
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))

function enabled(config, id) {
	return pluginManager.listPlugins(config).find((p) => p.id === id).enabled
}

describe('WO-690 previs / tracking default on', () => {
	afterEach(() => {
		for (const k of ENV) {
			if (saved[k] === undefined) delete process.env[k]
			else process.env[k] = saved[k]
		}
	})

	it('a factory config (no flags, empty plugin store) enables both', () => {
		for (const k of ENV) delete process.env[k]
		const cfg = { plugins: { entries: {} } }
		assert.equal(enabled(cfg, 'previs'), true)
		assert.equal(enabled(cfg, 'tracking'), true)
		assert.equal(enabled(cfg, 'autofollow'), false)
	})

	it('features flags false opt out', () => {
		for (const k of ENV) delete process.env[k]
		const cfg = { features: { previs3d: false, tracking: false } }
		assert.equal(enabled(cfg, 'previs'), false)
		assert.equal(enabled(cfg, 'tracking'), false)
	})

	it('env 0 opts out, a plugin-store entry wins over both', () => {
		process.env.HIGHASCG_PREVIS = '0'
		process.env.HIGHASCG_TRACKING = '0'
		assert.equal(enabled({}, 'previs'), false)
		const cfg = { plugins: { entries: { tracking: { id: 'tracking', enabled: true } } } }
		assert.equal(enabled(cfg, 'tracking'), true)
		delete process.env.HIGHASCG_TRACKING
		const off = { plugins: { entries: { tracking: { id: 'tracking', enabled: false } } } }
		assert.equal(enabled(off, 'tracking'), false)
	})
})
