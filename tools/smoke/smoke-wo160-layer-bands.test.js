'use strict'

/**
 * WO-160 part A — bank layer scheme smokes.
 *
 * - Client allocator: consecutive assignment from 10 (step 1), reorder renumbering,
 *   91st layer rejected (look full), one-way migration of legacy 10/20/30 looks and
 *   >99 overflow (100/110) looks.
 * - PIP overlay band: compact-index slot formula for both banks, stack clamp at 4,
 *   every output inside 260–979 (never ≥ 998).
 * - Timeline band: base 210, cap 50 layers (210–259) with clamp.
 * - Server: take-payload layer-range guard (400), project-envelope migration,
 *   persisted live-scene migration on read.
 * - Static: no code references the legacy `100 + p * 8` PIP fallback constants or
 *   TIMELINE_LAYER_BASE 200.
 */

const fs = require('node:fs')
const path = require('node:path')
const { describe, it, test } = require('node:test')
const assert = require('node:assert/strict')

const {
	LOOK_LAYER_MIN,
	LOOK_LAYER_MAX,
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_MAX_COUNT,
	PIP_OVERLAY_BAND_BASE,
	PIP_OVERLAY_MAX_STACK,
	PIP_OVERLAY_BAND_MAX,
	HARD_MAX_PHYSICAL_LAYER,
	assertPhysicalLayerBelowCeiling,
	isLookPhysicalLayer,
	renumberLookLayersConsecutive,
} = require('../../src/engine/look-layer-ranges')
const {
	overlayLayerSlot,
	resolvePipOverlayCasparLayer,
} = require('../../src/engine/pip-overlay-utils')
const { timelineCasparLayer } = require('../../src/engine/timeline-playback-helpers')

const loadEsm = (p) => import(p)

describe('WO-160 band constants (single source of truth)', () => {
	it('band table matches the WO decision', () => {
		assert.equal(LOOK_LAYER_MIN, 10)
		assert.equal(LOOK_LAYER_MAX, 99)
		assert.equal(TIMELINE_LAYER_BASE, 210)
		assert.equal(TIMELINE_LAYER_MAX_COUNT, 50)
		assert.equal(PIP_OVERLAY_BAND_BASE, 260)
		assert.equal(PIP_OVERLAY_MAX_STACK, 4)
		assert.equal(PIP_OVERLAY_BAND_MAX, 979)
		assert.equal(HARD_MAX_PHYSICAL_LAYER, 999)
		// Bands are disjoint and ordered: looks < timelines < PIP < border (998).
		assert.ok(LOOK_LAYER_MAX + 100 < TIMELINE_LAYER_BASE)
		assert.ok(TIMELINE_LAYER_BASE + TIMELINE_LAYER_MAX_COUNT - 1 < PIP_OVERLAY_BAND_BASE)
		assert.ok(PIP_OVERLAY_BAND_MAX < 998)
	})

	it('assertPhysicalLayerBelowCeiling throws above 999 and passes valid layers through', () => {
		assert.equal(assertPhysicalLayerBelowCeiling(999, 'test'), 999)
		assert.equal(assertPhysicalLayerBelowCeiling(10, 'test'), 10)
		assert.throws(() => assertPhysicalLayerBelowCeiling(1000, 'test'), /ceiling/)
		assert.throws(() => assertPhysicalLayerBelowCeiling(NaN, 'test'), /ceiling/)
	})

	it('isLookPhysicalLayer ranges unchanged (10-99 / 110-199)', () => {
		assert.equal(isLookPhysicalLayer(10), true)
		assert.equal(isLookPhysicalLayer(99), true)
		assert.equal(isLookPhysicalLayer(100), false)
		assert.equal(isLookPhysicalLayer(110), true)
		assert.equal(isLookPhysicalLayer(199), true)
		assert.equal(isLookPhysicalLayer(200), false)
		assert.equal(isLookPhysicalLayer(210), false)
	})
})

