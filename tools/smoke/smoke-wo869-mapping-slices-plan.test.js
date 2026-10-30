'use strict'

/**
 * WO-869 — the slice planner (which backend draws each mapping-node output) and the zero-regression guard: legacy
 * single-rect nodes keep byte-identical DeckLink subregions and xrandr head rows (the values below were produced by
 * the pre-WO-869 generator for the same fixtures, scratch golden run 30.10: 7 fixtures, identical output).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const Plan = require('../../src/config/mapping-slices-plan')
const { buildMappingGpuLayoutArtifacts } = require('../../src/utils/mapping-gpu-os-layout')
const { applyPixelMappingProgramScreens } = require('../../src/config/pixel-mapping-config')

const NODE = 'pm'
const node = (settings) => ({ id: NODE, role: 'pixel_mapping', label: 'Map', settings })
const outs = (n, mode = '1080p5000') => Array.from({ length: n }, (_, i) => ({ id: `out_${i + 1}`, mode, label: `O${i + 1}` }))
const sinks = (...kinds) => new Map(kinds.map((k, i) => [`out_${i + 1}`, k]))
const slice = (o) => ({ outputId: 'out_1', src: { x: 0, y: 0, w: 960, h: 540 }, ...o })

describe('WO-869 planner', () => {
	it('legacy single 1:1 slices are direct on DeckLink (placement) and on GPU heads', () => {
		const p = Plan.planMappingNode(node({ outputs: outs(2), slices: [
			slice({ id: 'a', dst: { rect: { x: 100, y: 50, w: 960, h: 540 } } }),
			slice({ id: 'b', outputId: 'out_2', src: { x: 960, y: 0, w: 960, h: 540 } }),
		] }), { sinks: sinks('decklink', 'gpu') })
		assert.deepEqual(p.outputs.map((o) => o.backend), ['direct', 'direct'])
		assert.deepEqual(p.outputs[0].direct, { src: { x: 0, y: 0, w: 960, h: 540 }, destX: 100, destY: 50 })
		assert.deepEqual(p.outputs[1].direct.src, { x: 960, y: 0, w: 960, h: 540 })
		assert.equal(p.window, null)
	})

	it('a slice window takes the node\'s other GPU heads that show a slice; SDI and empty heads stay as they are', () => {
		const p = Plan.planMappingNode(node({ outputs: outs(4), slices: [
			slice({ id: 'a', dst: { rect: { x: 0, y: 0, w: 960, h: 540 }, flipH: true } }),
			slice({ id: 'b', outputId: 'out_2', src: { x: 960, y: 0, w: 960, h: 540 } }),
			slice({ id: 'c', outputId: 'out_3', src: { x: 0, y: 540, w: 960, h: 540 } }),
		] }), { sinks: sinks('gpu', 'gpu', 'decklink', 'gpu') })
		assert.deepEqual(p.outputs.map((o) => o.backend), ['screen-slices', 'screen-slices', 'direct', 'direct'])
		assert.equal('direct' in p.outputs[1], false, 'a joined head has no direct placement left')
		assert.deepEqual(p.window.outputs.map((o) => [o.outputId, o.x]), [['out_1', 0], ['out_2', 1920]])
		assert.deepEqual(p.window.slices[1].dst, [[1920, 0], [2880, 0], [2880, 540], [1920, 540]], 'same picture, now drawn by the window')
	})

	it('SDI: several or transformed slices are refused (placement only, Q2) but the first is still placed', () => {
		const p = Plan.planMappingNode(node({ outputs: outs(1), slices: [
			slice({ id: 'a', dst: { rect: { x: 0, y: 0, w: 1920, h: 1080 } } }),
		] }), { sinks: sinks('decklink') })
		assert.equal(p.outputs[0].backend, 'refused')
		assert.equal(p.outputs[0].reason, Plan.REASONS.SDI_PLACEMENT_ONLY)
		assert.deepEqual(p.outputs[0].direct, { src: { x: 0, y: 0, w: 960, h: 540 }, destX: 0, destY: 0 })
		const two = Plan.planMappingNode(node({ outputs: outs(1), slices: [slice({ id: 'a' }), slice({ id: 'b' })] }), { sinks: sinks('decklink') })
		assert.equal(two.outputs[0].backend, 'refused')
		const faded = Plan.planMappingNode(node({ outputs: outs(1), slices: [slice({ id: 'a', opacity: 0.5 })] }), { sinks: sinks('decklink') })
		assert.equal(faded.outputs[0].backend, 'refused')
	})

	it('GPU: anything beyond one 1:1 slice at (0,0) goes to screen-slices with one window per node (Q8)', () => {
		const p = Plan.planMappingNode(node({ outputs: [{ ...outs(1)[0], pos: { x: 0, y: 0 } }, { ...outs(2)[1], pos: { x: 1920, y: 0 } }], slices: [
			slice({ id: 'a', dst: { rect: { x: 10, y: 20, w: 960, h: 540 } } }),
			slice({ id: 'b', outputId: 'out_2', dst: { rect: { x: 0, y: 0, w: 1920, h: 1080 }, rotation: 90 }, feather: { l: 40 } }),
			slice({ id: 'off', outputId: 'out_2', enabled: false }),
		] }), { sinks: sinks('gpu', 'gpu') })
		assert.deepEqual(p.outputs.map((o) => o.backend), ['screen-slices', 'screen-slices'])
		assert.equal(p.window.width, 3840)
		assert.equal(p.window.height, 1080)
		assert.deepEqual(p.window.slices.map((s) => s.id), ['a', 'b'], 'disabled slices are not drawn')
		assert.deepEqual(p.window.slices[0].dst, [[10, 20], [970, 20], [970, 560], [10, 560]])
		assert.deepEqual(p.window.slices[1].clip, { x: 1920, y: 0, w: 1920, h: 1080 }, 'clipped to its own head')
		assert.equal(p.window.slices[1].dst[0][0] >= 1920, true, 'moved into window px')
		assert.deepEqual(p.window.slices[1].feather, { l: 40, t: 0, r: 0, b: 0 })
	})

	it('outputs without pos are packed left to right on the window canvas', () => {
		const p = Plan.planMappingNode(node({ outputs: [outs(2)[0], { id: 'out_2', mode: '720p5000' }], slices: [
			slice({ id: 'a', dst: { rect: { x: 5, y: 5, w: 100, h: 100 } } }),
			slice({ id: 'b', outputId: 'out_2', dst: { rect: { x: 5, y: 5, w: 100, h: 100 } } }),
		] }), { sinks: sinks('gpu', 'gpu') })
		assert.deepEqual(p.window.outputs, [
			{ outputId: 'out_1', x: 0, y: 0, w: 1920, h: 1080 },
			{ outputId: 'out_2', x: 1920, y: 0, w: 1280, h: 720 },
		])
	})

	it('z orders the draw, then list order', () => {
		const p = Plan.planMappingNode(node({ outputs: outs(1), slices: [
			slice({ id: 'top', z: 2, dst: { rect: { x: 1, y: 1, w: 50, h: 50 } } }),
			slice({ id: 'low', z: -1, dst: { rect: { x: 1, y: 1, w: 50, h: 50 } } }),
			slice({ id: 'mid', dst: { rect: { x: 1, y: 1, w: 50, h: 50 } } }),
		] }), { sinks: sinks('gpu') })
		assert.deepEqual(p.window.slices.map((s) => s.id), ['low', 'mid', 'top'])
	})

	it('a non-convex warp is not drawn and warned about', () => {
		const p = Plan.planMappingNode(node({ outputs: outs(1), slices: [
			slice({ id: 'bow', name: 'Bow', dst: { rect: { x: 0, y: 0, w: 100, h: 100 }, warp: [[0, 0], [-100, 100], [0, 0], [0, 0]] } }),
		] }), { sinks: sinks('gpu') })
		assert.equal(p.outputs[0].slices.length, 0)
		assert.match(p.warnings[0], /Bow: .*not convex/)
	})

	it('without screen slices: route-slices only when allowed and inside the channel budget (Q3), else refused', () => {
		const n = node({ outputs: outs(2), slices: [
			slice({ id: 'a', dst: { rect: { x: 5, y: 5, w: 100, h: 100 } } }),
			slice({ id: 'b', outputId: 'out_2', dst: { rect: { x: 5, y: 5, w: 100, h: 100 } } }),
		] })
		const none = Plan.planMappingNode(n, { sinks: sinks('gpu', 'gpu'), caps: { screenSlices: false } })
		assert.deepEqual(none.outputs.map((o) => o.backend), ['refused', 'refused'])
		assert.equal(none.outputs[0].reason, Plan.REASONS.NO_SCREEN_SLICES)
		assert.ok(none.outputs[0].direct, 'a refused head still shows its first slice the legacy way')
		const one = Plan.planMappingNode(n, { sinks: sinks('gpu', 'gpu'), caps: { screenSlices: false, routeSlices: true }, channelBudget: { used: 6, max: 7 } })
		assert.deepEqual(one.outputs.map((o) => o.backend), ['route-slices', 'refused'])
		assert.equal(one.outputs[1].reason, Plan.REASONS.OVER_BUDGET)
	})

	it('uncabled outputs idle, other sinks are refused', () => {
		const p = Plan.planMappingNode(node({ outputs: outs(2), slices: [slice({ id: 'a' })] }), { sinks: sinks(null, 'other') })
		assert.deepEqual(p.outputs.map((o) => o.backend), ['idle', 'refused'])
	})

	it('resolveOutputSinks follows pixel_map_out cables to DeckLink / GPU connectors', () => {
		const n = node({ outputs: outs(3) })
		const graph = {
			devices: [n],
			connectors: [
				{ id: `${NODE}_out_1`, deviceId: NODE, kind: 'pixel_map_out', index: 0 },
				{ id: `${NODE}_out_2`, deviceId: NODE, kind: 'pixel_map_out', index: 1 },
				{ id: `${NODE}_out_3`, deviceId: NODE, kind: 'pixel_map_out', index: 2 },
				{ id: 'dl1', kind: 'decklink_out' },
				{ id: 'g1', kind: 'gpu_out' },
			],
			edges: [{ sourceId: `${NODE}_out_1`, sinkId: 'dl1' }, { sourceId: `${NODE}_out_2`, sinkId: 'g1' }],
		}
		assert.deepEqual([...Plan.resolveOutputSinks(graph, n)], [['out_1', 'decklink'], ['out_2', 'gpu'], ['out_3', null]])
	})
})

describe('WO-869 zero regression: legacy nodes, new backends', () => {
	const gpuGraph = (settings) => ({ deviceGraph: {
		devices: [node(settings)],
		connectors: [
			{ id: 'gpu_a', deviceId: 'caspar_host', kind: 'gpu_out', externalRef: 'HDMI-0' },
			{ id: 'gpu_b', deviceId: 'caspar_host', kind: 'gpu_out', externalRef: 'DP-0' },
			{ id: 'gpu_c', deviceId: 'caspar_host', kind: 'gpu_out', externalRef: 'DP-2' },
			{ id: `${NODE}_out_1`, deviceId: NODE, kind: 'pixel_map_out', index: 0 },
			{ id: `${NODE}_out_2`, deviceId: NODE, kind: 'pixel_map_out', index: 1 },
			{ id: `${NODE}_out_3`, deviceId: NODE, kind: 'pixel_map_out', index: 2 },
		],
		edges: [
			{ id: 'e1', sourceId: `${NODE}_out_1`, sinkId: 'gpu_a' },
			{ id: 'e2', sourceId: `${NODE}_out_2`, sinkId: 'gpu_b' },
			{ id: 'e3', sourceId: `${NODE}_out_3`, sinkId: 'gpu_c' },
		].slice(0, settings.outputs.length),
	} })

	it('GPU heads from legacy mappings[] (golden: HDMI-0 0,0 1920x1080 · DP-0 1920,0 · DP-2 0,1080 960x540)', () => {
		const { mappingGpuOutputs } = buildMappingGpuLayoutArtifacts(gpuGraph({ outputs: outs(3), mappings: [
			{ id: 'g1', outputId: 'out_1', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
			{ id: 'g2', outputId: 'out_2', rect: { x: 1920, y: 0, w: 1920, h: 1080 } },
			{ id: 'g3', outputId: 'out_3', rect: { x: 0, y: 1080, w: 960, h: 540 } },
		] }))
		assert.deepEqual(mappingGpuOutputs.map((r) => [r.sysId, r.x, r.y, r.mode]),
			[['HDMI-0', 0, 0, '1920x1080'], ['DP-0', 1920, 0, '1920x1080'], ['DP-2', 0, 1080, '960x540']])
	})

	it('GPU heads without any mapping keep the 0,0 output-sized head', () => {
		const { mappingGpuOutputs } = buildMappingGpuLayoutArtifacts(gpuGraph({ outputs: [outs(1)[0], { id: 'out_2', mode: '720p5000' }] }))
		assert.deepEqual(mappingGpuOutputs.map((r) => [r.sysId, r.x, r.y, r.mode]), [['HDMI-0', 0, 0, '1920x1080'], ['DP-0', 0, 0, '1280x720']])
	})

	it('a screen-slices output puts its head at the output pos, output-sized', () => {
		const { mappingGpuOutputs } = buildMappingGpuLayoutArtifacts(gpuGraph({ outputs: [outs(1)[0], { ...outs(2)[1], pos: { x: 1920, y: 0 } }], slices: [
			slice({ id: 'a', src: { x: 0, y: 0, w: 1920, h: 1080 } }),
			slice({ id: 'b', outputId: 'out_2', dst: { rect: { x: 0, y: 0, w: 1920, h: 1080 } } }),
		] }))
		assert.deepEqual(mappingGpuOutputs.map((r) => [r.sysId, r.x, r.y, r.mode]), [['HDMI-0', 0, 0, '1920x1080'], ['DP-0', 1920, 0, '1920x1080']])
	})

	const sdiApp = (settings) => ({
		screenDestinations: { version: 1, destinations: [{ id: 'dst_a', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 3840, height: 1080, fps: 50 }] },
		deviceGraph: {
			devices: [node(settings)],
			connectors: [
				{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
				{ id: `${NODE}_in`, deviceId: NODE, kind: 'pixel_map_in' },
				{ id: `${NODE}_out_1`, deviceId: NODE, kind: 'pixel_map_out', index: 0 },
				{ id: `${NODE}_out_2`, deviceId: NODE, kind: 'pixel_map_out', index: 1 },
				{ id: 'dl1', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '1' },
				{ id: 'dl2', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '2' },
			],
			edges: [
				{ sourceId: 'dst_in_dst_a', sinkId: `${NODE}_in` },
				{ sourceId: `${NODE}_out_1`, sinkId: 'dl1' },
				{ sourceId: `${NODE}_out_2`, sinkId: 'dl2' },
			],
		},
	})

	it('DeckLink tiles from legacy mappings[] (golden: src 0 / 1920, dest 0,0, 1920x1080)', () => {
		const merged = {}
		applyPixelMappingProgramScreens(merged, sdiApp({ outputs: outs(2), mappings: [
			{ id: 'a', outputId: 'out_1', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
			{ id: 'b', outputId: 'out_2', rect: { x: 1920, y: 0, w: 1920, h: 1080 }, rotation: 15 },
		] }))
		assert.deepEqual(merged.screen_1_decklink_tiles.map((t) => [t.device, t.srcX, t.srcY, t.destX, t.destY, t.width, t.height]),
			[[1, 0, 0, 0, 0, 1920, 1080], [2, 1920, 0, 0, 0, 1920, 1080]])
	})

	it('DeckLink tiles without mappings keep the horizontal pack', () => {
		const merged = {}
		applyPixelMappingProgramScreens(merged, sdiApp({ outputs: outs(2), mappings: [] }))
		assert.deepEqual(merged.screen_1_decklink_tiles.map((t) => [t.srcX, t.destX]), [[0, 0], [1920, 0]])
	})

	it('S2: an SDI slice placed at dst x/y reaches <subregion> dest-x/y (no hard-coded 0 left)', () => {
		const merged = {}
		applyPixelMappingProgramScreens(merged, sdiApp({ outputs: outs(2), slices: [
			slice({ id: 'a', src: { x: 100, y: 0, w: 960, h: 540 }, dst: { rect: { x: 480, y: 270, w: 960, h: 540 } } }),
		] }))
		const t = merged.screen_1_decklink_tiles[0]
		assert.deepEqual([t.srcX, t.srcY, t.destX, t.destY, t.width, t.height], [100, 0, 480, 270, 960, 540])
		const src = fs.readFileSync(path.join(__dirname, '../../src/config/pixel-mapping-config.js'), 'utf8')
		assert.doesNotMatch(src, /destX: 0,|destY: 0,/)
	})

	it('feather names screen sides: a flip moves it to the quad edge Caspar feathers (l = ul–ll in source order)', () => {
		const f = { l: 10, t: 20, r: 0, b: 0 }
		const base = { id: 's', src: { x: 0, y: 0, w: 10, h: 10 }, opacity: 1, feather: f }
		assert.deepEqual(Plan.compileSlice({ ...base, dst: { rect: { x: 0, y: 0, w: 10, h: 10 } } }).feather, f)
		assert.deepEqual(Plan.compileSlice({ ...base, dst: { rect: { x: 0, y: 0, w: 10, h: 10 }, flipH: true } }).feather, { l: 0, t: 20, r: 10, b: 0 })
		assert.deepEqual(Plan.compileSlice({ ...base, dst: { rect: { x: 0, y: 0, w: 10, h: 10 }, flipH: true, flipV: true } }).feather, { l: 0, t: 0, r: 10, b: 20 })
	})
})
