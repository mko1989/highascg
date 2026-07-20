'use strict'

/**
 * todos19.07.26 (owner): "the routes doesnt show up on preview, highascg knows which route it
 * should show on prv channel and what on pgm."
 *
 * MECHANISM (proven, file:line):
 *   - The ↗ button stores a look-local route against the PROGRAM bus:
 *     `client/components/scenes-editor-layer-route.js:38` `const forceBus = opts.forceBus || 'pgm'`
 *     → `:54` `const value = \`route://${ch}-${ln}\``.
 *   - Every SERVER take path rewrites that to the channel actually being taken —
 *     `src/engine/scene-take-lbg.js:84` calls `remapIntraLookRoutesForTakeChannel(incomingRaw,
 *     channel, routeRemapBank)`, and the preview-only branch in
 *     `src/api/routes-scene-take.js:172-185` reaches it with `channel: bus1` (the PRV channel).
 *     So a look *staged via /api/scene/take* is fine.
 *   - The looks EDITOR live preview does not use that pipeline. It builds AMCP itself in
 *     `client/lib/scenes-preview-push-scene.js` and (pre-fix) PLAYed `layer.source.value`
 *     verbatim onto the PRV channel (`const clipRaw = layer.source.value` → `const clip =
 *     browserCgUrl ? '[HTML] black' : clipRaw` → `PLAY <prvCh>-<ln> <clip>`). The route string
 *     still named the PROGRAM channel, so the PRV route producer tapped the program bus instead
 *     of the look staged beside it — the operator saw the program feed, or nothing, because PGM
 *     keeps look content on bank-mapped physical layers (10 → 10/110) while PRV is bank-less.
 *
 * FIX: `client/lib/scene-route-preview-remap.js` — the preview-side mirror of
 * `remapIntraLookRoutesForTakeChannel()`, wired into the push. Same rule: only a LAYER route whose
 * target layer belongs to the look is rewritten; PRV is bank-less so physical == logical.
 * Plus dependency ordering, because the ↗ button takes the lowest free layer number and a route can
 * therefore sort BELOW the layer it reads.
 */

const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const REPO = path.resolve(__dirname, '../..')
const PUSH_FILE = path.join(REPO, 'client/lib/scenes-preview-push-scene.js')

const { remapIntraLookRoutesForTakeChannel } = require('../../src/engine/scene-route-deps')

/** @returns {Promise<typeof import('../../client/lib/scene-route-preview-remap.js')>} */
function loadRemap() {
	return import('../../client/lib/scene-route-preview-remap.js')
}

// ---------------------------------------------------------------------------
// The remap itself.
// ---------------------------------------------------------------------------

test('preview route remap: an intra-look PGM route is rewritten to the PRV channel', async () => {
	const { lookLogicalLayerNumbers, remapIntraLookRouteForChannel } = await loadRemap()
	const layers = [{ layerNumber: 10 }, { layerNumber: 11 }]
	const logical = lookLogicalLayerNumbers(layers)

	// look authored against PGM ch3, staged on PRV ch4
	assert.equal(remapIntraLookRouteForChannel('route://3-10', 4, logical), 'route://4-10')
	// already on the preview channel — unchanged
	assert.equal(remapIntraLookRouteForChannel('route://4-10', 4, logical), 'route://4-10')
})

test('preview route remap: routes OUTSIDE the look are left exactly alone', async () => {
	const { lookLogicalLayerNumbers, remapIntraLookRouteForChannel } = await loadRemap()
	const logical = lookLogicalLayerNumbers([{ layerNumber: 10 }, { layerNumber: 11 }])

	// whole-channel route (a live input host / another screen's bus) — never touched
	assert.equal(remapIntraLookRouteForChannel('route://5', 4, logical), 'route://5')
	// layer route to a layer this look does not own (e.g. a DeckLink host channel slot)
	assert.equal(remapIntraLookRouteForChannel('route://5-4', 4, logical), 'route://5-4')
	// non-route sources pass through untouched
	assert.equal(remapIntraLookRouteForChannel('AMB', 4, logical), 'AMB')
	assert.equal(remapIntraLookRouteForChannel('[HTML] black', 4, logical), '[HTML] black')
	assert.equal(remapIntraLookRouteForChannel(null, 4, logical), null)
	// no usable target channel — no rewrite
	assert.equal(remapIntraLookRouteForChannel('route://3-10', 0, logical), 'route://3-10')
})

