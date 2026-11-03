'use strict'

/** The box's operator-first pixel-mapping rig (WO-869): operator GUI on DP-4, the Dioda wall fed through a pixel
 * mapping slice window on DP-0. Shared by the WO-869 slices smoke and the WO-938 cursor-gap smoke. */

const defaults = require('../../../src/config/defaults')

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

module.exports = { boxConfig }
