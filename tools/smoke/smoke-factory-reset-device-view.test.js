'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { suggestConnectorsAndDevicesFromLive } = require('../../src/config/device-graph-suggest')
const { buildGeneratedChannelOrder } = require('../../src/api/device-view-snapshot')
const { setupInputsChannel } = require('../../src/config/routing-setup')
const defaults = require('../../src/config/defaults')

describe('factory reset device view', () => {
	it('does not suggest decklink input host destinations when count is 0', () => {
		const live = {
			decklink: {
				inputs: [
					{ slot: 4, device: 4, ioDirection: 'in', hostChannel: 5 },
				],
			},
			caspar: {
				generatedChannelOrder: [{ ch: 5, role: 'decklink_input', slot: 4 }],
			},
		}
		const appConfig = {
			casparServer: {
				...defaults.casparServer,
				decklink_input_count: 0,
			},
			deviceGraph: defaults.deviceGraph,
		}
		const sug = suggestConnectorsAndDevicesFromLive(live, appConfig)
		const hostIds = sug.connectors
			.filter((c) => c.kind === 'destination_in')
			.map((c) => String(c.externalRef || ''))
		assert.equal(hostIds.some((id) => id.startsWith('host_decklink')), false)
	})

	it('buildGeneratedChannelOrder omits decklink inputs when count is 0', () => {
		const ctx = {
			config: {
				...defaults,
				casparServer: {
					...defaults.casparServer,
					decklink_input_count: 0,
				},
			},
		}
		const order = buildGeneratedChannelOrder(ctx)
		assert.equal(order.some((r) => r.role === 'decklink_input'), false)
	})

	it('setupInputsChannel clears stale decklink status when inputs disabled', async () => {
		const self = {
			config: {
				...defaults,
				casparServer: {
					...defaults.casparServer,
					decklink_input_count: 0,
				},
			},
			amcp: { raw: async () => ({}) },
			log: () => {},
			_decklinkInputsStatus: {
				enabled: true,
				channels: [5],
				requestedSlots: 1,
			},
		}
		await setupInputsChannel(self)
		assert.equal(self._decklinkInputsStatus.enabled, false)
		assert.equal(self._decklinkInputsStatus.reason, 'decklink_inputs_disabled')
	})

	it('resetGpuPhysicalTopologyForFactoryReset clears operator-saved marker', () => {
		const { resetGpuPhysicalTopologyForFactoryReset } = require('../../src/bootstrap/gpu-topology-factory-reset')
		const config = {
			gpuPhysicalTopologyOperatorSaved: true,
			gpuPhysicalTopology: [
				{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-99', dpB: 'DP-98', connectorNumber: 0, location: 0 },
			],
		}
		const cm = {
			get: () => ({ ...config }),
			save: (c) => {
				Object.assign(config, c)
				return true
			},
		}
		assert.equal(resetGpuPhysicalTopologyForFactoryReset(cm, () => {}), true)
		assert.equal(config.gpuPhysicalTopologyOperatorSaved, false)
		assert.ok(Array.isArray(config.gpuPhysicalTopology))
		assert.notEqual(config.gpuPhysicalTopology[0]?.dpA, 'DP-99')
	})

	it('clearPersistedMultiviewLayout removes stale multiview from persistence and ctx', () => {
		const { clearPersistedMultiviewLayout } = require('../../src/state/clear-multiview-layout')
		const store = {
			multiviewLayout: { layout: [{ id: 'pgm1' }] },
			multiviewLayout_2: { layout: [{ id: 'old' }] },
		}
		const persistence = {
			getAll: () => ({ ...store }),
			remove(k) {
				delete store[k]
			},
		}
		const ctx = {
			persistence,
			_multiviewLayout: { layout: [{ id: 'pgm1' }] },
			_multiviewLayouts: { 1: { layout: [] }, 2: { layout: [] } },
		}
		clearPersistedMultiviewLayout(ctx)
		assert.equal(store.multiviewLayout, undefined)
		assert.equal(store.multiviewLayout_2, undefined)
		assert.equal(ctx._multiviewLayout, null)
		assert.deepEqual(ctx._multiviewLayouts, {})
	})
})
