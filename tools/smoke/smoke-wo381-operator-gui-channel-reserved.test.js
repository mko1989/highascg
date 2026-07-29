'use strict'

/**
 * WO-381: the Operator GUI's Caspar channel must be reserved.
 *
 * Owner 2026-07-29: "when i was adding a host channel it first was created as ch4 which was already
 * occupied by operator gui." routing-map.js allocates operator_gui a real channel right after
 * multiview, but usedCasparChannels() never counted it, so suggestNextHostChannel handed the very
 * same number to the next NDI/webpage/browser host source.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { getChannelMap } = require('../../src/config/routing')
const { suggestNextHostChannel } = require('../../src/config/host-live-sources')
const { buildGeneratedChannelOrder } = require('../../src/api/device-view-snapshot')

/** The live box's topology at the time of the report: PGM/PRV screen 1, PGM-only screen 2, GUI. */
function configWithOperatorGui() {
	return {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'dst_operator_gui', label: 'Operator GUI', mainScreenIndex: 0, mode: 'operator_gui', width: 1920, height: 1080, fps: 50 },
				{ id: 'dst_a', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000' },
				{ id: 'dst_b', label: 'PGM 2', mainScreenIndex: 1, mode: 'pgm_only', videoMode: '1080p5000' },
			],
		},
	}
}

describe('WO-381 operator GUI channel is reserved', () => {
	it('allocates the operator_gui channel and never offers it to a host live source', () => {
		const config = configWithOperatorGui()
		const map = getChannelMap(config)

		// The topology that produced the report: pgm 1, prv 2, pgm 3, operator GUI 4.
		assert.deepEqual(map.programChannels, [1, 3])
		assert.equal(map.operatorGuiCh, 4)
		assert.deepEqual(map.operatorGuiChannels, [4])

		// Before the fix this returned 4 — the Operator GUI's own channel.
		assert.equal(suggestNextHostChannel(config), 5)
	})

	it('keeps reserving it as host sources fill the channels above it', () => {
		const config = configWithOperatorGui()
		config.extraLiveSources = [
			{ id: 'ndi_a', kind: 'ndi_host', routeType: 'ndi_host', hostChannel: 5, value: 'route://5-1' },
		]
		const next = suggestNextHostChannel(config)
		assert.notEqual(next, 4)
		assert.equal(next, 6)
	})

	it('reports the operator_gui channel in the Device View channel order (no hole at ch 4)', () => {
		const order = buildGeneratedChannelOrder({ config: configWithOperatorGui() })
		const byCh = new Map(order.map((row) => [row.ch, row.role]))
		assert.equal(byCh.get(4), 'operator_gui')
		assert.deepEqual(
			order.map((r) => r.ch),
			[1, 2, 3, 4],
		)
	})
})
