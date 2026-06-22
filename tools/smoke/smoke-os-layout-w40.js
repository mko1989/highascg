'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')

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

test('WO-40: graph destination binding uses connector externalRef over screen_N_system_id', () => {
	const cfg = graphBundle({
		screenCount: 1,
		destinations: [{ id: 'led1', label: 'LED', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000' }],
		gpuOuts: [{ id: 'gpu_a', sysId: 'DP-0', caspar: {} }],
		edges: [{ id: 'e1', sourceId: 'dst_in_led1', sinkId: 'gpu_a' }],
	})
	cfg.deviceGraph.connectors.find((c) => c.id === 'gpu_a').externalRef = 'card1-DP-1'
	cfg.screen_1_system_id = 'DP-0'
	cfg.deviceGraph.connectors.push({
		id: 'dst_in_led1',
		deviceId: DEST_DEV,
		kind: 'destination_in',
		externalRef: 'led1',
		label: 'in',
	})
	const layout = calculateLayoutPositions(cfg)
	assert.notEqual(layout.screens[1].sysId, 'DP-0')
	assert.ok(/DP-1|card1-DP-1/i.test(String(layout.screens[1].sysId)))
})

test('WO-40: destination-bound gpu_out skips duplicate mappingGpuOutputs', () => {
	const nodeId = 'pm1'
	const cfg = {
		screen_count: 1,
		casparServer: { screen_count: 1 },
		screen_1_system_id: 'DP-0',
		screen_1_os_x: 0,
		screen_1_os_mode: '3456x1024',
		screen_1_os_rate: 50,
		screen_1_force_os_resolution: true,
		screen_1_mode: 'custom',
		screen_1_custom_width: 3456,
		screen_1_custom_height: 1024,
		screen_1_custom_fps: 50,
		screenDestinations: {
			version: 1,
			destinations: [{ id: 'd1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom' }],
		},
		deviceGraph: {
			devices: [
				{ id: HOST, role: 'caspar_host', label: 'Host' },
				{ id: DEST_DEV, role: 'destinations', label: 'Dest' },
				{
					id: nodeId,
					role: 'pixel_mapping',
					label: 'M',
					settings: {
						outputs: [{ id: 'o1', mode: '1080p5000' }],
						mappings: [{ outputId: 'o1', rect: { x: 0, y: 0, w: 3456, h: 1024 } }],
					},
				},
			],
			connectors: [
				{ id: 'gpu_a', deviceId: HOST, kind: 'gpu_out', externalRef: 'card1-DP-1' },
				{ id: `${nodeId}_o1`, deviceId: nodeId, kind: 'pixel_map_out', index: 0 },
				{ id: 'dst_in_d1', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'd1' },
				{ id: 'pm_in', deviceId: nodeId, kind: 'pixel_map_in' },
			],
			edges: [
				{ id: 'e0', sourceId: 'dst_in_d1', sinkId: 'pm_in' },
				{ id: 'e1', sourceId: 'dst_in_d1', sinkId: 'gpu_a' },
				{ id: 'e2', sourceId: `${nodeId}_o1`, sinkId: 'gpu_a' },
			],
		},
	}
	const layout = calculateLayoutPositions(cfg)
	assert.equal(layout.mappingGpuOutputs.length, 0)
	assert.equal(layout.screens[1].sysId, 'DP-0')
	assert.equal(layout.screens[1].x, 0)
	assert.equal(layout.screens[1].mode, '3456x1024')
	assert.equal(layout.screens[1].rate, 50)
})

test('WO-40: four explicit screen_N heads match operator xrandr strip', () => {
	const cfg = {
		screen_count: 4,
		casparServer: { screen_count: 4 },
		screen_1_system_id: 'DP-0',
		screen_1_os_x: 0,
		screen_1_os_mode: '3456x1152',
		screen_1_os_rate: 50,
		screen_1_force_os_resolution: true,
		screen_2_system_id: 'DP-2',
		screen_2_os_x: 3456,
		screen_2_os_mode: '3456x1152',
		screen_2_os_rate: 50,
		screen_2_force_os_resolution: true,
		screen_3_system_id: 'DP-4',
		screen_3_os_x: 6912,
		screen_3_os_mode: '1920x1080',
		screen_3_os_rate: 50,
		screen_3_force_os_resolution: true,
		screen_4_system_id: 'HDMI-0',
		screen_4_os_x: 8832,
		screen_4_os_mode: '1920x1080',
		screen_4_os_rate: 50,
		screen_4_force_os_resolution: true,
		deviceGraph: {
			devices: [{ id: HOST, role: 'caspar_host' }],
			connectors: [
				{ id: 'gpu_a', deviceId: HOST, kind: 'gpu_out', externalRef: 'card1-DP-1' },
				{ id: 'gpu_b', deviceId: HOST, kind: 'gpu_out', externalRef: 'card1-DP-2' },
			],
			edges: [{ id: 'e1', sourceId: 'map_o1', sinkId: 'gpu_a' }],
		},
	}
	const layout = calculateLayoutPositions(cfg)
	const { plannedHeadsFromLayout } = require('../../src/utils/xrandr-layout-verify')
	const planned = plannedHeadsFromLayout(layout, { config: cfg })
	assert.equal(planned.length, 4)
	assert.equal(planned[0].sysId, 'DP-0')
	assert.equal(planned[0].x, 0)
	assert.equal(planned[0].mode, '3456x1152')
	assert.equal(planned[1].sysId, 'DP-2')
	assert.equal(planned[1].x, 3456)
	assert.equal(planned[2].sysId, 'DP-4')
	assert.equal(planned[2].x, 6912)
	assert.equal(planned[3].sysId, 'HDMI-0')
	assert.equal(planned[3].x, 8832)
	assert.equal(layout.mappingGpuOutputs.length, 0)
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

test('WO-40a: multiview head shifts right of mapping GPU bbox (pixel-map screen 1 + screen 2 + MV)', () => {
	const cfg = {
		screen_count: 2,
		casparServer: {
			screen_count: 2,
			screen_1_mode: 'custom',
			screen_1_custom_width: 5120,
			screen_1_custom_height: 1024,
			multiview_enabled: true,
			multiview_mode: '1080p5000',
		},
		screenDestinations: require('../../config/screen_destinations.json'),
		deviceGraph: require('../../config/device_graph.json'),
	}
	const layout = calculateLayoutPositions(cfg)
	assert.equal(layout.screens[2]?.x, 5120, 'screen 2 after mapping bbox')
	assert.equal(layout.multiview[1]?.x, 7040, 'multiview after screen 2 (5120 + 1920)')
	assert.equal(layout.multiview[1]?.sysId, 'HDMI-0')
})

test('graph-bound 3-head layout ignores stale screen_N overrides (multiview + PGM/PRV + PGM2)', () => {
	const cfg = {
		screen_count: 2,
		screen_1_system_id: 'HDMI-0',
		screen_1_os_mode: '1920x1080',
		screen_1_os_rate: 50,
		screen_2_system_id: 'DP-2',
		screen_2_os_mode: '1920x1080',
		screen_2_os_rate: 50,
		screenDestinations: require('../../config/screen_destinations.json'),
		deviceGraph: require('../../config/device_graph.json'),
	}
	const { plannedHeadsFromLayout } = require('../../src/utils/xrandr-layout-verify')
	const layout = calculateLayoutPositions(cfg)
	const planned = plannedHeadsFromLayout(layout, { config: cfg })
	assert.equal(planned.length, 3)
	assert.deepEqual(
		planned.map((h) => ({ sysId: h.sysId, mode: h.mode, x: h.x, rate: h.rate })),
		[
			{ sysId: 'DP-2', mode: '5120x1024', x: 0, rate: 50 },
			{ sysId: 'DP-4', mode: '1920x1080', x: 5120, rate: 50 },
			{ sysId: 'HDMI-0', mode: '1920x1080', x: 7040, rate: 50 },
		],
	)
})
