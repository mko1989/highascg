'use strict'

/**
 * WO-869 — mapping-node slices: the geometry (one quad per slice), the model + migration from the legacy
 * `mappings[]` / `rotation`, and the web editor's legacy edits folded back into the slices (owner Q4).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const Geo = require('../../src/config/mapping-slices-geometry')
const Model = require('../../src/config/mapping-slices-model')

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`)
const closePts = (a, b, eps = 1e-9) => a.forEach((p, i) => { close(p[0], b[i][0], eps); close(p[1], b[i][1], eps) })

describe('WO-869 geometry', () => {
	const rect = { x: 100, y: 40, w: 960, h: 640 }

	it('a plain dst rect compiles to its own corners (ul, ur, lr, ll)', () => {
		assert.deepEqual(Geo.dstQuad({ rect }), [[100, 40], [1060, 40], [1060, 680], [100, 680]])
	})

	it('90° steps and flips are exact corner permutations', () => {
		const sq = { x: 0, y: 0, w: 100, h: 100 }
		assert.deepEqual(Geo.dstQuad({ rect: sq, rotation: 90 }), [[100, 0], [100, 100], [0, 100], [0, 0]])
		assert.deepEqual(Geo.dstQuad({ rect: sq, rotation: 180 }), [[100, 100], [0, 100], [0, 0], [100, 0]])
		assert.deepEqual(Geo.dstQuad({ rect: sq, flipH: true }), [[100, 0], [0, 0], [0, 100], [100, 100]])
		assert.deepEqual(Geo.dstQuad({ rect: sq, flipV: true }), [[0, 100], [100, 100], [100, 0], [0, 0]])
		assert.deepEqual(Geo.dstQuad({ rect: sq, flipH: true, flipV: true }), Geo.dstQuad({ rect: sq, rotation: 180 }))
	})

	it('rotation turns about the rect centre, clockwise on screen (y down)', () => {
		const q = Geo.dstQuad({ rect: { x: 0, y: 0, w: 200, h: 100 }, rotation: 30 })
		const c = [100, 50]
		for (const p of q) close(Math.hypot(p[0] - c[0], p[1] - c[1]), Math.hypot(100, 50))
		// ur (200,0) turned 30° clockwise goes down and left
		closePts([q[1]], [[c[0] + 100 * Math.cos(Math.PI / 6) + 50 * Math.sin(Math.PI / 6), c[1] + 100 * Math.sin(Math.PI / 6) - 50 * Math.cos(Math.PI / 6)]])
	})

	it('warp offsets move screen corners; flips then reassign which src corner lands where', () => {
		const warp = [[10, 0], [0, 0], [0, -20], [0, 0]]
		const q = Geo.dstQuad({ rect: { x: 0, y: 0, w: 100, h: 100 }, warp })
		assert.deepEqual(q, [[10, 0], [100, 0], [100, 80], [0, 100]])
		const f = Geo.dstQuad({ rect: { x: 0, y: 0, w: 100, h: 100 }, warp, flipH: true })
		assert.deepEqual(f, [[100, 0], [10, 0], [0, 100], [100, 80]])
	})

	it('convexity: either winding is accepted, bow-ties / concave / collapsed quads are not', () => {
		assert.equal(Geo.isConvexQuad([[0, 0], [100, 0], [100, 100], [0, 100]]), true)
		assert.equal(Geo.isConvexQuad([[100, 0], [0, 0], [0, 100], [100, 100]]), true) // mirrored (flipH)
		assert.equal(Geo.isConvexQuad([[0, 0], [100, 100], [100, 0], [0, 100]]), false) // bow-tie
		assert.equal(Geo.isConvexQuad([[0, 0], [100, 0], [30, 30], [0, 100]]), false) // concave
		assert.equal(Geo.isConvexQuad([[0, 0], [100, 0], [200, 0], [0, 100]]), false) // collinear
		assert.equal(Geo.isConvexQuad([[0, 0], [0, 0], [0, 0], [0, 0]]), false)
	})

	it('homography maps the 4 corners exactly and round-trips random pairs to 1e-6', () => {
		let seed = 869
		const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
		for (let n = 0; n < 50; n++) {
			const src = Geo.rectCorners({ x: rnd() * 1000, y: rnd() * 1000, w: 50 + rnd() * 900, h: 50 + rnd() * 900 })
			const dst = Geo.dstQuad({ rect: { x: rnd() * 1000, y: rnd() * 1000, w: 50 + rnd() * 900, h: 50 + rnd() * 900 },
				rotation: rnd() * 360, warp: [[rnd() * 20, rnd() * 20], [0, 0], [-rnd() * 20, rnd() * 20], [0, 0]] })
			const H = Geo.homography(src, dst)
			assert.ok(H)
			src.forEach((p, i) => closePts([Geo.applyHomography(H, p)], [dst[i]], 1e-6))
			const Hi = Geo.homography(dst, src)
			const mid = [(src[0][0] + src[2][0]) / 2, (src[0][1] + src[2][1]) / 2]
			closePts([Geo.applyHomography(Hi, Geo.applyHomography(H, mid))], [mid], 1e-6)
		}
	})

	it('isOneToOne: same size, no rotation / flip / warp', () => {
		const s = { src: { x: 5, y: 5, w: 100, h: 50 }, dst: { rect: { x: 9, y: 9, w: 100, h: 50 }, rotation: 0, warp: [[0, 0], [0, 0], [0, 0], [0, 0]] } }
		assert.equal(Geo.isOneToOne(s), true)
		assert.equal(Geo.isOneToOne({ ...s, dst: { ...s.dst, rotation: 360 } }), true)
		assert.equal(Geo.isOneToOne({ ...s, dst: { ...s.dst, rect: { x: 0, y: 0, w: 101, h: 50 } } }), false)
		assert.equal(Geo.isOneToOne({ ...s, dst: { ...s.dst, flipV: true } }), false)
		assert.equal(Geo.isOneToOne({ ...s, dst: { ...s.dst, warp: [[0, 1], [0, 0], [0, 0], [0, 0]] } }), false)
	})
})

describe('WO-869 model + migration', () => {
	const outputs = [{ id: 'out_1', mode: '1080p5000', label: 'Left' }, { id: 'out_2', mode: '1080p5000', label: 'Right' }]

	it('normalises: defaults, clamps, unknown output → first, unique ids, feed source only', () => {
		const list = Model.normalizeSlices([
			{ id: 'a', outputId: 'nope', src: { x: '10', y: 2.6, w: 0, h: -5 }, opacity: 3, feather: { l: -4, t: 7.4 }, source: { kind: 'route', value: 'route://9' } },
			{ id: 'a', dst: { rotation: 270, flipH: 'yes' } },
		], { outputIds: ['out_1', 'out_2'] })
		assert.equal(list[0].outputId, 'out_1')
		assert.deepEqual(list[0].src, { x: 10, y: 3, w: 1, h: 1 })
		assert.equal(list[0].opacity, 1)
		assert.deepEqual(list[0].feather, { l: 0, t: 7, r: 0, b: 0 })
		assert.deepEqual(list[0].source, { kind: 'feed' })
		assert.equal(list[1].id, 'a_2')
		assert.equal(list[1].dst.rotation, -90)
		assert.equal(list[1].dst.flipH, false)
		assert.deepEqual(list[1].dst.rect, { x: 0, y: 0, w: 1920, h: 1080 })
		assert.equal(list[1].name, 'Slice 2')
	})

	it('caps the list at 64 slices (the screen consumer limit)', () => {
		assert.equal(Model.normalizeSlices(Array.from({ length: 70 }, () => ({})), { outputIds: ['o'] }).length, 64)
	})

	it('legacy mappings[] → one slice per output, 1:1 at (0,0), pos = old rect x/y; rotations and undrawn extras counted', () => {
		const m = Model.migrateLegacyMappings({
			outputs,
			mappings: [
				{ id: 'map_a', type: 'video_slice', outputId: 'out_1', rect: { x: 0, y: 0, w: 1920, h: 1080 }, rotation: 0 },
				{ id: 'map_b', type: 'video_slice', label: 'B', outputId: 'out_2', rect: { x: 1920, y: 0, w: 1920, h: 1080 }, rotation: 12 },
				{ id: 'map_c', type: 'video_slice', outputId: 'out_2', rect: { x: 0, y: 0, w: 10, h: 10 } },
				{ id: 'dmx', type: 'dmx_fixture', outputId: 'out_1' },
			],
		})
		assert.equal(m.slices.length, 2)
		assert.deepEqual(m.slices.map((s) => [s.id, s.outputId, s.name]), [['map_a', 'out_1', 'Left'], ['map_b', 'out_2', 'B']])
		assert.deepEqual(m.slices[1].src, { x: 1920, y: 0, w: 1920, h: 1080 })
		assert.deepEqual(m.slices[1].dst.rect, { x: 0, y: 0, w: 1920, h: 1080 })
		assert.equal(m.slices[1].dst.rotation, 0)
		assert.deepEqual(m.outputs.map((o) => o.pos), [{ x: 0, y: 0 }, { x: 1920, y: 0 }])
		assert.equal(m.droppedRotations, 1)
		assert.equal(m.droppedExtra, 1)
	})

	it('the mirror keeps the web editor readable: first slice per output, src rect, rotation 0', () => {
		const slices = Model.normalizeSlices([
			{ id: 's1', outputId: 'out_1', src: { x: 1, y: 2, w: 3, h: 4 } },
			{ id: 's2', outputId: 'out_1', src: { x: 9, y: 9, w: 9, h: 9 } },
		], { outputIds: ['out_1'] })
		assert.deepEqual(Model.legacyMappingsMirror(slices), [
			{ id: 's1', type: 'video_slice', label: 'Slice 1', outputId: 'out_1', rect: { x: 1, y: 2, w: 3, h: 4 }, rotation: 0 },
		])
	})

	const legacy = () => ({ outputs: outputs.map((o) => ({ ...o })), mappings: [
		{ id: 'map_a', type: 'video_slice', outputId: 'out_1', rect: { x: 0, y: 0, w: 1920, h: 1080 }, rotation: 0 },
	] })

	it('first save of a never-migrated node migrates (slices + mirror + pos)', () => {
		const r = Model.reconcileNodeSettings(legacy(), legacy())
		assert.equal(r.migrated, true)
		assert.equal(r.settings.slices.length, 1)
		assert.deepEqual(r.settings.outputs[0].pos, { x: 0, y: 0 })
		assert.equal(r.settings.mappings[0].id, 'map_a')
	})

	it('a web (legacy) edit of a never-migrated node is kept: the GET showed the migration, the client changed mappings[]', () => {
		const prev = legacy()
		const shown = Model.withEffectiveSlices({ devices: [{ id: 'n', role: 'pixel_mapping', settings: prev }] }).devices[0].settings
		const next = JSON.parse(JSON.stringify(shown))
		next.mappings[0].rect = { x: 100, y: 50, w: 800, h: 600 }
		const r = Model.reconcileNodeSettings(next, prev)
		assert.deepEqual(r.settings.slices[0].src, { x: 100, y: 50, w: 800, h: 600 })
		assert.deepEqual(r.settings.slices[0].dst.rect, { x: 0, y: 0, w: 800, h: 600 }, 'a 1:1 slice keeps following the size')
	})

	it('web edits on a migrated node: moved rect folds into the slice, new mapping adds one, removed mapping drops it', () => {
		const stored = Model.reconcileNodeSettings(legacy(), legacy()).settings
		stored.slices.push(Model.normalizeSlice({ id: 'extra', outputId: 'out_1', src: { x: 5, y: 5, w: 50, h: 50 }, dst: { rect: { x: 0, y: 0, w: 500, h: 500 } } }, 1, { outputIds: ['out_1', 'out_2'] }))
		const next = JSON.parse(JSON.stringify(stored))
		next.mappings = [{ id: 'map_new', type: 'video_slice', outputId: 'out_2', rect: { x: 1920, y: 0, w: 1920, h: 1080 }, rotation: 45 }]
		const r = Model.reconcileNodeSettings(next, stored)
		assert.deepEqual(r.settings.slices.map((s) => s.id), ['extra', 'map_new'])
		assert.equal(r.settings.slices[1].dst.rotation, 0, 'legacy rotation is dropped (Q10)')
		const moved = JSON.parse(JSON.stringify(stored))
		moved.mappings[0].rect.x = 300
		assert.equal(Model.reconcileNodeSettings(moved, stored).settings.slices[0].src.x, 300)
		assert.equal(Model.reconcileNodeSettings(moved, stored).settings.slices[1].dst.rect.w, 500, 'a scaled slice keeps its dst')
	})

	it('a slice-aware client (Godot) wins; an untouched save keeps the stored slices', () => {
		const stored = Model.reconcileNodeSettings(legacy(), legacy()).settings
		const next = JSON.parse(JSON.stringify(stored))
		next.slices[0].dst.rotation = 30
		const r = Model.reconcileNodeSettings(next, stored)
		assert.equal(r.settings.slices[0].dst.rotation, 30)
		assert.equal(r.migrated, false)
		const same = Model.reconcileNodeSettings(JSON.parse(JSON.stringify(stored)), stored)
		assert.deepEqual(same.settings.slices, stored.slices)
	})

	it('reconcileGraphSlices touches only pixel_mapping nodes, never mutates its inputs, logs a migration', () => {
		const g = { devices: [{ id: 'h', role: 'caspar_host' }, { id: 'n', role: 'pixel_mapping', settings: legacy() }] }
		const before = JSON.stringify(g)
		const lines = []
		const out = Model.reconcileGraphSlices(g, g, (lvl, msg) => lines.push(msg))
		assert.equal(JSON.stringify(g), before)
		assert.equal(out.devices[0], g.devices[0])
		assert.equal(out.devices[1].settings.slices.length, 1)
		assert.match(lines[0], /migrated 1 slice\(s\).*0 rotation/)
	})
})
