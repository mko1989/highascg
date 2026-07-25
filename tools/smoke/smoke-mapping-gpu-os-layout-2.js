'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')
const { applyPixelMappingProgramScreens } = require('../../src/config/pixel-mapping-config')

/*
 * Split out of tools/smoke/smoke-mapping-gpu-os-layout.js for line-count hygiene.
 */

const HOST = 'caspar_host'

test('applyPixelMappingProgramScreens: DeckLink tiles do not override destination channel resolution', () => {
	const nodeId = 'pm1'
	const merged = {
		screen_1_mode: 'custom',
		screen_1_custom_width: 5120,
		screen_1_custom_height: 1024,
		screen_1_custom_fps: 50,
		screen_1_screen_consumer: true,
	}
	applyPixelMappingProgramScreens(merged, {
		deviceGraph: {
			devices: [
				{
					id: nodeId,
					role: 'pixel_mapping',
					label: 'M',
					settings: {
						outputs: [
							{ id: 'o1', mode: '1080p5000' },
							{ id: 'o2', mode: '1080p5000' },
							{ id: 'o3', mode: '1080p5000' },
						],
						mappings: [
							{ outputId: 'o1', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
							{ outputId: 'o2', rect: { x: 1920, y: 0, w: 1920, h: 1080 } },
							{ outputId: 'o3', rect: { x: 3840, y: 0, w: 1920, h: 1080 } },
						],
					},
				},
			],
			connectors: [
				{ id: 'dlsdi_2', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '2' },
				{ id: 'dlsdi_3', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '3' },
				{ id: 'dlsdi_4', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '4' },
				{ id: `${nodeId}_o1`, deviceId: nodeId, kind: 'pixel_map_out', index: 0 },
				{ id: `${nodeId}_o2`, deviceId: nodeId, kind: 'pixel_map_out', index: 1 },
				{ id: `${nodeId}_o3`, deviceId: nodeId, kind: 'pixel_map_out', index: 2 },
				{ id: 'dst_in_d1', deviceId: 'dest_dev', kind: 'destination_in', externalRef: 'd1' },
				{ id: 'pm_in', deviceId: nodeId, kind: 'pixel_map_in' },
			],
			edges: [
				{ id: 'e0', sourceId: 'dst_in_d1', sinkId: 'pm_in' },
				{ id: 'e1', sourceId: `${nodeId}_o1`, sinkId: 'dlsdi_2' },
				{ id: 'e2', sourceId: `${nodeId}_o2`, sinkId: 'dlsdi_3' },
				{ id: 'e3', sourceId: `${nodeId}_o3`, sinkId: 'dlsdi_4' },
			],
		},
		screenDestinations: {
			version: 1,
			destinations: [
				{
					id: 'd1',
					mainScreenIndex: 0,
					mode: 'pgm_prv',
					videoMode: 'custom',
					width: 5120,
					height: 1024,
					fps: 50,
				},
			],
		},
	})
	assert.equal(merged.screen_1_custom_width, 5120)
	assert.equal(merged.screen_1_custom_height, 1024)
	assert.equal(merged.screen_1_decklink_tiles.length, 3)
	assert.equal(merged.screen_1_decklink_tiles[0].srcX, 0)
	assert.equal(merged.screen_1_decklink_tiles[1].srcX, 1920)
	assert.equal(merged.screen_1_decklink_tiles[2].srcX, 3840)
	assert.equal(merged.screen_1_decklink_replace_screen, false)
})

test('applyPixelMappingProgramScreens: DeckLink tiles + GPU outputs on same mapping node', () => {
	const nodeId = 'pm1'
	const merged = {
		screen_1_mode: 'custom',
		screen_1_custom_width: 5120,
		screen_1_custom_height: 1024,
		screen_1_custom_fps: 50,
		screen_1_screen_consumer: true,
	}
	applyPixelMappingProgramScreens(merged, {
		deviceGraph: {
			devices: [
				{
					id: nodeId,
					role: 'pixel_mapping',
					label: 'M',
					settings: {
						outputs: [
							{ id: 'o1', mode: '1080p5000' },
							{ id: 'o2', mode: '1080p5000' },
							{ id: 'o3', mode: '1080p5000' },
							{ id: 'o4', mode: '2560x1024p50', width: 2560, height: 1024, fps: 50 },
						],
						mappings: [
							{ outputId: 'o2', rect: { x: 1920, y: 0, w: 1920, h: 1080 } },
							{ outputId: 'o3', rect: { x: 3840, y: 0, w: 1920, h: 1080 } },
							{ outputId: 'o4', rect: { x: 0, y: 0, w: 2560, h: 1024 } },
						],
					},
				},
			],
			connectors: [
				{ id: 'dlsdi_2', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '2' },
				{ id: 'dlsdi_3', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '3' },
				{ id: 'dlsdi_4', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '4' },
				{ id: 'gpu_p2', deviceId: 'caspar_host', kind: 'gpu_out', externalRef: 'DP-2' },
				{ id: `${nodeId}_out_1`, deviceId: nodeId, kind: 'pixel_map_out', index: 0 },
				{ id: `${nodeId}_out_2`, deviceId: nodeId, kind: 'pixel_map_out', index: 1 },
				{ id: `${nodeId}_out_3`, deviceId: nodeId, kind: 'pixel_map_out', index: 2 },
				{ id: `${nodeId}_out_4`, deviceId: nodeId, kind: 'pixel_map_out', index: 3 },
				{ id: 'dst_in_d1', deviceId: 'dest_dev', kind: 'destination_in', externalRef: 'd1' },
				{ id: 'pm_in', deviceId: nodeId, kind: 'pixel_map_in' },
			],
			edges: [
				{ id: 'e0', sourceId: 'dst_in_d1', sinkId: 'pm_in' },
				{ id: 'e1', sourceId: `${nodeId}_out_1`, sinkId: 'dlsdi_2' },
				{ id: 'e2', sourceId: `${nodeId}_out_2`, sinkId: 'dlsdi_3' },
				{ id: 'e3', sourceId: `${nodeId}_out_3`, sinkId: 'dlsdi_4' },
				{ id: 'e4', sourceId: `${nodeId}_out_4`, sinkId: 'gpu_p2' },
			],
		},
		screenDestinations: {
			version: 1,
			destinations: [
				{
					id: 'd1',
					mainScreenIndex: 0,
					mode: 'pgm_prv',
					videoMode: 'custom',
					width: 5120,
					height: 1024,
					fps: 50,
				},
			],
		},
	})
	assert.equal(merged.screen_1_decklink_tiles?.length, 3)
	assert.equal(merged.screen_1_decklink_tiles[0].device, 2)
	assert.equal(merged.screen_1_decklink_tiles[2].device, 4)
	assert.equal(merged.screen_1_decklink_device, undefined)
})

test('applyPixelMappingProgramScreens: GPU heads do not shift DeckLink src-x (missing slice packs from 0)', () => {
	const nodeId = 'pm1'
	const merged = { screen_1_mode: 'custom', screen_1_custom_width: 5120, screen_1_custom_height: 1024 }
	applyPixelMappingProgramScreens(merged, {
		deviceGraph: {
			devices: [
				{
					id: nodeId,
					role: 'pixel_mapping',
					settings: {
						outputs: [
							{ id: 'out_1', mode: '2560x1024p50', width: 2560, height: 1024, fps: 50 },
							{ id: 'out_2', mode: '2560x1024p50', width: 2560, height: 1024, fps: 50 },
							{ id: 'out_3', mode: '1080p5000' },
							{ id: 'out_4', mode: '1080p5000' },
							{ id: 'out_5', mode: '1080p5000' },
						],
						mappings: [
							{ outputId: 'out_1', rect: { x: 0, y: 0, w: 2560, h: 1024 } },
							{ outputId: 'out_2', rect: { x: 2560, y: 0, w: 2560, h: 1024 } },
							{ outputId: 'out_4', rect: { x: 1920, y: 0, w: 1920, h: 1080 } },
							{ outputId: 'out_5', rect: { x: 3840, y: 0, w: 1920, h: 1080 } },
						],
					},
				},
			],
			connectors: [
				{ id: 'gpu_p0', deviceId: 'caspar_host', kind: 'gpu_out', externalRef: 'DP-0' },
				{ id: 'gpu_p3', deviceId: 'caspar_host', kind: 'gpu_out', externalRef: 'DP-6' },
				{ id: 'dlsdi_2', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '2' },
				{ id: 'dlsdi_3', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '3' },
				{ id: 'dlsdi_4', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '4' },
				{ id: `${nodeId}_out_1`, deviceId: nodeId, kind: 'pixel_map_out', index: 0 },
				{ id: `${nodeId}_out_2`, deviceId: nodeId, kind: 'pixel_map_out', index: 1 },
				{ id: `${nodeId}_out_3`, deviceId: nodeId, kind: 'pixel_map_out', index: 2 },
				{ id: `${nodeId}_out_4`, deviceId: nodeId, kind: 'pixel_map_out', index: 3 },
				{ id: `${nodeId}_out_5`, deviceId: nodeId, kind: 'pixel_map_out', index: 4 },
				{ id: 'dst_in_d1', deviceId: 'dest_dev', kind: 'destination_in', externalRef: 'd1' },
				{ id: 'pm_in', deviceId: nodeId, kind: 'pixel_map_in' },
			],
			edges: [
				{ id: 'e0', sourceId: 'dst_in_d1', sinkId: 'pm_in' },
				{ id: 'e1', sourceId: `${nodeId}_out_1`, sinkId: 'gpu_p0' },
				{ id: 'e2', sourceId: `${nodeId}_out_2`, sinkId: 'gpu_p3' },
				{ id: 'e3', sourceId: `${nodeId}_out_3`, sinkId: 'dlsdi_2' },
				{ id: 'e4', sourceId: `${nodeId}_out_4`, sinkId: 'dlsdi_3' },
				{ id: 'e5', sourceId: `${nodeId}_out_5`, sinkId: 'dlsdi_4' },
			],
		},
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'd1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 5120, height: 1024, fps: 50 },
			],
		},
	})
	const byDev = new Map(merged.screen_1_decklink_tiles.map((t) => [t.device, t]))
	assert.equal(byDev.get(2)?.srcX, 0)
	assert.equal(byDev.get(3)?.srcX, 1920)
	assert.equal(byDev.get(4)?.srcX, 3840)
})

