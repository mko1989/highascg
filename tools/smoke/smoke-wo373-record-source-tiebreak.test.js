'use strict'

/**
 * WO-373 smoke — "i connected pgm2 to rec output and pgm1 got recorded" (todos21.07.26).
 *
 * Two edges landing on one record sink at the SAME layer used to be resolved by
 * `sort((a, b) => a.layer - b.layer)[0]`: equal keys, stable sort, so the edge that happened to be
 * FIRST in the graph won forever — the older cable. This pins the documented rule instead:
 * PGM (layer 1) beats PRV (layer 2), and among same-layer edges the LAST (most recently cabled)
 * wins, loudly.
 *
 * It also pins the matrix write path that could create the illegal state at all: a caspar output
 * takes one feed (`addEdgeToGraph` → `sink_already_connected`), but the matrix writes the whole
 * graph through settings and skipped that rule.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const {
	pickOutputEdgeWinner,
	applyStreamRecordMappingsFromGraph,
} = require('../../src/config/device-graph-output-mapping.js')
const { addEdgeToGraph } = require('../../src/config/device-graph.js')

const edge = (destinationId, videoSource, layer) => ({ destinationId, videoSource, layer })

test('WO-373 pickOutputEdgeWinner', async (t) => {
	await t.test('single edge → that edge', () => {
		assert.equal(pickOutputEdgeWinner([edge('d1', 'program_1', 1)], 'record_1')?.videoSource, 'program_1')
		assert.equal(pickOutputEdgeWinner([], 'record_1'), null)
		assert.equal(pickOutputEdgeWinner(null, 'record_1'), null)
	})

	await t.test('two same-layer edges → the LAST cabled wins (was: the first)', () => {
		const warnings = []
		const winner = pickOutputEdgeWinner(
			[edge('d1', 'program_1', 1), edge('d2', 'program_2', 1)],
			'record_1',
			(m) => warnings.push(m),
		)
		assert.equal(winner.videoSource, 'program_2', 'cabling PGM2 must change what is recorded')
		assert.equal(warnings.length, 1, 'an output fed by two cables must be reported, not resolved silently')
		assert.match(warnings[0], /record_1/)
		assert.match(warnings[0], /program_1/)
		assert.match(warnings[0], /program_2/)
	})

	await t.test('PGM still beats PRV regardless of order', () => {
		assert.equal(pickOutputEdgeWinner([edge('d1', 'preview_1', 2), edge('d1', 'program_1', 1)], 'r')?.videoSource, 'program_1')
		assert.equal(pickOutputEdgeWinner([edge('d1', 'program_1', 1), edge('d1', 'preview_1', 2)], 'r')?.videoSource, 'program_1')
	})

	await t.test('PRV-only cabling still resolves to preview', () => {
		assert.equal(pickOutputEdgeWinner([edge('d1', 'preview_1', 2)], 'r')?.videoSource, 'preview_1')
	})

	await t.test('no warning when the layers differ (that tie-break is intentional)', () => {
		const warnings = []
		pickOutputEdgeWinner([edge('d1', 'program_1', 1), edge('d2', 'preview_2', 2)], 'r', (m) => warnings.push(m))
		assert.deepEqual(warnings, [])
	})
})

test('WO-373 end to end: recordOutputs[].source follows the newer cable', () => {
	const config = {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'd1', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv' },
				{ id: 'd2', label: 'PGM/PRV 2', mainScreenIndex: 1, mode: 'pgm_prv' },
			],
		},
		recordOutputs: [{ id: 'record_1', label: 'Rec1', enabled: true, source: 'program_1' }],
		deviceGraph: {
			version: 1,
			devices: [
				{ id: 'destinations', role: 'destinations', label: 'Destinations' },
				{ id: 'caspar_host', role: 'caspar', label: 'Caspar' },
			],
			connectors: [
				{ id: 'dst_in_d1', deviceId: 'destinations', kind: 'destination_in', externalRef: 'd1' },
				{ id: 'dst_in_d2', deviceId: 'destinations', kind: 'destination_in', externalRef: 'd2' },
				{ id: 'record_1', deviceId: 'caspar_host', kind: 'record_out' },
			],
			// PGM1 cabled first, PGM2 cabled after — the owner's 21.07 sequence.
			edges: [
				{ id: 'e_old', sourceId: 'dst_in_d1', sinkId: 'record_1' },
				{ id: 'e_new', sourceId: 'dst_in_d2', sinkId: 'record_1' },
			],
		},
	}

	const res = applyStreamRecordMappingsFromGraph(config)
	assert.equal(res.changed, true)
	assert.equal(config.recordOutputs[0].source, 'program_2', 'the record bus must follow the cable just dropped')
})

test('WO-373 the illegal two-edge state is refused by the server edge API', () => {
	const graph = {
		version: 1,
		devices: [
			{ id: 'destinations', role: 'destinations', label: 'Destinations' },
			{ id: 'caspar_host', role: 'caspar', label: 'Caspar' },
		],
		connectors: [
			{ id: 'dst_in_d1', deviceId: 'destinations', kind: 'destination_in', externalRef: 'd1' },
			{ id: 'dst_in_d2', deviceId: 'destinations', kind: 'destination_in', externalRef: 'd2' },
			{ id: 'record_1', deviceId: 'caspar_host', kind: 'record_out' },
		],
		edges: [],
	}
	const first = addEdgeToGraph(graph, 'dst_in_d1', 'record_1')
	assert.equal(first.ok, true)
	const second = addEdgeToGraph(first.graph, 'dst_in_d2', 'record_1')
	assert.equal(second.ok, false)
	assert.equal(second.reason, 'sink_already_connected')
})

test('WO-373 the matrix replaces a single-input sink instead of stacking cables', () => {
	const matrix = fs.readFileSync(path.join(repoRoot, 'client/components/device-view-matrix.js'), 'utf8')
	assert.ok(
		/if \(isSingleInputSinkId\(payload, sink\.id\)\) \{\s*\n\s*newGraph\.edges = newGraph\.edges\.filter\(\(e\) => String\(e\?\.sinkId \|\| ''\) !== String\(sink\.id\)\)/.test(
			matrix,
		),
		'a crosspoint click on a caspar output must drop the existing cable on that sink',
	)
})

test('WO-373 single-input sink classification mirrors the server', async () => {
	const { isSingleInputSinkId } = await import('../../client/lib/device-view-matrix-ports.js')
	const payload = {
		graph: {
			connectors: [
				{ id: 'record_1', kind: 'record_out' },
				{ id: 'stream_1', kind: 'stream_out' },
				{ id: 'gpu_p0', kind: 'gpu_out' },
				{ id: 'pm_in_1', kind: 'pixel_map_in' },
				{ id: 'dst_in_d1', kind: 'destination_in' },
			],
		},
	}
	for (const id of ['record_1', 'stream_1', 'gpu_p0']) assert.equal(isSingleInputSinkId(payload, id), true, id)
	// A pixel-map node legitimately accepts more than one feed — it must NOT be replaced.
	for (const id of ['pm_in_1', 'dst_in_d1', 'nope']) assert.equal(isSingleInputSinkId(payload, id), false, id)
})

test('WO-373 the resolved bus is visible on the output before recording', () => {
	const render = fs.readFileSync(path.join(repoRoot, 'client/components/device-view-caspar-render.js'), 'utf8')
	const markers = fs.readFileSync(path.join(repoRoot, 'client/components/device-view-caspar-render-markers.js'), 'utf8')
	assert.ok(/resolvedSource: resolvedOutputSource\('record_out', c\.id\)/.test(render))
	assert.ok(/resolvedSource: resolvedOutputSource\('stream_out', c\.id\)/.test(render))
	assert.ok(/resolvedSource: it\.resolvedSource/.test(markers), 'the field must survive into markerItems')
	assert.ok(/it\.resolvedSource \? ` · source \$\{it\.resolvedSource\}` : ''/.test(markers))
})
