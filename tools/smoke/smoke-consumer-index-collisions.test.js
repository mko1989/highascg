'use strict'

/**
 * Caspar addresses a consumer by `<channel>-<index>`, and ADD at an occupied index REPLACES what is
 * there. So two subsystems sharing an index is not a style problem — whichever runs second evicts
 * the first. Found 2026-07-20: the meter-null consumer (added to EVERY channel on connect) shared
 * index 96 with the streaming RECORD consumer, and DMX file sampling shared 97 with the RTMP
 * consumer. A record started before a Caspar reconnect would have been silently displaced.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const INDICES = {
	METER_NULL_CONSUMER_INDEX: require('../../src/audio/meter-null-consumer').METER_NULL_CONSUMER_INDEX,
	DMX_FILE_CONSUMER_INDEX: require('../../src/sampling/dmx-sampling-ingress').DMX_FILE_CONSUMER_INDEX,
	STREAMING_RECORD_CONSUMER_INDEX:
		require('../../src/api/routes-streaming-channel-shared').STREAMING_RECORD_CONSUMER_INDEX,
	STREAMING_RTMP_CONSUMER_INDEX:
		require('../../src/api/routes-streaming-channel-shared').STREAMING_RTMP_CONSUMER_INDEX,
	COMPOSE_FILE_CONSUMER_INDEX: require('../../src/preview/compose-preview-consumer').COMPOSE_FILE_CONSUMER_INDEX,
	V4L2_BRIDGE_CONSUMER_INDEX: require('../../src/virtual-output/v4l2-bridge-consumer').V4L2_BRIDGE_CONSUMER_INDEX,
	V4L2_BRIDGE_AUDIO_CONSUMER_INDEX:
		require('../../src/virtual-output/v4l2-bridge-audio').V4L2_BRIDGE_AUDIO_CONSUMER_INDEX,
}

describe('consumer indices are unique per subsystem', () => {
	it('every index is a number', () => {
		for (const [name, v] of Object.entries(INDICES)) {
			assert.equal(typeof v, 'number', `${name} must export a numeric index`)
			assert.ok(Number.isInteger(v) && v > 0, `${name} must be a positive integer, got ${v}`)
		}
	})

	it('no two subsystems share an index', () => {
		const seen = new Map()
		const clashes = []
		for (const [name, v] of Object.entries(INDICES)) {
			if (seen.has(v)) clashes.push(`${seen.get(v)} and ${name} both use ${v}`)
			else seen.set(v, name)
		}
		assert.deepEqual(clashes, [], 'an ADD at an occupied index evicts the existing consumer')
	})

	it('the two historical collisions specifically stay resolved', () => {
		assert.notEqual(
			INDICES.METER_NULL_CONSUMER_INDEX,
			INDICES.STREAMING_RECORD_CONSUMER_INDEX,
			'the meter consumer is added to every channel and would displace a running record',
		)
		assert.notEqual(
			INDICES.DMX_FILE_CONSUMER_INDEX,
			INDICES.STREAMING_RTMP_CONSUMER_INDEX,
			'DMX sampling would displace a running RTMP stream',
		)
	})
})
