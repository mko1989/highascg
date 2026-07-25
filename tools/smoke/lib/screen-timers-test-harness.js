'use strict'

/**
 * Shared test harness for the smoke-wo210-screen-timers*.test.js split. Not itself a test file (no
 * `.test.` in the name) so tools/ci/collect-offline-tests.js never picks it up.
 *
 * Mocks src/utils/persistence for src/engine/screen-timers.js by monkey-patching
 * Module.prototype.require, exactly as the original single-file smoke test did, and exposes the
 * fresh-module-load dance every WO-210 test needs.
 */

const Module = require('module')

function createScreenTimersHarness() {
	const persistence = {
		_storage: {},
		get(key) {
			return this._storage[key] !== undefined ? this._storage[key] : null
		},
		set(key, value) {
			if (value == null) {
				delete this._storage[key]
			} else {
				this._storage[key] = value
			}
		},
		clear() {
			this._storage = {}
		},
	}

	// Override the real persistence with our mock
	const originalRequire = Module.prototype.require
	Module.prototype.require = function (id) {
		if (id === '../utils/persistence') {
			return persistence
		}
		return originalRequire.apply(this, arguments)
	}

	/** Drop the cached module and require it fresh, without touching persistence. */
	function requireFresh() {
		delete require.cache[require.resolve('../../../src/engine/screen-timers')]
		return require('../../../src/engine/screen-timers')
	}

	/** Clear persistence, require the module fresh, and load its registry. */
	function reset() {
		persistence.clear()
		const screenTimers = requireFresh()
		screenTimers.loadRegistry()
		return screenTimers
	}

	return { persistence, requireFresh, reset }
}

module.exports = { createScreenTimersHarness }
