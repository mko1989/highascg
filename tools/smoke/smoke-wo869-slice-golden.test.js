'use strict'

/**
 * WO-869 — the Godot slice editor's model (godot/client/features/devices/slice_model.gd) is a port of
 * mapping-slices-model.js normalizeSlice + mapping-slices-geometry.js. This smoke computes the JS answers for a fixed
 * fixture set and pins them in godot/client/tests/golden/devices_mapping_slices.json, which the Godot suite
 * (test_devices_mapping_slices.gd) replays through the GDScript port. A JS change that is not mirrored fails here
 * (golden stale) or there (port drifted). Regenerate: WO869_WRITE_GOLDEN=1 node --test <this file>.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const Geo = require('../../src/config/mapping-slices-geometry')
const Model = require('../../src/config/mapping-slices-model')

const GOLDEN = path.join(__dirname, '../../godot/client/tests/golden/devices_mapping_slices.json')
const round = (v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)
const deep = (v) => (Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : round(v))

function build() {
	const outputIds = ['out_1', 'out_2']
	const raws = [
		{},
		{ id: ' a ', name: '  ', outputId: 'out_2', src: { x: '10', y: 2.5, w: 0, h: -4 }, opacity: 2, z: '3' },
		{ id: 'b', outputId: 'nope', src: { x: 0, y: 0, w: 640, h: 360 }, dst: { rect: { x: -10, y: 5 }, rotation: 450, flipH: true, flipV: 'yes' } },
		{ id: 'c', enabled: false, dst: { rotation: -190, warp: [[1, 2], [3], null, ['4', '']] }, feather: { l: 12.4, t: -3, r: '8', b: null } },
		{ id: 'c', name: 'dup id', opacity: '0.25', dst: { rotation: 180 } },
	]
	const normalized = Model.normalizeSlices(raws, { outputIds, defaultSize: { w: 1280, h: 720 } })
	const dsts = [
		{ rect: { x: 100, y: 40, w: 960, h: 640 } },
		{ rect: { x: 0, y: 0, w: 100, h: 50 }, rotation: 90 },
		{ rect: { x: 0, y: 0, w: 100, h: 50 }, rotation: -90, flipH: true },
		{ rect: { x: 10, y: 20, w: 300, h: 200 }, rotation: 15, flipV: true, warp: [[5, -3], [0, 0], [-7, 9], [2, 2]] },
		{ rect: { x: 0, y: 0, w: 1920, h: 1080 }, flipH: true, flipV: true, warp: [[40, 0], [-40, 0], [0, 0], [0, 0]] },
	]
	const quads = dsts.map((d) => ({ dst: d, screen: Geo.screenCorners(d), quad: Geo.dstQuad(d) }))
	const convex = [
		[[0, 0], [10, 0], [10, 10], [0, 10]],
		[[0, 0], [0, 10], [10, 10], [10, 0]],
		[[0, 0], [10, 10], [10, 0], [0, 10]],
		[[0, 0], [10, 0], [3, 3], [0, 10]],
		[[0, 0], [5, 0], [10, 0], [0, 10]],
	].map((q) => [q, Geo.isConvexQuad(q)])
	const from = [[0, 0], [640, 0], [640, 360], [0, 360]]
	const to = Geo.dstQuad(dsts[3])
	const H = Geo.homography(from, to)
	const homography = { from, to, H, probe: [[320, 180], Geo.applyHomography(H, [320, 180])] }
	return deep({ outputIds, defaultSize: { w: 1280, h: 720 }, raws, normalized, quads, convex, homography })
}

test('godot slice golden matches the JS model + geometry', () => {
	const want = build()
	if (process.env.WO869_WRITE_GOLDEN === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(want, null, 1)}\n`)
	const got = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
	assert.deepEqual(got, want)
})
