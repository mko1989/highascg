'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const {
	applyPhysicalPortConsumerFlagsToScreens,
	resolvePhysicalPortIndexForDestination,
} = require('../../src/config/screen-consumer-port-resolve')
const { createDestinationWiringContext } = require('../../src/config/device-graph-destination-wiring')

function clone(obj) {
	return JSON.parse(JSON.stringify(obj))
}

describe('screen consumer physical port resolve', () => {
	it('maps rear-port borderless to Caspar screen index when cabling differs', () => {
		const app = clone(defaults)
		app.screen_count = 1
		app.casparServer = {
			...app.casparServer,
			screen_count: 1,
			screen_1_mode: '1080p5000',
			screen_1_borderless: false,
			screen_3_borderless: true,
			screen_3_windowed: true,
		}
		app.screenDestinations = {
			version: 1,
			destinations: [
				{
					id: 'pgm1',
					label: 'PGM 1',
					mainScreenIndex: 0,
					mode: 'pgm_only',
					videoMode: '1080p5000',
					width: 1920,
					height: 1080,
					fps: 50,
					caspar: { bus: 'pgm' },
				},
			],
			edidNotes: '',
		}
		app.deviceGraph = {
			version: 1,
			devices: [],
			connectors: [
				{ id: 'dst_in_pgm1', kind: 'destination_in', externalRef: 'pgm1' },
				{ id: 'gpu_p2', kind: 'gpu_out', label: 'GPU 2' },
			],
			edges: [{ sourceId: 'dst_in_pgm1', sinkId: 'gpu_p2' }],
		}

		const ctx = createDestinationWiringContext(app)
		const dest = app.screenDestinations.destinations[0]
		assert.equal(resolvePhysicalPortIndexForDestination(dest, 0, ctx), 3)

		const flat = buildCasparGeneratorFlatConfig(app)
		assert.equal(flat.screen_1_borderless, true)

		const xml = buildConfigXml(flat)
		const pgm = xml.match(/Screen 1 program output \(PGM\)[\s\S]*?<screen>([\s\S]*?)<\/screen>/)
		assert.ok(pgm, 'PGM screen consumer')
		assert.match(pgm[1], /<borderless>true<\/borderless>/)
	})

	it('maps rear-port window chrome onto multiview when GPU is not port 1', () => {
		const merged = {
			screen_2_borderless: true,
			screen_2_windowed: true,
			screen_2_vsync: true,
			screen_1_borderless: false,
			multiview_borderless: false,
		}
		const appConfig = {
			screenDestinations: {
				version: 1,
				destinations: [
					{
						id: 'mv',
						label: 'MV',
						mainScreenIndex: 0,
						mode: 'multiview',
						videoMode: '1080p5000',
						width: 1920,
						height: 1080,
						fps: 50,
					},
				],
				edidNotes: '',
			},
			deviceGraph: {
				version: 1,
				devices: [],
				connectors: [
					{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
					{ id: 'gpu_p1', kind: 'gpu_out' },
				],
				edges: [{ sourceId: 'dst_in_mv', sinkId: 'gpu_p1' }],
			},
		}
		applyPhysicalPortConsumerFlagsToScreens(merged, appConfig)
		assert.equal(merged.multiview_borderless, true)
		assert.equal(merged.multiview_windowed, true)
	})

	it('maps rear-port interactive onto multiview (gpu_p1 → port 2)', () => {
		const merged = {
			screen_2_interactive: true,
			multiview_interactive: false,
		}
		const appConfig = {
			screenDestinations: {
				version: 1,
				destinations: [
					{
						id: 'mv',
						label: 'MV',
						mainScreenIndex: 0,
						mode: 'multiview',
						videoMode: '1080p5000',
						width: 1920,
						height: 1080,
						fps: 50,
					},
				],
				edidNotes: '',
			},
			deviceGraph: {
				version: 1,
				devices: [],
				connectors: [
					{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
					{ id: 'gpu_p1', kind: 'gpu_out' },
				],
				edges: [{ sourceId: 'dst_in_mv', sinkId: 'gpu_p1' }],
			},
		}
		applyPhysicalPortConsumerFlagsToScreens(merged, appConfig)
		assert.equal(merged.multiview_interactive, true)
	})

	it('operator_gui destination never projects its rear-port flags onto PGM screen keys', () => {
		// Live repro (owner todos19.07.26): PGM on gpu_p0 with always_on_top=true, operator GUI on
		// gpu_p2 with always_on_top=false. Both destinations carry mainScreenIndex=0 -> screen 1, so
		// the operator-GUI port used to overwrite the PGM consumer keys on every generate.
		const merged = {
			screen_1_always_on_top: true,
			screen_1_x: 0,
			screen_3_always_on_top: false,
			screen_3_x: 3072,
		}
		const appConfig = {
			screenDestinations: {
				version: 1,
				destinations: [
					{ id: 'pgm', label: 'PGM', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
					{ id: 'ogui', label: 'Operator GUI', mainScreenIndex: 0, mode: 'operator_gui', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
				],
				edidNotes: '',
			},
			deviceGraph: {
				version: 1,
				devices: [],
				connectors: [
					{ id: 'dst_in_pgm', kind: 'destination_in', externalRef: 'pgm' },
					{ id: 'dst_in_ogui', kind: 'destination_in', externalRef: 'ogui' },
					{ id: 'gpu_p0', kind: 'gpu_out' },
					{ id: 'gpu_p2', kind: 'gpu_out' },
				],
				edges: [
					{ sourceId: 'dst_in_pgm', sinkId: 'gpu_p0' },
					{ sourceId: 'dst_in_ogui', sinkId: 'gpu_p2' },
				],
			},
		}
		applyPhysicalPortConsumerFlagsToScreens(merged, appConfig)
		assert.equal(merged.screen_1_always_on_top, true, 'operator-GUI port 3 must not clobber the PGM always-on-top choice')
		assert.equal(merged.screen_1_x, 0, 'nor any other PGM consumer field (x/y/name/stretch/colour_space)')
	})
})
