'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { suggestConnectorsAndDevicesFromLive } = require('../../src/config/device-graph-suggest')

describe('device-graph-suggest host destinations', () => {
	it('synthesizes dst_in connectors for webpage and NDI host channels', () => {
		const config = {
			extraLiveSources: [
				{
					type: 'browser',
					routeType: 'webpage_host',
					value: 'route://20-1',
					hostChannel: 20,
					hostLayer: 1,
					sourceId: 'webpage_click_test',
					label: 'Click test',
					playArg: 'interactive_click_test',
				},
				{
					type: 'ndi',
					routeType: 'ndi_host',
					value: 'route://21-1',
					hostChannel: 21,
					hostLayer: 1,
					sourceId: 'ndi_remote',
					label: 'Remote NDI',
					ndiName: 'ndi://Remote',
				},
			],
		}
		const live = {
			caspar: {
				generatedChannelOrder: [
					{ ch: 20, role: 'webpage_host', sourceId: 'webpage_click_test', label: 'Click test' },
					{ ch: 21, role: 'ndi_host', sourceId: 'ndi_remote', label: 'Remote NDI' },
				],
			},
		}
		const { connectors } = suggestConnectorsAndDevicesFromLive(live, config)
		const ids = connectors.map((c) => c.id)
		assert.ok(ids.includes('dst_in_host_webpage_webpage_click_test'))
		assert.ok(ids.includes('dst_in_host_ndi_ndi_remote'))
		const webpage = connectors.find((c) => c.id === 'dst_in_host_webpage_webpage_click_test')
		assert.equal(webpage?.kind, 'destination_in')
		assert.equal(webpage?.caspar?.hostRole, 'webpage_host')
		assert.equal(webpage?.caspar?.hostChannel, 20)
	})
})
