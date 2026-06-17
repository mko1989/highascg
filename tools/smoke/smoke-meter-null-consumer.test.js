'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	meterNullStreamUri,
	METER_NULL_CONSUMER_INDEX,
	METER_UDP_PORT_BASE,
	isMeterNullConsumerEnabled,
	listMeterNullTargetChannels,
} = require('../../src/audio/meter-null-consumer')
const { getChannelMap } = require('../../src/config/routing-map')

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

	it('lists all channels from INFO CONFIG when present', () => {
		const xml = `<configuration><channels>
			<channel><video-mode>1080p5000</video-mode></channel>
			<channel><video-mode>1080p5000</video-mode></channel>
			<channel><video-mode>PAL</video-mode></channel>
		</channels></configuration>`
		assert.deepEqual(listMeterNullTargetChannels({}, xml), [1, 2, 3])
	})

	it('falls back to routing map channel indices', () => {
		const cfg = {
			screen_count: 2,
			multiview_enabled: true,
			live_audio_input_count: 1,
			live_audio_input_1_device: 'hw:0,0',
			casparServer: { screen_count: 2, multiview_enabled: true, live_audio_input_count: 1, live_audio_input_1_device: 'hw:0,0' },
		}
		const map = getChannelMap(cfg)
		const channels = listMeterNullTargetChannels(cfg, '')
		assert.ok(channels.includes(map.programCh(1)))
		assert.ok(channels.includes(map.programCh(2)))
		assert.ok(channels.includes(map.liveAudioInputChannels[0]))
	})
})
