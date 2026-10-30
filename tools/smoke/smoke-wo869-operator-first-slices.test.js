'use strict'

/**
 * WO-868 × WO-869 — a pixel-mapping canvas on GPU heads with "Operator GUI first" on (the box's rig 30.10: operator GUI
 * and Dioda both mainScreenIndex 0, Dioda → mapping node → DP-0). Found on the box before the first real-head Apply:
 * - the mapping canvas took x=0 and pushed the operator monitor to its right (WO-40a offset), breaking operator-first;
 * - the operator GUI destination (same mainScreenIndex) was taken as the screen's program destination, so its own
 *   DP-4 cable kept the Dioda PGM window on over the slice window.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')

const NODE = 'mapping_box'
const gpu = (id, ref) => ({ id, deviceId: 'caspar_host', kind: 'gpu_out', externalRef: ref })

function boxConfig({ operatorFirst = true } = {}) {
	const config = JSON.parse(JSON.stringify(defaults))
	config.casparServer = { ...(config.casparServer || {}), operator_gui_first: operatorFirst }
	config.screenDestinations = { version: 1, destinations: [
		{ id: 'dst_operator_gui', label: 'Operator GUI', mainScreenIndex: 0, mode: 'operator_gui', videoMode: '1080p5000',
			width: 1920, height: 1080, fps: 50, videoOutput: 'shm', shmName: 'opgui' },
		{ id: 'dst_dioda', label: 'Dioda', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 3840, height: 1792, fps: 50 },
	] }
	const outputs = [{ id: 'out_1', mode: 'custom', width: 3840, height: 1792, fps: 50, label: 'Dioda wall' },
		{ id: 'out_2', mode: '1080p5000', label: 'Output 2' }]
	const slices = [
		{ id: 'sA', outputId: 'out_1', src: { x: 0, y: 0, w: 1920, h: 1792 }, dst: { rect: { x: 1920, y: 0, w: 1920, h: 1792 } } },
		{ id: 'sB', outputId: 'out_1', src: { x: 1920, y: 0, w: 1920, h: 1792 }, dst: { rect: { x: 0, y: 0, w: 1920, h: 1792 }, flipH: true } },
	]
	config.deviceGraph = {
		version: 1,
		devices: [
			{ id: 'caspar_host', role: 'caspar_host' },
			{ id: 'destinations', role: 'destinations' },
			{ id: NODE, role: 'pixel_mapping', label: 'PM', settings: { numOutputs: 2, outputs, mappings: [], slices } },
		],
		connectors: [
			{ id: 'dst_in_dst_operator_gui', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_operator_gui' },
			{ id: 'dst_in_dst_dioda', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_dioda' },
			{ id: `${NODE}_in`, deviceId: NODE, kind: 'pixel_map_in' },
			...outputs.map((o, i) => ({ id: `${NODE}_${o.id}`, deviceId: NODE, kind: 'pixel_map_out', index: i })),
			gpu('gpu_p0', 'DP-0'),
			gpu('gpu_p2', 'DP-4'),
		],
		edges: [
			{ id: 'e_og', sourceId: 'dst_in_dst_operator_gui', sinkId: 'gpu_p2' },
			{ id: 'e_in', sourceId: 'dst_in_dst_dioda', sinkId: `${NODE}_in` },
			{ id: 'e_out', sourceId: `${NODE}_out_1`, sinkId: 'gpu_p0' },
		],
	}
	return config
}

const heads = (lay) => ({
	og: Object.values(lay.operatorGui || {}).map((i) => [i.sysId, i.x, i.width]),
	map: (lay.mappingGpuOutputs || []).map((r) => [r.sysId, r.x, r.width]),
})

test('operator-first: the operator monitor keeps x=0, the mapping canvas starts right of it', () => {
	const lay = calculateLayoutPositions(buildCasparGeneratorFlatConfig(boxConfig()))
	assert.deepEqual(heads(lay), { og: [['DP-4', 0, 1920]], map: [['DP-0', 1920, 3840]] })
	assert.equal(lay.mappingCanvasOffsetX, 1920)
	assert.deepEqual([lay.mappingGpuBBox.minX, lay.mappingGpuBBox.maxX], [1920, 5760])
})

test('legacy order is unchanged: the mapping canvas heads the desktop, the operator GUI follows it', () => {
	const lay = calculateLayoutPositions(buildCasparGeneratorFlatConfig(boxConfig({ operatorFirst: false })))
	assert.deepEqual(heads(lay), { og: [['DP-4', 3840, 1920]], map: [['DP-0', 0, 3840]] })
	assert.equal(lay.mappingCanvasOffsetX, undefined)
})

test('operator-first: the slice window sits on DP-0 (x=1920) and the Dioda PGM window is off', () => {
	const flat = buildCasparGeneratorFlatConfig(boxConfig())
	assert.equal(flat.screen_1_screen_consumer, false, 'the operator GUI cable is not a Dioda PGM head')
	assert.deepEqual(flat.screen_1_slice_windows.map((w) => [w.device, w.x, w.y, w.width, w.height]), [[41, 1920, 0, 3840, 1792]])
	const xml = buildConfigXml(flat)
	const devices = [...xml.matchAll(/<screen>\s*<device>(\d+)<\/device>\s*<x>(\d+)<\/x>/g)].map((m) => [Number(m[1]), Number(m[2])])
	assert.deepEqual(devices, [[41, 1920]], 'one screen consumer: the slice window on DP-0')
})
