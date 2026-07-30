'use strict'

/**
 * Offline smoke — WO-395: streaming-channel status carries the configured-output catalog.
 *
 * Companion builds its stream/record dropdowns and presets from `outputs` in
 * GET /api/streaming-channel — ids/labels/enabled/type ONLY. URLs, stream keys and
 * passphrases must never appear (WO-244/261 credential rules).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { buildStreamingChannelStatusPayload } = require('../../src/streaming/streaming-channel-status')

const CTX = {
	config: {
		streamingChannel: { enabled: true, videoSource: 'program_1' },
		streamOutputs: [
			{
				id: 'str_1',
				label: 'YouTube',
				enabled: true,
				type: 'rtmp',
				rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
				streamKey: 'SECRET-KEY',
			},
			{ id: 'str_2', name: 'SRT feed', enabled: false, type: 'srt', srtUrl: 'srt://10.0.0.9:9000', srtPassphrase: 'SECRET-PASS' },
		],
		recordOutputs: [{ id: 'rec_1', label: 'Rec1', enabled: true, source: 'program_3' }],
	},
}

describe('streaming-channel status outputs catalog (WO-395)', () => {
	const payload = buildStreamingChannelStatusPayload(CTX)

	it('lists configured stream and record outputs with id/label/enabled', () => {
		assert.deepEqual(payload.outputs.stream, [
			{ id: 'str_1', label: 'YouTube', enabled: true, type: 'rtmp' },
			{ id: 'str_2', label: 'SRT feed', enabled: false, type: 'srt' },
		])
		assert.deepEqual(payload.outputs.record, [{ id: 'rec_1', label: 'Rec1', enabled: true }])
	})

	it('never leaks credentials or endpoint URLs into the catalog', () => {
		const s = JSON.stringify(payload.outputs)
		assert.doesNotMatch(s, /SECRET|rtmp:\/\/|srt:\/\/|streamKey|Passphrase|ServerUrl/i)
	})

	it('empty/missing output arrays yield empty catalogs (WO-393: zero outputs is valid)', () => {
		const p = buildStreamingChannelStatusPayload({ config: {} })
		assert.deepEqual(p.outputs, { stream: [], record: [] })
	})
})
