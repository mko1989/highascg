'use strict'

/**
 * WO-616 T2: server-side tracking camera model (src/tracking/camera-model.js) against OpenFollow's golden pixels
 * (tests/test_solver.py @ 2f8aa257, AGPL-3.0-or-later, (C) 2026 The OpenFollow Project) — the same vectors the Godot
 * port is tested with (godot/client/tests/test_tracking_camera.gd), so the two ports cannot drift apart.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const M = require('../../src/tracking/camera-model')

const cam = (p) => ({ pos_x: p[0], pos_y: p[1], pos_z: p[2], pitch: p[3], yaw: p[4], roll: p[5], fov: p[6] })
const near = (a, b, eps, what) => {
	assert.equal(a.length, b.length, what)
	a.forEach((p, i) => p.forEach((v, j) => assert.ok(Math.abs(v - b[i][j]) <= eps, `${what}: [${i}][${j}] ${v} vs ${b[i][j]}`)))
}

test('WO-616 T2: head-on camera projects to OpenFollow golden pixels', () => {
	const world = [[-4, -3, 0], [4, -3, 0], [4, 5, 0], [-4, 5, 0], [0, 1, 1.8]]
	const golden = {
		0: [[117.6381, 906.6958], [1465.4171, 906.6958], [1224.7765, 411.5542], [518.7058, 411.5542], [835.2268, 384.8844]],
		'-12': [[212.2861, 1073.8195], [1530.6129, 793.6005], [1192.2851, 359.3109], [501.6437, 506.1112], [805.7031, 414.2158]],
		25: [[41.5885, 516.3417], [1263.0911, 1085.9377], [1254.2526, 535.4879], [614.3352, 237.0895], [912.4718, 346.6861]],
	}
	for (const [roll, px] of Object.entries(golden)) near(M.project(cam([1, -9, 5.5, -27, 0, Number(roll), 72]), world, 1920, 1080), px, 1e-4, `roll ${roll}`)
	assert.ok(Math.abs(M.hfovToVfov(90, 16 / 9) - 58.7155) < 1e-3)
	assert.deepEqual(M.project(cam([0, -10, 5, -20, 0, 0, 60]), [[0, -20, 0]], 1920, 1080), [null], 'behind the lens')
	assert.deepEqual(M.project(cam([0, -10, 5, -20, 0, 0, 0]), [[0, 0, 0]], 1920, 1080), [], 'degenerate fov')
})

test('WO-616 T2: unproject inverts project on the plane; a distorted click lands on the right floor point', () => {
	const c = cam([0, -8, 4, -25, 5, 0, 60])
	const grid = [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]]
	near(M.unproject(c, M.project(c, grid, 1920, 1080), 1920, 1080, 0), grid, 1e-5, 'roundtrip')
	const lens = { ...c, lens_k1: -0.3, lens_k2: 0.05 }
	const seen = M.applyDistortion(M.project(lens, [[1.5, 2, 0]], 1920, 1080), 1920, 1080, -0.3, 0.05)[0]
	near([M.pixelToFloor(lens, seen, 1920, 1080)], [[1.5, 2, 0]], 1e-6, 'pixelToFloor undoes the lens')
	const hd = 0.5 * Math.hypot(1920, 1080)
	const corner = M.invertDistortion([[1920, 1080]], 1920, 1080, -0.3, 0)[0]
	assert.ok(Math.abs(Math.hypot(corner[0] - 960, corner[1] - 540) / hd - M.lensFoldRadius(-0.3, 0)) < 1e-3, 'fold ring')
	assert.equal(M.lensFoldRadius(5, 0), Infinity, 'pincushion never folds')
})
