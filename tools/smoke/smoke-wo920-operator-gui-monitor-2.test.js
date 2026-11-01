'use strict'

/**
 * WO-920 — the Operator GUI card has two output dots: 1 = the main operator monitor, 2 = the second operator window's
 * monitor (WO-891). Dot 2's cable carries the edge note outputLayer 2 (like a PRV half). Server side:
 *  - the layout plan keys the heads by that dot (operatorGui[1] / [2]); monitor 1 keeps the left edge under
 *    "Operator GUI first", monitor 2 sits next to it, neither is a Caspar output;
 *  - "the" operator monitor (operator_monitor flag, port flags, the operator port's rect) is dot 1's jack only;
 *  - the operator-screen picker / boot assignment keep the dot-2 cable and never park a destination on its jack;
 *  - GET /api/system/operator-screen marks the cabled outputs `gui: 1` / `gui: 2`.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
// WO-753: plan on a fixed GPU, not the host's (stubbed before the planner loads them).
const hardwareInfo = require('../../src/utils/hardware-info')
hardwareInfo.getDisplaysXrandrDetailed = () => ({ displays: ['DP-0', 'DP-4', 'DP-6'].map((name) => ({ name, connected: true })) })
hardwareInfo.getGpuConnectorInventory = () => []
const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')
const { operatorGuiPlacementOrder } = require('../../src/utils/os-layout-calculator-place')
const ports = require('../../src/config/screen-consumer-port-resolve')
const { resolveLayoutRectForOperatorPort } = require('../../src/utils/x-display-session-layout-resolve')
const picker = require('../../src/system/operator-monitor-picker')
const B = require('../../src/system/boot-screen-assignment')
const { handleGet, planRoles } = require('../../src/api/routes-operator-screen')

const HOST = 'caspar_host'
const DEV = 'destinations_1'
const DOT2 = JSON.stringify({ outputLayer: 2 })

/** PGM on DP-0 (gpu_p0); the operator GUI's dot 1 on DP-4 (gpu_p2), dot 2 on DP-6 (gpu_p3) unless `edges` says else. */
function config(edges, extra = {}) {
	return {
		screen_count: 1,
		casparServer: { screen_count: 1, ...(extra.casparServer || {}) },
		...extra.top,
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'og', label: 'Operator GUI', mainScreenIndex: 0, mode: 'operator_gui', videoMode: 'custom', width: 1920, height: 1080, fps: 50 },
				{ id: 'pgm', label: 'Main', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 3840, height: 1792, fps: 50 },
			],
		},
		deviceGraph: {
			devices: [
				{ id: HOST, role: 'caspar_host', label: 'Host' },
				{ id: DEV, role: 'destinations', label: 'Dest' },
			],
			connectors: [
				{ id: 'gpu_p0', deviceId: HOST, kind: 'gpu_out', label: 'gpu_p0', externalRef: 'DP-0' },
				{ id: 'gpu_p2', deviceId: HOST, kind: 'gpu_out', label: 'gpu_p2', externalRef: 'DP-4' },
				{ id: 'gpu_p3', deviceId: HOST, kind: 'gpu_out', label: 'gpu_p3', externalRef: 'DP-6' },
				{ id: 'dst_in_og', deviceId: DEV, kind: 'destination_in', externalRef: 'og', label: 'in' },
				{ id: 'dst_in_pgm', deviceId: DEV, kind: 'destination_in', externalRef: 'pgm', label: 'in' },
			],
			edges: edges || [
				{ id: 'e_pgm', sourceId: 'dst_in_pgm', sinkId: 'gpu_p0' },
				{ id: 'e_og1', sourceId: 'dst_in_og', sinkId: 'gpu_p2' },
				{ id: 'e_og2', sourceId: 'dst_in_og', sinkId: 'gpu_p3', note: DOT2 },
			],
		},
	}
}

const rect = (r) => [r.sysId, r.x, r.y, r.width, r.height]
const casparIds = (lay) =>
	[lay.screens, lay.prv, lay.multiview].flatMap((g) => Object.values(g || {})).map((r) => r.sysId)

