'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('planned-channel-map', () => {
	it('detects pending apply and reconciles host channels', async () => {
		const {
			casparHostChannelsPendingApply,
			effectiveChannelMap,
			reconcileExtraLiveSourceChannel,
			reconcileHostChannelDestination,
		} = await import('../../client/lib/planned-channel-map.js')

		const planned = { decklinkCount: 2, decklinkInputChannels: [5, 6], inputChannels: [] }
		const live = { decklinkCount: 1, decklinkInputChannels: [5], inputChannels: [] }
		assert.equal(casparHostChannelsPendingApply(planned, live), true)
		assert.equal(casparHostChannelsPendingApply(planned, planned), false)

		const pendingCm = effectiveChannelMap({ settings: { channelMap: planned }, liveChannelMap: live })
		assert.deepEqual(pendingCm.decklinkInputChannels, [5, 6])

		const synced = { decklinkCount: 1, decklinkInputChannels: [5], inputChannels: [] }
		const liveCm = effectiveChannelMap({ settings: { channelMap: synced }, liveChannelMap: synced })
		assert.equal(liveCm, synced)

		const cm = {
			decklinkInputChannels: [8],
			inputChannels: [{ kind: 'decklink', slot: 1, channel: 8, layer: 1, route: 'route://8-1' }],
		}
		const dest = reconcileHostChannelDestination(
			{ id: 'host_decklink_input_1', hostRole: 'decklink_input', casparChannel: 5, inputSlot: 1 },
			cm,
		)
		assert.equal(dest.casparChannel, 8)

		const row = reconcileExtraLiveSourceChannel(
			{ routeType: 'decklink', decklinkSlot: 2, inputsChannel: 5, value: 'route://5-2' },
			{
				decklinkInputChannels: [9],
				inputChannels: [{ kind: 'decklink', slot: 2, channel: 9, layer: 2, route: 'route://9-2' }],
			},
		)
		assert.equal(row.inputsChannel, 9)
		assert.equal(row.value, 'route://9-2')
	})
})