test('applyPixelMappingProgramScreens: DeckLink tile video-mode uses operator output mode (2160p5000)', () => {
	const nodeId = 'pm1'
	const merged = { screen_1_mode: 'custom', screen_1_custom_width: 16384, screen_1_custom_height: 2160 }
	applyPixelMappingProgramScreens(merged, {
		deviceGraph: {
			devices: [
				{
					id: nodeId,
					role: 'pixel_mapping',
					settings: {
						outputs: [
							{ id: 'out_4k', mode: '2160p5000', width: 1920, height: 1080, fps: 50 },
							{ id: 'out_strip', mode: '2160p5000', width: 1920, height: 1080, fps: 50 },
						],
						mappings: [
							{ outputId: 'out_4k', rect: { x: 0, y: 0, w: 3840, h: 2160 } },
							{ outputId: 'out_strip', rect: { x: 3840, y: 0, w: 3840, h: 1080 } },
						],
					},
				},
			],
			connectors: [
				{ id: 'dlsdi_4', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '4' },
				{ id: 'dlsdi_2', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '2' },
				{ id: `${nodeId}_out_1`, deviceId: nodeId, kind: 'pixel_map_out', index: 0 },
				{ id: `${nodeId}_out_2`, deviceId: nodeId, kind: 'pixel_map_out', index: 1 },
				{ id: 'dst_in_d1', deviceId: 'dest_dev', kind: 'destination_in', externalRef: 'd1' },
				{ id: 'pm_in', deviceId: nodeId, kind: 'pixel_map_in' },
			],
			edges: [
				{ sourceId: 'dst_in_d1', sinkId: 'pm_in' },
				{ sourceId: `${nodeId}_out_1`, sinkId: 'dlsdi_4' },
				{ sourceId: `${nodeId}_out_2`, sinkId: 'dlsdi_2' },
			],
		},
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'd1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 16384, height: 2160, fps: 50 },
			],
		},
	})
	const byDev = new Map(merged.screen_1_decklink_tiles.map((t) => [t.device, t]))
	assert.equal(byDev.get(4)?.videoMode, '2160p5000')
	assert.equal(byDev.get(2)?.videoMode, '2160p5000')
})

