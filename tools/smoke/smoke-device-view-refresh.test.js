'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('WO-82 device-view refresh helpers', () => {
	it('mergeDeviceViewMutation merges graph and destinations', async () => {
		const { mergeDeviceViewMutation } = await import('../../client/lib/device-view-refresh.js')
		const payload = { graph: { nodes: [] }, screenDestinations: { a: 1 } }
		const settings = { screenDestinations: { a: 1 } }
		const res = {
			graph: { nodes: [{ id: 'n1' }] },
			screenDestinations: { a: 2, b: 3 },
			audioOutputs: [{ id: 'ao1' }],
		}
		const merged = mergeDeviceViewMutation(payload, res, settings)
		assert.deepEqual(merged.graph, res.graph)
		assert.deepEqual(merged.screenDestinations, res.screenDestinations)
		assert.deepEqual(settings.screenDestinations, res.screenDestinations)
		assert.deepEqual(merged.audioOutputs, res.audioOutputs)
	})

	it('mergeDeviceViewMutation is a no-op when res missing', async () => {
		const { mergeDeviceViewMutation } = await import('../../client/lib/device-view-refresh.js')
		const payload = { graph: { nodes: [] } }
		assert.equal(mergeDeviceViewMutation(payload, null), payload)
	})

	it('normalizeRefreshMode accepts string and object opts', async () => {
		const { normalizeRefreshMode } = await import('../../client/lib/device-view-refresh.js')
		assert.equal(normalizeRefreshMode(), 'full')
		assert.equal(normalizeRefreshMode('none'), 'none')
		assert.equal(normalizeRefreshMode({ refresh: 'settings' }), 'settings')
	})
})
