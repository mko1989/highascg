'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateLayoutPositions } = require('../src/utils/os-layout-calculator')

const HOST = 'caspar_host'
const DEST_DEV = 'destinations_1'

/**
 * @param {{ screenCount: number, destinations: object[], gpuOuts: { id: string, sysId: string }[], edges: object[] }} opts
 */
function graphBundle({ screenCount, destinations, gpuOuts, edges }) {
	/** @type {Record<string, unknown>} */
	const cfg = {
		screen_count: screenCount,
		casparServer: { screen_count: screenCount },
		screenDestinations: { version: 1, destinations },
		screen_1_mode: '1080p5000',
		screen_2_mode: '1080p5000',
		screen_1_force_os_resolution: false,
		screen_2_force_os_resolution: false,
		deviceGraph: {
			devices: [
				{ id: HOST, role: 'caspar_host', label: 'Host' },
				{ id: DEST_DEV, role: 'destinations', label: 'Dest' },
			],
			connectors: gpuOuts.map((g) => ({
				id: g.id,
				deviceId: HOST,
				kind: 'gpu_out',
				label: g.id,
				externalRef: g.sysId,
				caspar: g.caspar && typeof g.caspar === 'object' ? g.caspar : {},
			})),
			edges,
		},
	}
	let screenIdx = 1
	for (const g of gpuOuts) {
		cfg[`screen_${screenIdx}_system_id`] = g.sysId
		screenIdx++
	}
	return cfg
}

test('WO-40: graph-bound GPU uses destination videoMode (720p50) for layout', () => {
	const cfg = graphBundle({
		screenCount: 1,
		destinations: [{ id: 'led1', label: 'LED', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '720p5000' }],
		gpuOuts: [{ id: 'gpu_a', sysId: 'DP-1' }],
		edges: [{ id: 'e1', sourceId: 'dst_in_led1', sinkId: 'gpu_a' }],
	})
	cfg.deviceGraph.connectors.push({
		id: 'dst_in_led1',
		deviceId: DEST_DEV,
		kind: 'destination_in',
		externalRef: 'led1',
		label: 'in',
	})
	const layout = calculateLayoutPositions(cfg)
	const s1 = layout.screens[1]
	assert.ok(s1)
	assert.equal(s1.mode, '1280x720')
	assert.equal(s1.x, 0)
	assert.equal(s1.y, 0)
	assert.equal(s1.width, 1280)
	assert.equal(s1.height, 720)
	assert.equal(s1.rate, 50)
})

test('WO-40: two graph-bound heads tile X by resolved widths (720p + 720p)', () => {
	const cfg = graphBundle({
		screenCount: 2,
		destinations: [
			{ id: 'a', label: 'A', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '720p5000' },
			{ id: 'b', label: 'B', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '720p5000' },
		],
		gpuOuts: [
			{ id: 'gpu_a', sysId: 'DP-1' },
			{ id: 'gpu_b', sysId: 'DP-2' },
		],
		edges: [
			{ id: 'e1', sourceId: 'dst_in_a', sinkId: 'gpu_a' },
			{ id: 'e2', sourceId: 'dst_in_b', sinkId: 'gpu_b' },
		],
	})
	cfg.deviceGraph.connectors.push(
		{ id: 'dst_in_a', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'a', label: 'in-a' },
		{ id: 'dst_in_b', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'b', label: 'in-b' },
	)
	const layout = calculateLayoutPositions(cfg)
	assert.equal(layout.screens[1].x, 0)
	assert.equal(layout.screens[1].width, 1280)
	assert.equal(layout.screens[2].x, 1280)
	assert.equal(layout.screens[2].width, 1280)
})

test('WO-40: override width on screen 1 shifts following head X', () => {
	const cfg = graphBundle({
		screenCount: 2,
		destinations: [
			{ id: 'a', label: 'A', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '720p5000' },
			{ id: 'b', label: 'B', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '720p5000' },
		],
		gpuOuts: [
			{ id: 'gpu_a', sysId: 'DP-1' },
			{ id: 'gpu_b', sysId: 'DP-2' },
		],
		edges: [
			{ id: 'e1', sourceId: 'dst_in_a', sinkId: 'gpu_a' },
			{ id: 'e2', sourceId: 'dst_in_b', sinkId: 'gpu_b' },
		],
	})
	cfg.deviceGraph.connectors.push(
		{ id: 'dst_in_a', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'a', label: 'in-a' },
		{ id: 'dst_in_b', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'b', label: 'in-b' },
	)
	cfg.screen_1_force_os_resolution = true
	cfg.screen_1_mode = 'custom'
	cfg.screen_1_custom_width = 1920
	cfg.screen_1_custom_height = 1080
	cfg.screen_1_custom_fps = 50
	const layout = calculateLayoutPositions(cfg)
	assert.equal(layout.screens[1].mode, '1920x1080')
	assert.equal(layout.screens[1].width, 1920)
	assert.equal(layout.screens[2].x, 1920)
	assert.equal(layout.screens[2].width, 1280)
})
