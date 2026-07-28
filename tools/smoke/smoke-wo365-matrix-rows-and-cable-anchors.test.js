'use strict'

/**
 * WO-365 smoke — WO-364 regressions on the PGM/PRV pair.
 *
 * (a) Matrix: a cabled `pgm_prv` destination gets EXACTLY two rows (— PGM, — PRV) and no bare
 *     third row under "Other Sources". WO-364 moved the dedupe key to `id#half`, which left the
 *     bare id out of `addedIds`, so section 4's fallback re-added the destination — a source row
 *     with no half, i.e. a silent second PGM. The payload below is the box's real
 *     `GET /api/device-view` graph (28.07.26): one operator_gui dest, one pgm_prv dest cabled to
 *     gpu_p3 (PGM) and gpu_p1 (PRV, outputLayer 2).
 * (b) Anchors: both pair dots share one connector id, so `connectorCenter`'s document-order
 *     `.find()` always returned the PGM dot and every cable was drawn leaving PGM. The renderer
 *     now keys positions by `id#half`.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

/* Real /api/device-view shape, trimmed to what extractMatrixPorts reads. */
const LIVE_PAYLOAD = {
	screenDestinations: {
		version: 1,
		destinations: [
			{ id: 'dst_mrzemj1s_1', label: 'Operator GUI', mainScreenIndex: 0, mode: 'operator_gui' },
			{ id: 'dst_mrzeocxh_1', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv' },
		],
	},
	graph: {
		connectors: [
			{ id: 'dst_in_dst_mrzemj1s_1', deviceId: 'destinations', kind: 'destination_in', label: 'Operator GUI', externalRef: 'dst_mrzemj1s_1' },
			{ id: 'dst_in_dst_mrzeocxh_1', deviceId: 'destinations', kind: 'destination_in', label: 'PGM/PRV 1', externalRef: 'dst_mrzeocxh_1' },
		],
		edges: [
			{ id: 'e_dst_in_dst_mrzemj1s_1_gpu_p0', sourceId: 'dst_in_dst_mrzemj1s_1', sinkId: 'gpu_p0' },
			{ id: 'e_dst_in_dst_mrzeocxh_1_gpu_p3', sourceId: 'dst_in_dst_mrzeocxh_1', sinkId: 'gpu_p3' },
			{ id: 'edge_1785239260606_980', sourceId: 'dst_in_dst_mrzeocxh_1', sinkId: 'gpu_p1', note: '{"outputLayer":2}' },
		],
		devices: [],
	},
	suggested: { connectors: [] },
}

test('WO-365 matrix rows for a cabled pgm_prv destination', async (t) => {
	const { extractMatrixPorts } = await import('../../client/lib/device-view-matrix-ports.js')
	const { sources } = extractMatrixPorts(LIVE_PAYLOAD)

	await t.test('exactly two rows, both half-qualified', () => {
		const rows = sources.filter((s) => s.id === 'dst_in_dst_mrzeocxh_1')
		assert.equal(rows.length, 2)
		assert.deepEqual(rows.map((r) => r.half), ['pgm', 'prv'])
		assert.deepEqual(rows.map((r) => r.label), ['PGM/PRV 1 — PGM', 'PGM/PRV 1 — PRV'])
	})

	await t.test('no bare ghost row under Other Sources', () => {
		assert.deepEqual(sources.filter((s) => s.group === 'Other Sources'), [])
	})

	await t.test('every destination row can express a half (a half-less row would cable as PGM)', () => {
		for (const row of sources.filter((s) => s.id.startsWith('dst_in_dst_'))) {
			const dest = LIVE_PAYLOAD.screenDestinations.destinations.find((d) => `dst_in_${d.id}` === row.id)
			if (dest?.mode === 'pgm_prv') assert.ok(row.half, `${row.label} must carry a half`)
		}
	})

	await t.test('a non-pair destination keeps its single bare row', () => {
		const rows = sources.filter((s) => s.id === 'dst_in_dst_mrzemj1s_1')
		assert.equal(rows.length, 1)
		assert.equal(rows[0].half, null)
	})
})

test('WO-365 shared output-layer/anchor reader', async (t) => {
	const m = await import('../../client/lib/device-view-output-layer.js')

	await t.test('edgeOutputLayer parses the note WO-364 writes', () => {
		assert.equal(m.edgeOutputLayer({ note: '{"outputLayer":2}' }), 2)
		assert.equal(m.edgeOutputLayer({ note: 'outputLayer=2' }), 2)
		assert.equal(m.edgeOutputLayer({ note: 2 }), 2)
		assert.equal(m.edgeOutputLayer({}), 1)
		assert.equal(m.edgeOutputLayer({ note: '' }), 1)
		assert.equal(m.edgeOutputLayer({ note: 'garbage' }), 1)
	})

	await t.test('anchor keys separate the halves of one connector id', () => {
		assert.equal(m.edgeHalfOf({ note: '{"outputLayer":2}' }), 'prv')
		assert.equal(m.edgeHalfOf({}), 'pgm')
		assert.equal(m.anchorKeyFor('dst_in_x', 'prv'), 'dst_in_x#prv')
		assert.equal(m.anchorKeyFor('dst_in_x', null), 'dst_in_x')
		assert.equal(m.isDestinationConnectorId('dst_in_x'), true)
		assert.equal(m.isDestinationConnectorId('gpu_p1'), false)
	})

	await t.test('the PRV edge and the PGM edge of one destination get DIFFERENT anchors', () => {
		const [, pgmEdge, prvEdge] = LIVE_PAYLOAD.graph.edges
		assert.equal(m.edgeSourceAnchorKey(pgmEdge), 'dst_in_dst_mrzeocxh_1#pgm')
		assert.equal(m.edgeSourceAnchorKey(prvEdge), 'dst_in_dst_mrzeocxh_1#prv')
		assert.notEqual(m.edgeSourceAnchorKey(pgmEdge), m.edgeSourceAnchorKey(prvEdge))
	})

	await t.test('non-destination sources anchor on their plain id', () => {
		assert.equal(m.edgeSourceAnchorKey({ sourceId: 'gpu_p1', note: '{"outputLayer":2}' }), 'gpu_p1')
	})
})

test('WO-365 connectorCenter resolves the PRV dot, not the first dot in document order', async (t) => {
	/* Minimal stand-in for the two pair dots as device-view-destinations-ui renders them: same
	 * data-connector-id, different data-connector-anchor, PGM written first (the document order
	 * that made .find() pick PGM for every cable). */
	const dot = (anchor, x) => ({
		dataset: { connectorId: 'dst_in_d1', connectorAnchor: anchor },
		classList: { contains: (c) => c === 'device-view__destination-port' },
		getBoundingClientRect: () => ({ left: x, top: 0, width: 10, height: 10 }),
	})
	const pgmDot = dot('dst_in_d1#pgm', 100)
	const prvDot = dot('dst_in_d1#prv', 300)
	const surface = {
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }),
		querySelectorAll: (sel) => {
			if (sel === '[data-connector-anchor="dst_in_d1#pgm"]') return [pgmDot]
			if (sel === '[data-connector-anchor="dst_in_d1#prv"]') return [prvDot]
			if (sel === '[data-connector-id="dst_in_d1"]') return [pgmDot, prvDot] // document order
			return []
		},
	}

	const { connectorCenter } = await import('../../client/components/device-view-cables.js')

	await t.test('each half resolves to its own dot', () => {
		assert.equal(connectorCenter(surface, 'dst_in_d1', 'pgm').x, 105)
		assert.equal(connectorCenter(surface, 'dst_in_d1', 'prv').x, 305) // was 105 before the fix
	})

	await t.test('no half given → unchanged legacy behaviour (first match)', () => {
		assert.equal(connectorCenter(surface, 'dst_in_d1').x, 105)
	})

	await t.test('a half with no anchored dot falls back instead of vanishing', () => {
		const plain = {
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }),
			querySelectorAll: (sel) => (sel === '[data-connector-id="dst_in_d2"]' ? [dot(null, 50)] : []),
		}
		assert.equal(connectorCenter(plain, 'dst_in_d2', 'prv').x, 55)
	})
})

