'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { suggestConnectorsAndDevicesFromLive } = require('../../src/config/device-graph-suggest')

test('caspar_mv_out is not suggested without a multiview destination in config', () => {
	const live = {
		caspar: {
			multiviewEnabled: true,
			multiviewChannel: 3,
			generatedChannelOrder: [{ ch: 3, role: 'multiview' }],
		},
		gpu: { displays: [], connectors: [] },
	}
	const appConfig = {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'dst_pgm_1', label: 'PGM 1', mainScreenIndex: 0, mode: 'pgm_only', caspar: { bus: 'pgm' } },
			],
			edidNotes: '',
		},
	}
	const suggested = suggestConnectorsAndDevicesFromLive(live, appConfig)
	const mv = suggested.connectors.find((c) => c.kind === 'caspar_mv_out')
	assert.equal(mv, undefined)
})

test('caspar_mv_out is suggested when config has a multiview destination', () => {
	const live = {
		caspar: {
			multiviewEnabled: true,
			multiviewChannel: 2,
			generatedChannelOrder: [{ ch: 2, role: 'multiview' }],
		},
		gpu: { displays: [], connectors: [] },
	}
	const appConfig = {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'dst_mv1', label: 'Multiview 1', mainScreenIndex: 0, mode: 'multiview', caspar: { bus: 'pgm' } },
			],
			edidNotes: '',
		},
	}
	const suggested = suggestConnectorsAndDevicesFromLive(live, appConfig)
	const mv = suggested.connectors.find((c) => c.kind === 'caspar_mv_out')
	assert.ok(mv)
	assert.equal(mv.label, 'Multiview channel (virtual)')
})
