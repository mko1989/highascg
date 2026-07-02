'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

test('computeWsReconnectDelay grows with attempt and caps at maxInterval', async () => {
	const { computeWsReconnectDelay } = await import('../../client/lib/ws-client.js')
	const d1 = computeWsReconnectDelay(1, { baseInterval: 1000, maxInterval: 30000, jitterMax: 0 })
	const d5 = computeWsReconnectDelay(5, { baseInterval: 1000, maxInterval: 30000, jitterMax: 0 })
	const d20 = computeWsReconnectDelay(20, { baseInterval: 1000, maxInterval: 30000, jitterMax: 0 })
	assert.equal(d1, 1000)
	assert.equal(d5, 16000)
	assert.equal(d20, 30000)
})

test('StateStore.setState clones nested channelMap (no shared refs)', async () => {
	const { default: StateStore } = await import('../../client/lib/state-store.js')
	const store = new StateStore()
	const payload = { channelMap: { multiviewCh: 3, nested: { a: 1 } }, scene: { live: { 1: {} } } }
	store.setState(payload)
	payload.channelMap.multiviewCh = 99
	payload.channelMap.nested.a = 2
	assert.equal(store.getState().channelMap.multiviewCh, 3)
	assert.equal(store.getState().channelMap.nested.a, 1)
})
