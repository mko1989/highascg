'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	meterNullStreamUri,
	METER_NULL_CONSUMER_INDEX,
	METER_UDP_PORT_BASE,
	isMeterNullConsumerEnabled,
} = require('../../src/audio/meter-null-consumer')

describe('meter-null-consumer', () => {
	it('builds unique discard UDP URI per channel', () => {
		const u5 = meterNullStreamUri(5)
		assert.match(u5, /^udp:\/\/127\.0\.0\.1:52005\?localport=62005$/)
		assert.notEqual(meterNullStreamUri(6), u5)
	})

	it('uses dedicated consumer index below DMX', () => {
		assert.equal(METER_NULL_CONSUMER_INDEX, 96)
		assert.ok(METER_UDP_PORT_BASE >= 52000)
	})

	it('defaults enabled unless explicitly off', () => {
		assert.equal(isMeterNullConsumerEnabled({}), true)
		assert.equal(isMeterNullConsumerEnabled({ casparServer: {} }), true)
		assert.equal(isMeterNullConsumerEnabled({ casparServer: { live_audio_meter_null_consumer: false } }), false)
	})
})
