'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	evaluateAmcpWatchdogTick,
	createAmcpWatchdogState,
} = require('../../src/bootstrap/caspar-amcp-watchdog')

test('watchdog: skips during full apply', async () => {
	const state = createAmcpWatchdogState()
	state.downSince = 1000
	const res = await evaluateAmcpWatchdogTick(
		{ _fullApplyInProgress: true, casparConnection: {} },
		state,
		200_000
	)
	assert.equal(res.action, 'skip')
	assert.equal(state.downSince, null)
})

test('watchdog: clears state when tcp connected', async () => {
	const state = createAmcpWatchdogState()
	state.downSince = 1000
	const res = await evaluateAmcpWatchdogTick(
		{ casparConnection: {} },
		state,
		200_000,
		{ isTcpConnected: () => true }
	)
	assert.equal(res.action, 'ok')
	assert.equal(state.downSince, null)
})

test('watchdog: warns then kills hung main process when port stays down', async () => {
	const state = createAmcpWatchdogState()
	state.downSince = 0
	const logs = []
	let killed = false
	const ctx = { casparConnection: {}, config: {} }
	const opts = {
		warnMs: 30_000,
		recoverMs: 120_000,
		recoveryCooldownMs: 60_000,
		log: (_lvl, msg) => logs.push(msg),
		isTcpConnected: () => false,
		isPortListening: async () => false,
		isMainRunning: async () => true,
		killMain: async () => {
			killed = true
			return true
		},
		nudgeReconnect: () => {},
	}

	let res = await evaluateAmcpWatchdogTick(ctx, state, 40_000, opts)
	assert.equal(res.action, 'warn')
	assert.match(logs.at(-1), /AMCP down for 40s/)

	res = await evaluateAmcpWatchdogTick(ctx, state, 130_000, opts)
	assert.equal(res.action, 'kill')
	assert.equal(killed, true)
	assert.match(logs.at(-1), /killing hung process/)
})

test('watchdog: nudges client when port is up but tcp client down', async () => {
	const state = createAmcpWatchdogState()
	state.downSince = 0
	let nudged = 0
	const res = await evaluateAmcpWatchdogTick(
		{ casparConnection: {}, config: {} },
		state,
		20_000,
		{
			clientNudgeMs: 15_000,
			isTcpConnected: () => false,
			isPortListening: async () => true,
			isMainRunning: async () => true,
			nudgeReconnect: () => {
				nudged += 1
			},
		}
	)
	assert.equal(res.action, 'nudge')
	assert.equal(nudged, 1)
})
