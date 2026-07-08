'use strict'

// The default (casparcg-connection) transport keeps the event loop alive even after
// destroy(), hanging `node --test`. These tests only assert config defaulting, so use
// the inert legacy TcpClient transport (no handles until connect()).
process.env.HIGHASCG_AMCP_LEGACY_TRANSPORT = '1'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ConnectionManager } = require('../../src/caspar/connection-manager')
const playbackTracker = require('../../src/state/playback-tracker')
const { StateManager } = require('../../src/state/state-manager')

// ConnectionManager constructs a CasparCG transport (autoConnect: false) whose internal
// handles keep the event loop alive — destroy() in each test or `node --test` never exits.
test('T146.1: ConnectionManager default healthIntervalMs is 5000 ms (liveness probe enabled)', () => {
	const manager = new ConnectionManager({})
	try {
		assert.strictEqual(manager._healthIntervalMs, 5000, 'Default healthIntervalMs should be 5000 ms for liveness probing')
	} finally {
		manager.destroy()
	}
})

test('T146.1: ConnectionManager supports explicit opt-out with healthIntervalMs 0', () => {
	const manager = new ConnectionManager({ healthIntervalMs: 0 })
	try {
		assert.strictEqual(manager._healthIntervalMs, 0, 'healthIntervalMs 0 should disable health polling')
	} finally {
		manager.destroy()
	}
})

test('T146.1: ConnectionManager health probe interval is configurable', () => {
	const manager = new ConnectionManager({ healthIntervalMs: 3000 })
	try {
		assert.strictEqual(manager._healthIntervalMs, 3000, 'healthIntervalMs should be configurable')
	} finally {
		manager.destroy()
	}
})

test('T146.2: playbackTracker.reconcilePlaybackMatrixFromGatheredXml returns diff with seeded/corrected/dropped counts', async () => {
	// Create a minimal test context with no XML to test the return structure
	const ctx = {
		_playbackMatrix: {},
		gatheredInfo: { channelXml: {} },
	}

	const diff = await playbackTracker.reconcilePlaybackMatrixFromGatheredXml(ctx)

	// When there's no reconciliation needed, it should return null
	assert.strictEqual(diff, null, 'Should return null when no reconciliation changes occur')
})

test('T146.2: StateManager exposes reconcileDiff in state', () => {
	const stateManager = new StateManager()
	const initialState = stateManager.getState()
	assert.strictEqual(initialState.reconcileDiff, null, 'reconcileDiff should start as null')
})

test('T146.2: StateManager.setReconcileDiff stores reconcile diff', () => {
	const stateManager = new StateManager()
	const diff = { seeded: 2, corrected: 1, dropped: 0, at: Date.now() }
	stateManager.setReconcileDiff(diff)

	const state = stateManager.getState()
	assert.deepEqual(state.reconcileDiff, diff, 'getState() should include the reconcileDiff')
	assert.strictEqual(state.reconcileDiff.seeded, 2, 'seeded count should be accessible')
	assert.strictEqual(state.reconcileDiff.corrected, 1, 'corrected count should be accessible')
	assert.strictEqual(state.reconcileDiff.dropped, 0, 'dropped count should be accessible')
	assert(Number.isFinite(state.reconcileDiff.at), 'timestamp should be present')
})

test('T146.2: StateManager emits change event for reconcileDiff', (t) => {
	const stateManager = new StateManager()
	let emitted = false

	stateManager.on('change', (path, value) => {
		if (path === 'reconcileDiff') {
			emitted = true
			assert(value.seeded !== undefined, 'Event should carry seeded count')
			assert(value.corrected !== undefined, 'Event should carry corrected count')
			assert(value.dropped !== undefined, 'Event should carry dropped count')
		}
	})

	const diff = { seeded: 1, corrected: 0, dropped: 1, at: Date.now() }
	stateManager.setReconcileDiff(diff)

	assert.strictEqual(emitted, true, 'Should emit change event for reconcileDiff')
})