describe('WO-920 layout plan: dot 2 is operatorGui[2]', () => {
	it('dot 1 alone is operatorGui[1], as before', () => {
		const lay = calculateLayoutPositions(config([
			{ id: 'e_pgm', sourceId: 'dst_in_pgm', sinkId: 'gpu_p0' },
			{ id: 'e_og1', sourceId: 'dst_in_og', sinkId: 'gpu_p2' },
		]))
		assert.deepEqual(Object.keys(lay.operatorGui), ['1'])
		assert.equal(lay.operatorGui[1].sysId, 'DP-4')
	})

	it('dot 1 + dot 2: both heads lit, keyed by the dot, no overlap, never a Caspar output', () => {
		const lay = calculateLayoutPositions(config())
		assert.equal(lay.operatorGui[1].sysId, 'DP-4')
		assert.equal(lay.operatorGui[2].sysId, 'DP-6')
		assert.deepEqual(casparIds(lay), ['DP-0'], 'only the PGM jack is a Caspar output')
		const heads = [lay.screens[1], lay.operatorGui[1], lay.operatorGui[2]]
		for (let i = 0; i < heads.length; i++) {
			for (let j = i + 1; j < heads.length; j++) {
				const a = heads[i]
				const b = heads[j]
				assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x, `${a.sysId} and ${b.sysId} must not overlap`)
			}
		}
	})

	it('the key follows the dot, not the order the edges / connectors are listed in', () => {
		const cfg = config([
			{ id: 'e_og2', sourceId: 'dst_in_og', sinkId: 'gpu_p2', note: DOT2 },
			{ id: 'e_pgm', sourceId: 'dst_in_pgm', sinkId: 'gpu_p0' },
			{ id: 'e_og1', sourceId: 'dst_in_og', sinkId: 'gpu_p3' },
		])
		const lay = calculateLayoutPositions(cfg)
		assert.equal(lay.operatorGui[1].sysId, 'DP-6', 'dot 1 is on DP-6 now')
		assert.equal(lay.operatorGui[2].sysId, 'DP-4')
		assert.ok(lay.operatorGui[1].x < lay.operatorGui[2].x, 'monitor 1 is placed before monitor 2')
	})

	it('"Operator GUI first": monitor 1 at x=0, monitor 2 next to it, then the screens', () => {
		const lay = calculateLayoutPositions(config(null, { casparServer: { operator_gui_first: true } }))
		assert.deepEqual(rect(lay.operatorGui[1]), ['DP-4', 0, 0, 1920, 1080])
		assert.deepEqual(rect(lay.operatorGui[2]), ['DP-6', 1920, 0, 1920, 1080])
		assert.equal(lay.screens[1].x, 3840)
	})

	it('a second jack on dot 1 (fan-out) still lights, but never as monitor 2', () => {
		const lay = calculateLayoutPositions(config([
			{ id: 'e_pgm', sourceId: 'dst_in_pgm', sinkId: 'gpu_p0' },
			{ id: 'e_og1', sourceId: 'dst_in_og', sinkId: 'gpu_p2' },
			{ id: 'e_og1b', sourceId: 'dst_in_og', sinkId: 'gpu_p3' },
		]))
		assert.deepEqual(Object.keys(lay.operatorGui).sort(), ['1', '3'])
		assert.deepEqual(operatorGuiPlacementOrder([{ n: 2 }, { n: 1 }, { n: 1 }, { n: 2 }]).map((p) => p.n), [1, 3, 2, 4])
	})

	it('the unnumbered operator_gui_os_x pins monitor 1 only (monitor 2 would land on the same pixels)', () => {
		const lay = calculateLayoutPositions(config(null, { top: { operator_gui_os_x: 5000 } }))
		assert.equal(lay.operatorGui[1].x, 5000)
		assert.notEqual(lay.operatorGui[2].x, 5000)
	})
})

describe('WO-920: "the" operator monitor is dot 1', () => {
	// dot 2 on the LOWER port number: a first-cable-wins resolver would pick it
	const swapped = () => config([
		{ id: 'e_pgm', sourceId: 'dst_in_pgm', sinkId: 'gpu_p0' },
		{ id: 'e_og2', sourceId: 'dst_in_og', sinkId: 'gpu_p2', note: DOT2 },
		{ id: 'e_og1', sourceId: 'dst_in_og', sinkId: 'gpu_p3' },
	])

	it('operator_monitor + stacking flags land on the dot-1 port only', () => {
		const { patch, guiPort } = ports.deriveOperatorGuiAppConfigPortFlags(swapped())
		assert.equal(guiPort, 4)
		assert.equal(patch.screen_4_operator_monitor, true)
		assert.equal(patch.screen_3_operator_monitor, false)
		const merged = {}
		ports.applyPhysicalPortConsumerFlagsToScreens(merged, swapped())
		assert.equal(merged.screen_4_operator_monitor, true)
		assert.equal(merged.screen_3_operator_monitor, undefined, 'monitor 2 gets no operator flags')
	})

	it('only dot 2 cabled: no operator monitor port from it', () => {
		const cfg = config([{ id: 'e_og2', sourceId: 'dst_in_og', sinkId: 'gpu_p3', note: DOT2 }])
		assert.equal(ports.deriveOperatorGuiAppConfigPortFlags(cfg).guiPort, null)
	})

	it("the operator port's rect is monitor 1's", () => {
		const cfg = swapped()
		const r = resolveLayoutRectForOperatorPort(cfg, calculateLayoutPositions(cfg), 4)
		assert.deepEqual([r.sysId, r.kind, r.index], ['DP-6', 'operator_gui', 1])
	})
})