test('preview route remap: agrees with the server take-path remap on the same look', async () => {
	const { lookLogicalLayerNumbers, remapIntraLookRouteForChannel } = await loadRemap()
	const scene = {
		id: 'look-1',
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'AMB' } },
			{ layerNumber: 11, source: { type: 'route', value: 'route://3-10' } },
			{ layerNumber: 12, source: { type: 'route', value: 'route://5' } },
		],
	}
	// PRV is bank-less: the take path forces bank 'a' (src/api/routes-scene-take.js:171), which is
	// exactly the bank the server remap uses to produce logical == physical.
	const server = remapIntraLookRoutesForTakeChannel(scene, 4, 'a')
	const logical = lookLogicalLayerNumbers(scene.layers)

	for (const l of scene.layers) {
		const mine = remapIntraLookRouteForChannel(l.source.value, 4, logical)
		const theirs = server.layers.find((x) => x.layerNumber === l.layerNumber).source.value
		assert.equal(mine, theirs, `layer ${l.layerNumber} must match the server take-path remap`)
	}
	assert.equal(server.layers[1].source.value, 'route://4-10')
})

// ---------------------------------------------------------------------------
// Play ordering: the route producer needs its source layer already playing.
// ---------------------------------------------------------------------------

test('preview route remap: a route that sorts BELOW its source is PLAYed after it', async () => {
	const { orderPreviewLayerBlocks } = await loadRemap()
	// ↗ takes the lowest free layer number: routing layer 12 with 10 free puts the route at 10.
	const blocks = [
		{ layerNumber: 10, routeTargetLayer: 12, lines: ['PLAY 4-10 "route://4-12"'] },
		{ layerNumber: 12, routeTargetLayer: null, lines: ['PLAY 4-12 "AMB"'] },
	]
	const ordered = orderPreviewLayerBlocks(blocks).map((b) => b.layerNumber)
	assert.deepEqual(ordered, [12, 10], 'the source layer must be PLAYed before the route reading it')
})

test('preview route remap: route chains resolve, and a look without routes is untouched', async () => {
	const { orderPreviewLayerBlocks } = await loadRemap()

	// chain: 10 (media) ← 12 routes 10 ← 11 routes 12
	const chain = [
		{ layerNumber: 10, routeTargetLayer: null, lines: [] },
		{ layerNumber: 11, routeTargetLayer: 12, lines: [] },
		{ layerNumber: 12, routeTargetLayer: 10, lines: [] },
	]
	assert.deepEqual(
		orderPreviewLayerBlocks(chain).map((b) => b.layerNumber),
		[10, 12, 11],
		'each route follows the block it reads',
	)

	// no routes at all → identical order (no behavior change for ordinary looks)
	const plain = [
		{ layerNumber: 10, routeTargetLayer: null, lines: ['a'] },
		{ layerNumber: 11, routeTargetLayer: null, lines: ['b'] },
		{ layerNumber: 12, routeTargetLayer: null, lines: ['c'] },
	]
	assert.deepEqual(
		orderPreviewLayerBlocks(plain).map((b) => b.layerNumber),
		[10, 11, 12],
	)

	// an unsatisfiable dependency is appended, never dropped
	const orphan = [{ layerNumber: 11, routeTargetLayer: 99, lines: ['x'] }]
	assert.deepEqual(orderPreviewLayerBlocks(orphan).map((b) => b.layerNumber), [11])
})

// ---------------------------------------------------------------------------
// The push path actually uses it (regression guard for the verbatim-PLAY bug).
// ---------------------------------------------------------------------------

test('preview route remap: the preview push remaps the clip instead of PLAYing source.value verbatim', () => {
	const src = fs.readFileSync(PUSH_FILE, 'utf8')
	const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

	assert.ok(
		/from '\.\/scene-route-preview-remap\.js'/.test(code),
		'the preview push must import the preview route remap',
	)
	assert.ok(
		/remapIntraLookRouteForChannel\(clipRaw, previewCh, lookLogicalLayers\)/.test(code),
		'the clip PLAYed on PRV must be the remapped one, resolved against previewCh',
	)
	assert.ok(
		!/const clip = browserCgUrl \? '\[HTML\] black' : clipRaw\b/.test(code),
		'the raw (PGM-flavoured) route value must no longer be what gets PLAYed',
	)
	assert.ok(
		/orderPreviewLayerBlocks\(layerBlocks\)/.test(code),
		'per-layer blocks must be dependency-ordered before they join the channel queue',
	)
})