test('applyPixelMappingProgramScreens: GPU mapping does not override destination channel resolution', () => {
	const nodeId = 'pm1'
	const merged = {
		screen_1_mode: 'custom',
		screen_1_custom_width: 5120,
		screen_1_custom_height: 1024,
		screen_1_custom_fps: 50,
	}
	applyPixelMappingProgramScreens(merged, {
		deviceGraph: {
			devices: [
				{ id: HOST, role: 'caspar_host', label: 'H' },
				{ id: 'dest_dev', role: 'destinations', label: 'D' },
				{
					id: nodeId,
					role: 'pixel_mapping',
					label: 'M',
					settings: {
						outputs: [
							{ id: 'o1', mode: '1080p5000' },
							{ id: 'o2', mode: '1080p5000' },
							{ id: 'o3', mode: '1080p5000' },
						],
						mappings: [
							{ outputId: 'o1', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
							{ outputId: 'o2', rect: { x: 1920, y: 0, w: 1920, h: 1080 } },
							{ outputId: 'o3', rect: { x: 3840, y: 0, w: 1920, h: 1080 } },
						],
					},
				},
			],
			connectors: [
				{ id: 'gpu_a', deviceId: HOST, kind: 'gpu_out', externalRef: 'HDMI-0' },
				{ id: 'gpu_b', deviceId: HOST, kind: 'gpu_out', externalRef: 'DP-0' },
				{ id: 'gpu_c', deviceId: HOST, kind: 'gpu_out', externalRef: 'DP-2' },
				{ id: `${nodeId}_o1`, deviceId: nodeId, kind: 'pixel_map_out', index: 0 },
				{ id: `${nodeId}_o2`, deviceId: nodeId, kind: 'pixel_map_out', index: 1 },
				{ id: `${nodeId}_o3`, deviceId: nodeId, kind: 'pixel_map_out', index: 2 },
				{ id: 'dst_in_d1', deviceId: 'dest_dev', kind: 'destination_in', externalRef: 'd1' },
				{ id: 'pm_in', deviceId: nodeId, kind: 'pixel_map_in' },
			],
			edges: [
				{ id: 'e0', sourceId: 'dst_in_d1', sinkId: 'pm_in' },
				{ id: 'e1', sourceId: `${nodeId}_o1`, sinkId: 'gpu_a' },
				{ id: 'e2', sourceId: `${nodeId}_o2`, sinkId: 'gpu_b' },
				{ id: 'e3', sourceId: `${nodeId}_o3`, sinkId: 'gpu_c' },
			],
		},
		screenDestinations: {
			version: 1,
			destinations: [{ id: 'd1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000' }],
		},
	})
	assert.equal(merged.screen_1_custom_width, 5120)
	assert.equal(merged.screen_1_custom_height, 1024)
	assert.equal(merged.screen_1_decklink_tiles, undefined)
})

test('calculateLayoutPositions: pixel-map GPU strip + multiview to the right (operator xrandr)', () => {
	const nodeId = 'mapping_1'
	const HOST = 'caspar_host'
	const DEST_DEV = 'destinations'
	const layout = calculateLayoutPositions({
		screen_count: 2,
		casparServer: { screen_count: 2 },
		screenDestinations: {
			version: 1,
			destinations: [
				{
					id: 'dst_pgm',
					mainScreenIndex: 0,
					mode: 'pgm_prv',
					videoMode: 'custom',
					width: 5120,
					height: 1024,
					fps: 50,
				},
				{
					id: 'dst_mv',
					mainScreenIndex: 0,
					mode: 'multiview',
					videoMode: '1080p5000',
					width: 1920,
					height: 1080,
					fps: 50,
				},
			],
		},
		deviceGraph: {
			devices: [
				{ id: HOST, role: 'caspar_host', label: 'Host' },
				{ id: DEST_DEV, role: 'destinations', label: 'Dest' },
				{
					id: nodeId,
					role: 'pixel_mapping',
					label: 'Map',
					settings: {
						outputs: [
							{ id: 'out_1', mode: '2560x1024p50', width: 2560, height: 1024, fps: 50 },
							{ id: 'out_2', mode: '2560x1024p50', width: 2560, height: 1024, fps: 50 },
						],
						mappings: [
							{ outputId: 'out_1', rect: { x: 0, y: 0, w: 2560, h: 1024 } },
							{ outputId: 'out_2', rect: { x: 2560, y: 0, w: 2560, h: 1024 } },
						],
					},
				},
			],
			connectors: [
				{ id: 'gpu_p0', deviceId: HOST, kind: 'gpu_out', externalRef: 'DP-0', caspar: { mainIndex: 0 } },
				{ id: 'gpu_p1', deviceId: HOST, kind: 'gpu_out', externalRef: 'DP-2/DP-3', caspar: { mainIndex: 0 } },
				{ id: 'gpu_p2', deviceId: HOST, kind: 'gpu_out', externalRef: 'DP-4', caspar: { mainIndex: 1 } },
				{ id: 'gpu_p3', deviceId: HOST, kind: 'gpu_out', externalRef: 'DP-6', caspar: { mainIndex: 2 } },
				{ id: `${nodeId}_out_1`, deviceId: nodeId, kind: 'pixel_map_out', index: 0 },
				{ id: `${nodeId}_out_2`, deviceId: nodeId, kind: 'pixel_map_out', index: 1 },
				{ id: 'dst_in_pgm', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'dst_pgm' },
				{ id: 'dst_in_dst_mv', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'dst_mv' },
				{ id: 'pm_in', deviceId: nodeId, kind: 'pixel_map_in' },
			],
			edges: [
				{ id: 'e0', sourceId: 'dst_in_pgm', sinkId: 'pm_in' },
				{ id: 'e1', sourceId: `${nodeId}_out_1`, sinkId: 'gpu_p0' },
				{ id: 'e2', sourceId: `${nodeId}_out_2`, sinkId: 'gpu_p3' },
				{ id: 'e3', sourceId: 'dst_in_dst_mv', sinkId: 'gpu_p2' },
			],
		},
	})
	assert.equal(layout.mappingGpuOutputs.length, 2)
	const mapById = new Map(layout.mappingGpuOutputs.map((r) => [r.sysId, r]))
	assert.equal(mapById.get('DP-0')?.mode, '2560x1024')
	assert.equal(mapById.get('DP-0')?.x, 0)
	assert.equal(mapById.get('DP-6')?.mode, '2560x1024')
	assert.equal(mapById.get('DP-6')?.x, 2560)
	assert.equal(layout.multiview[1].sysId, 'DP-4')
	assert.equal(layout.multiview[1].mode, '1920x1080')
	assert.equal(layout.multiview[1].x, 5120)
})

test('buildDecklinkTiledConsumersXml: primary tile outside ports, secondaries in ports', () => {
	const { buildDecklinkTiledConsumersXml } = require('../../src/config/config-generator-consumer-attach')
	const xml = buildDecklinkTiledConsumersXml([
		{ device: 4, srcX: 0, srcY: 0, destX: 0, destY: 0, width: 3840, height: 2160, videoMode: '2160p5000' },
		{ device: 2, srcX: 3840, srcY: 0, destX: 0, destY: 0, width: 3840, height: 2160, videoMode: '2160p5000' },
		{ device: 3, srcX: 7680, srcY: 0, destX: 0, destY: 0, width: 3840, height: 2160, videoMode: '2160p5000' },
		{ device: 1, srcX: 11520, srcY: 0, destX: 0, destY: 0, width: 3840, height: 2160, videoMode: '2160p5000' },
	])
	assert.match(xml, /<video-mode>2160p5000<\/video-mode>/)
	assert.match(xml, /<pixel-format>yuv<\/pixel-format>/)
	assert.match(xml, /<device>4<\/device>[\s\S]*<src-x>0<\/src-x>[\s\S]*<ports>/)
	assert.doesNotMatch(xml, /<ports>[\s\S]*<device>4<\/device>/)
	assert.match(xml, /<ports>[\s\S]*<device>2<\/device>[\s\S]*<device>3<\/device>[\s\S]*<device>1<\/device>/)
	assert.match(xml, /<keyer>default<\/keyer>/)
})