describe('WO-920: picker and boot assignment keep the dot-2 cable', () => {
	const pickCfg = () => ({ casparServer: {}, ...config() })

	it('choosing another operator jack rewires dot 1 and leaves dot 2', () => {
		const next = picker.applyOperatorMonitorChoice(pickCfg(), 1)
		const og = next.deviceGraph.edges.filter((e) => e.sourceId === 'dst_in_og').map((e) => [e.sinkId, e.note || ''])
		assert.deepEqual(og.sort(), [['gpu_p0', ''], ['gpu_p3', DOT2]])
	})

	it("choosing dot 2's own jack makes it monitor 1 (the dot-2 cable goes)", () => {
		const next = picker.applyOperatorMonitorChoice(pickCfg(), 4)
		const og = next.deviceGraph.edges.filter((e) => e.sourceId === 'dst_in_og').map((e) => [e.sinkId, e.note || ''])
		assert.deepEqual(og, [['gpu_p3', '']])
	})

	it('boot: no destination moves onto monitor 2, and the default operator is not monitor 2', () => {
		const port = (slot, name) => ({ physicalPortId: `gpu_p${slot}`, slotOrder: slot, runtime: { connected: !!name, xrandrName: name || null } })
		const cfg = config([
			{ id: 'e_pgm', sourceId: 'dst_in_pgm', sinkId: 'gpu_p1' }, // dark jack: must move
			{ id: 'e_og1', sourceId: 'dst_in_og', sinkId: 'gpu_p2' },
			{ id: 'e_og2', sourceId: 'dst_in_og', sinkId: 'gpu_p3', note: DOT2 },
		])
		cfg.deviceGraph.connectors.push({ id: 'gpu_p1', deviceId: HOST, kind: 'gpu_out', label: 'gpu_p1', externalRef: 'DP-2' })
		const lit = B.litPorts({ ports: [port(0, 'DP-0'), port(1), port(2, 'DP-4'), port(3, 'DP-6')] })
		assert.deepEqual(B.planDestinationCables(cfg, lit, 'gpu_p2').moves, [{ from: 'gpu_p1', to: 'gpu_p0' }])
		const noP2 = lit.filter((p) => p.id !== 'gpu_p2')
		assert.deepEqual(B.planDestinationCables(cfg, noP2, 'gpu_p0').unplaced, ['gpu_p1'], 'DP-6 (monitor 2) is not free')
		// PGM on DP-0, dot 2 on DP-6, nothing else lit: DP-6 is kept by its cable like any destination's jack
		const kept = config()
		assert.equal(B.defaultOperator(kept, lit.filter((p) => p.id !== 'gpu_p2'), 9).name, 'DP-0')
		assert.equal(B.defaultOperator(kept, lit, 9).name, 'DP-4')
	})
})

describe('WO-920 GET /api/system/operator-screen marks the GUI monitors', () => {
	const outputs = [
		{ name: 'DP-4', port: 3, x: 0, y: 0, width: 1920, height: 1080 },
		{ name: 'DP-6', port: 4, x: 1920, y: 0, width: 1920, height: 1080 },
		{ name: 'DP-0', port: 1, x: 3840, y: 0, width: 3840, height: 1792 },
	]
	const get = (cfg) =>
		JSON.parse(handleGet({ config: cfg }, { listOutputs: () => outputs, resolveFlagPort: () => 3, bootStatus: () => ({}) }).body)

	it('gui 1 / gui 2 on the cabled outputs, from the layout plan', () => {
		const r = get(config())
		assert.deepEqual(r.outputs.map((o) => [o.name, o.gui ?? null, o.caspar]), [['DP-4', 1, false], ['DP-6', 2, false], ['DP-0', null, true]])
		assert.deepEqual([...planRoles(config()).gui.entries()], [['DP-4', 1], ['DP-6', 2]])
	})

	it('no dot-2 cable: no output says gui 2', () => {
		const r = get(config([{ id: 'e_og1', sourceId: 'dst_in_og', sinkId: 'gpu_p2' }]))
		assert.equal(r.outputs.some((o) => o.gui === 2), false)
		assert.equal(r.outputs.find((o) => o.name === 'DP-6').gui, undefined, 'the field is absent, not 0')
	})
})