describe('WO-160 PIP overlay slot formula', () => {
	it('compact index maps both banks: A 10-99 -> 0-89, B 110-199 -> 90-179', () => {
		assert.equal(overlayLayerSlot(10, 0), 260)
		assert.equal(overlayLayerSlot(10, 3), 263)
		assert.equal(overlayLayerSlot(11, 0), 264)
		assert.equal(overlayLayerSlot(99, 3), 260 + 89 * 4 + 3) // 619
		assert.equal(overlayLayerSlot(110, 0), 620)
		assert.equal(overlayLayerSlot(199, 3), 979)
	})

	it('stack index clamps at 4 slots', () => {
		assert.equal(overlayLayerSlot(10, 4), overlayLayerSlot(10, 3))
		assert.equal(overlayLayerSlot(10, 99), overlayLayerSlot(10, 3))
		assert.equal(overlayLayerSlot(10, -5), overlayLayerSlot(10, 0))
	})

	it('resolvePipOverlayCasparLayer ignores nextContentLayer (pure band formula)', () => {
		assert.equal(resolvePipOverlayCasparLayer(10, 0, 11), 260)
		assert.equal(resolvePipOverlayCasparLayer(10, 0, 20), 260)
		assert.equal(resolvePipOverlayCasparLayer(10, 0, 10000), 260)
		assert.equal(resolvePipOverlayCasparLayer(10, 0), 260)
	})

	it('every slot for every content layer in both banks stays inside 260-979 (never >= 998)', () => {
		const contents = []
		for (let p = 10; p <= 99; p++) contents.push(p)
		for (let p = 110; p <= 199; p++) contents.push(p)
		const seen = new Set()
		for (const p of contents) {
			for (let i = 0; i < PIP_OVERLAY_MAX_STACK; i++) {
				const slot = resolvePipOverlayCasparLayer(p, i)
				assert.ok(slot >= PIP_OVERLAY_BAND_BASE && slot <= PIP_OVERLAY_BAND_MAX, `slot ${slot} for p=${p} i=${i}`)
				assert.ok(slot < 998)
				assert.ok(!seen.has(slot), `slot collision at ${slot} (p=${p} i=${i})`)
				seen.add(slot)
			}
		}
		assert.equal(seen.size, contents.length * PIP_OVERLAY_MAX_STACK)
	})

	it('degenerate content layers clamp into the band (no escape below 260 or above 979)', () => {
		for (const p of [NaN, -5, 0, 5, 105, 205, 500, 10000]) {
			for (let i = 0; i < PIP_OVERLAY_MAX_STACK; i++) {
				const slot = resolvePipOverlayCasparLayer(p, i)
				assert.ok(slot >= PIP_OVERLAY_BAND_BASE && slot <= PIP_OVERLAY_BAND_MAX, `p=${p} i=${i} -> ${slot}`)
			}
		}
	})
})

describe('WO-160 timeline band', () => {
	it('base is 210 and indices map consecutively', () => {
		assert.equal(timelineCasparLayer(0), 210)
		assert.equal(timelineCasparLayer(49), 259)
	})

	it('layers beyond the 50-layer cap clamp onto the last slot (never reach PIP band)', () => {
		assert.equal(timelineCasparLayer(50), 259)
		assert.equal(timelineCasparLayer(500), 259)
		assert.ok(timelineCasparLayer(500) < PIP_OVERLAY_BAND_BASE)
	})
})