test('WO-365 renderer + gesture wiring', () => {
	const cables = read('client/components/device-view-cables.js')
	const destUi = read('client/components/device-view-destinations-ui.js')
	const cable = read('client/components/device-view-cable.js')

	// The PRV dot must carry its own anchor identity...
	assert.ok(/dataset\.connectorAnchor = anchorKeyFor\(sinkConnectorId, half\)/.test(destUi))
	// ...and the renderer must prefer it over the shared connector id.
	assert.ok(/data-connector-anchor="\$\{anchorKey\}"/.test(cables))
	assert.ok(/export function connectorCenter\(surfaceEl, connId, half\)/.test(cables))
	// Each edge resolves its own source anchor, so a PRV cable leaves the PRV dot.
	assert.ok(/connectorPositionMap\.get\(edgeSourceAnchorKey\(e\)\)/.test(cables))
	// The ghost cable follows the armed/held half.
	assert.ok(/cableSourceHalf/.test(cables) && /cableSourceHalf: cableAnchorHalf\(\)/.test(cable))
	// A re-grabbed PRV cable must not come back as a second PGM feed.
	assert.ok(/const heldLayer = heldEdge \? edgeOutputLayer\(heldEdge\) : 1/.test(cable))
	assert.ok(/await restoreLayer\(plan\.sourceId, plan\.sinkId\)/.test(cable))
	assert.ok(/await restoreLayer\(rollback\.sourceId, rollback\.sinkId\)/.test(cable))
})

test('WO-365 one outputLayer parser, not three', () => {
	const lib = read('client/lib/device-view-output-layer.js')
	assert.ok(/export function edgeOutputLayer/.test(lib))
	for (const rel of [
		'client/components/device-view-matrix.js',
		'client/components/device-view-destinations-inspector-modes.js',
	]) {
		const src = read(rel)
		assert.ok(
			!/const m = (String\(raw\)|s)\.match\(\/outputLayer/.test(src),
			`${rel} must import the shared parser, not keep a copy`,
		)
	}
})
