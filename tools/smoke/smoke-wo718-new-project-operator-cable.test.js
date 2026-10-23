'use strict'

/**
 * WO-718 — owner 23.10.26: "when a new/fresh project is started on a server with operator monitor chosen by the start
 * gui here, it should be already connected to that output in devices view". New project replaced the device graph
 * with the empty factory graph, dropping the operator cable; and the boot answer drew no cable either on a graph with
 * no `dst_in_<operator dest>` row (the factory / New-project state — the boot sync only adds hardware rows).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const defaults = require('../../src/config/defaults')
const { createNewProject } = require('../../src/engine/new-project')
const { applyOperatorMonitorChoice } = require('../../src/system/operator-monitor-picker')
const boot = require('../../src/system/boot-screen-assignment')

const GPU = [0, 1, 2, 3].map((i) => ({ id: `gpu_p${i}`, deviceId: 'caspar_host', kind: 'gpu_out', label: `P${i + 1}`, externalRef: `DP-${i * 2}` }))

function makeCtx(over = {}) {
	const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-wo718-'))
	const cfg = JSON.parse(JSON.stringify(defaults))
	cfg.local_media_path = mediaRoot
	cfg.deviceGraph = {
		version: 1,
		devices: [{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' }],
		connectors: JSON.parse(JSON.stringify(GPU)),
		edges: [],
		layout: {},
	}
	cfg.casparServer = { ...cfg.casparServer, ...(over.casparServer || {}) }
	const store = { ...(over.store || {}) }
	const persistence = {
		get: (k) => store[k],
		set: (k, v) => {
			store[k] = v
		},
		remove: (k) => {
			store[k] = null
		},
	}
	return {
		mediaRoot,
		ctx: {
			config: cfg,
			configManager: { get: () => cfg, save: (next) => Object.assign(cfg, next) },
			persistence,
			sceneDeck: { looks: [], previewSceneId: null },
		},
	}
}

const opEdges = (graph) => (graph?.edges || []).filter((e) => e.sourceId === 'dst_in_dst_operator_gui')

function run(over) {
	const { mediaRoot, ctx } = makeCtx(over)
	try {
		const { project } = createNewProject(ctx)
		return { ctx, project }
	} finally {
		fs.rmSync(mediaRoot, { recursive: true, force: true })
	}
}

test('WO-718: the operator-monitor flag (boot answer) → a New project comes up cabled to that jack', () => {
	const { ctx, project } = run({ casparServer: { screen_3_operator_monitor: true } })
	const g = ctx.config.deviceGraph
	assert.deepEqual(opEdges(g), [{ id: 'e_dst_in_dst_operator_gui_gpu_p2', sourceId: 'dst_in_dst_operator_gui', sinkId: 'gpu_p2' }])
	assert.equal(g.edges.length, 1, 'still a clean device view otherwise (WO-474)')
	const src = g.connectors.find((c) => c.id === 'dst_in_dst_operator_gui')
	assert.equal(src?.kind, 'destination_in')
	assert.equal(src?.externalRef, 'dst_operator_gui')
	assert.ok(g.devices.some((d) => d.id === 'destinations'), 'the destinations device row exists')
	assert.deepEqual(g.connectors.filter((c) => c.kind === 'gpu_out').map((c) => c.id), ['gpu_p0', 'gpu_p1', 'gpu_p2', 'gpu_p3'])
	const cs = ctx.config.casparServer
	assert.equal(cs.screen_3_operator_monitor, true)
	assert.equal(cs.screen_3_always_on_top, false, 'WO-412: the operator jack does not stack on top')
	assert.equal(cs.screen_3_interactive, true)
	assert.equal(cs.screen_1_always_on_top, true, 'other jacks keep the factory default')
	assert.deepEqual(opEdges(project.hardwareConfig?.deviceGraph), opEdges(g), 'the saved Untitled project carries the cable')
})

test('WO-718: no flag, but this boot answered the prompt → cabled to the answered jack', () => {
	const { ctx } = run({ store: { [boot.STATE_KEY]: { bootId: boot.bootId(), name: 'DP-2', port: 2, how: 'clicked' } } })
	assert.deepEqual(opEdges(ctx.config.deviceGraph).map((e) => e.sinkId), ['gpu_p1'])
	assert.equal(ctx.config.casparServer.screen_2_operator_monitor, true)
})

test('WO-718: no operator choice (or one from an earlier boot) → the factory empty graph, as before', () => {
	for (const store of [{}, { [boot.STATE_KEY]: { bootId: 'an-earlier-boot', port: 2 } }]) {
		const { ctx } = run({ store })
		assert.equal((ctx.config.deviceGraph.edges || []).length, 0)
	}
})

test('WO-718: the flag names a jack the graph does not have → no cable invented, flag kept', () => {
	const { mediaRoot, ctx } = makeCtx({ casparServer: { screen_3_operator_monitor: true } })
	ctx.config.deviceGraph.connectors = ctx.config.deviceGraph.connectors.filter((c) => c.id !== 'gpu_p2')
	try {
		createNewProject(ctx)
	} finally {
		fs.rmSync(mediaRoot, { recursive: true, force: true })
	}
	assert.equal(opEdges(ctx.config.deviceGraph).length, 0)
	assert.equal(ctx.config.casparServer.screen_3_operator_monitor, true)
})

test('WO-718: the boot answer on a graph without the destination row now draws the cable', () => {
	const cfg = {
		screenDestinations: { destinations: [{ id: 'dst_operator_gui', label: 'Operator GUI', mode: 'operator_gui' }] },
		deviceGraph: { devices: [{ id: 'caspar_host' }], connectors: JSON.parse(JSON.stringify(GPU)), edges: [] },
	}
	const next = applyOperatorMonitorChoice(cfg, 4)
	assert.deepEqual(opEdges(next.deviceGraph).map((e) => e.sinkId), ['gpu_p3'])
	assert.equal(next.deviceGraph.connectors.find((c) => c.id === 'dst_in_dst_operator_gui')?.label, 'Operator GUI')
	assert.equal(cfg.deviceGraph.connectors.length, 4, 'input untouched')
	assert.equal(cfg.deviceGraph.edges.length, 0, 'input untouched')
})