describe('WO-160 client allocator (scene-state-helpers)', () => {
	it('assigns the lowest free number >= 10, consecutively', async () => {
		const { nextLayerNumber } = await loadEsm('../../client/lib/scene-state-helpers.js')
		assert.equal(nextLayerNumber({ layers: [] }), 10)
		assert.equal(nextLayerNumber({ layers: [{ layerNumber: 10 }] }), 11)
		assert.equal(nextLayerNumber({ layers: [{ layerNumber: 10 }, { layerNumber: 11 }] }), 12)
		// Fills gaps left by removals.
		assert.equal(nextLayerNumber({ layers: [{ layerNumber: 10 }, { layerNumber: 12 }] }), 11)
	})

	it('rejects the 91st layer (look full -> -1)', async () => {
		const { nextLayerNumber, LOOK_LAYER_FIRST, LOOK_LAYER_MAX, LOOK_LAYER_STEP } = await loadEsm(
			'../../client/lib/scene-state-helpers.js',
		)
		assert.equal(LOOK_LAYER_STEP, 1)
		const layers = []
		for (let n = LOOK_LAYER_FIRST; n <= LOOK_LAYER_MAX; n++) layers.push({ layerNumber: n })
		assert.equal(layers.length, 90)
		assert.equal(nextLayerNumber({ layers }), -1)
	})

	it('reorderLayers renumbers consecutively from 10 step 1', async () => {
		const { reorderLayers } = await loadEsm('../../client/lib/scene-state-layer-logic.js')
		const { LOOK_LAYER_FIRST, LOOK_LAYER_STEP } = await loadEsm('../../client/lib/scene-state-helpers.js')
		const layers = [
			{ id: 'a', layerNumber: 10 },
			{ id: 'b', layerNumber: 11 },
			{ id: 'c', layerNumber: 12 },
		]
		const next = reorderLayers(layers, 0, 2, LOOK_LAYER_FIRST, LOOK_LAYER_STEP)
		assert.deepEqual(
			next.map((l) => [l.id, l.layerNumber]),
			[
				['b', 10],
				['c', 11],
				['a', 12],
			],
		)
	})

	it('migrateScene renumbers a legacy 10/20/30 look to 10/11/12 (z-order preserved)', async () => {
		const { migrateScene } = await loadEsm('../../client/lib/scene-state-helpers.js')
		const s = migrateScene({
			id: 'legacy',
			layers: [
				{ layerNumber: 10, source: { type: 'media', value: 'a.mp4' } },
				{ layerNumber: 20, source: { type: 'media', value: 'b.mp4' } },
				{ layerNumber: 30, source: { type: 'media', value: 'c.mp4' } },
			],
		})
		assert.deepEqual(
			s.layers.map((l) => [l.layerNumber, l.source.value]),
			[
				[10, 'a.mp4'],
				[11, 'b.mp4'],
				[12, 'c.mp4'],
			],
		)
	})

	it('migrateScene folds >99 overflow (…, 100, 110) into the consecutive sequence', async () => {
		const { migrateScene } = await loadEsm('../../client/lib/scene-state-helpers.js')
		const layers = []
		for (let i = 0; i < 10; i++) layers.push({ layerNumber: 10 + i * 10, source: { type: 'media', value: `c${i}.mp4` } })
		layers.push({ layerNumber: 110, source: { type: 'media', value: 'c10.mp4' } })
		const s = migrateScene({ id: 'overflow', layers })
		assert.deepEqual(
			s.layers.map((l) => l.layerNumber),
			[10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
		)
		// Overflow layer keeps its z-position (highest).
		assert.equal(s.layers[10].source.value, 'c10.mp4')
	})

	it('migrateScene leaves already-consecutive looks untouched', async () => {
		const { migrateScene } = await loadEsm('../../client/lib/scene-state-helpers.js')
		const s = migrateScene({
			id: 'new',
			layers: [
				{ layerNumber: 10, source: { type: 'media', value: 'a.mp4' } },
				{ layerNumber: 11, source: { type: 'media', value: 'b.mp4' } },
			],
		})
		assert.deepEqual(s.layers.map((l) => l.layerNumber), [10, 11])
	})
})

describe('WO-160 server migration', () => {
	it('renumberLookLayersConsecutive: legacy decades, overflow, no-op, stability', () => {
		const decades = [{ layerNumber: 10 }, { layerNumber: 20 }, { layerNumber: 30 }]
		assert.equal(renumberLookLayersConsecutive(decades), true)
		assert.deepEqual(decades.map((l) => l.layerNumber), [10, 11, 12])

		const overflow = [{ layerNumber: 100 }, { layerNumber: 10 }, { layerNumber: 110 }]
		assert.equal(renumberLookLayersConsecutive(overflow), true)
		// Array order preserved; numbers assigned by ascending old number.
		assert.deepEqual(overflow.map((l) => l.layerNumber), [11, 10, 12])

		const consecutive = [{ layerNumber: 10 }, { layerNumber: 11 }, { layerNumber: 12 }]
		assert.equal(renumberLookLayersConsecutive(consecutive), false)
		assert.deepEqual(consecutive.map((l) => l.layerNumber), [10, 11, 12])
	})

	it('migrateEnvelopeLookLayerNumbers renumbers every look in the envelope', () => {
		const { migrateEnvelopeLookLayerNumbers } = require('../../src/engine/project-scenes-load')
		const envelope = {
			scenes: [
				{ id: 's1', name: 'Legacy', layers: [{ layerNumber: 10 }, { layerNumber: 20 }] },
				{ id: 's2', name: 'New', layers: [{ layerNumber: 10 }, { layerNumber: 11 }] },
			],
		}
		migrateEnvelopeLookLayerNumbers(envelope)
		assert.deepEqual(envelope.scenes[0].layers.map((l) => l.layerNumber), [10, 11])
		assert.deepEqual(envelope.scenes[1].layers.map((l) => l.layerNumber), [10, 11])
	})

	it('persisted live-scene looks renumber on read (reconcile never sees legacy numbering)', async () => {
		const persistence = require('../../src/utils/persistence')
		const live = require('../../src/state/live-scene-state')
		const prev = persistence.get(live.KEY)
		try {
			persistence.set(live.KEY, {
				7: {
					sceneId: 'legacy',
					scene: {
						id: 'legacy',
						layers: [
							{ layerNumber: 10, source: { type: 'media', value: 'a.mp4' } },
							{ layerNumber: 20, source: { type: 'media', value: 'b.mp4' } },
						],
					},
					updatedAt: 1,
				},
			})
			const entry = live.getChannel(7)
			assert.deepEqual(entry.scene.layers.map((l) => l.layerNumber), [10, 11])
		} finally {
			persistence.set(live.KEY, prev || {})
		}
	})
})

test('WO-160 take guard: layerNumber outside 10-99 rejected with 400', async () => {
	const { handleSceneTake } = require('../../src/api/routes-scene-take')
	const ctx = { config: {}, amcp: {}, log: () => {} }
	for (const bad of [9, 100, 110, 210, 260, 0, 10.5, null]) {
		const res = await handleSceneTake(
			{
				channel: 98,
				forceCut: true,
				incomingScene: {
					id: 'look_out_of_range',
					layers: [{ layerNumber: bad, source: { type: 'media', value: 'clip.mp4' } }],
				},
			},
			ctx,
		)
		assert.equal(res.status, 400, `layerNumber ${bad} must be rejected`)
		assert.match(JSON.parse(res.body).error, /10-99/)
	}
})

test('WO-160 static: no legacy PIP fallback constants or TIMELINE_LAYER_BASE 200 remain', () => {
	const roots = ['src', 'client/lib', 'client/components']
	const offenders = []
	const walk = (dir) => {
		for (const name of fs.readdirSync(dir)) {
			const p = path.join(dir, name)
			const st = fs.statSync(p)
			if (st.isDirectory()) {
				if (name === 'node_modules') continue
				walk(p)
			} else if (name.endsWith('.js')) {
				const src = fs.readFileSync(p, 'utf8')
				if (/PIP_OVERLAY_LAYER_OFFSET|PIP_OVERLAY_ALIGN_GAP/.test(src)) {
					offenders.push(`${p}: legacy PIP offset/align constant`)
				}
				if (/TIMELINE_LAYER_BASE\s*=\s*200\b/.test(src)) {
					offenders.push(`${p}: TIMELINE_LAYER_BASE 200`)
				}
			}
		}
	}
	for (const r of roots) walk(path.join(__dirname, '../../', r))
	assert.deepEqual(offenders, [])
})
