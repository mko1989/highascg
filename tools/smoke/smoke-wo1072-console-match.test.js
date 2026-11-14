'use strict'

/**
 * WO-1072 — match the project to the lighting console's head positions from its CSV (src/fixtures/console-match.js,
 * src/api/routes-console-match.js): the MagicQ column headings, pairing by DMX address / head number, the one move
 * of the whole project, the mirrored-plan refusal and the route's preview / apply.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const m = require('../../src/fixtures/console-match')
const { handle } = require('../../src/api/routes-console-match')

const patch = () => [
	{ id: 'a', name: 'Spot 1', universe: 1, address: 1, pose: { x: -4, y: 9, z: 5.7 } },
	{ id: 'b', name: 'Spot 2', universe: 1, address: 28, pose: { x: 3, y: 9, z: 5.7 } },
	{ id: 'c', name: 'Spot 3', universe: 4, address: 151, pose: { x: -4, y: -3.5, z: 6 } },
	{ id: 'd', name: 'Wash', universe: 4, address: 1, pose: { x: 7, y: -3.5, z: 5.8 } },
]
/** The console's CSV for the patch moved by (dx, dy, dz): X across, Y up, Z = −upstage. */
const csv = (dx, dy, dz, { mirror = false, sep = ',', mm = false } = {}) => {
	const k = mm ? 1000 : 1
	const rows = patch().map((f, i) => [i + 1, f.name, `${f.universe}-${String(f.address).padStart(3, '0')}`, ((mirror ? -1 : 1) * f.pose.x + dx) * k, (f.pose.z + dz) * k, -(f.pose.y + dy) * k])
	return [['Head No', 'Head Name', 'DMX', 'X Pos', 'Y Pos', 'Z Pos'], ...rows].map((r) => r.join(sep)).join('\r\n')
}

test('parseCsv reads the MagicQ headings, semicolons, millimetres and universe-address', () => {
	const p = m.parseCsv('Patch\n' + csv(1, 2, 3))
	assert.strictEqual(p.rows.length, 4)
	assert.deepStrictEqual({ ...p.rows[0], pos: p.rows[0].pos.map((v) => Math.round(v * 100) / 100) }, { head: 1, name: 'Spot 1', universe: 1, address: 1, pos: [-3, 8.7, -11] })
	assert.strictEqual(m.parseCsv(csv(1, 2, 3, { sep: ';' })).rows.length, 4)
	assert.ok(Math.abs(m.parseCsv(csv(1, 2, 3, { mm: true })).rows[0].pos[1] - 8.7) < 1e-9)
	assert.deepStrictEqual(m.dmxOf('2-017'), { universe: 2, address: 17 })
	assert.deepStrictEqual(m.dmxOf('1041'), { universe: 3, address: 17 })
	assert.strictEqual(m.parseCsv('a,b\n1,2').rows.length, 0)
	assert.match(m.parseCsv('a,b\n1,2').problems[0], /heading row/)
})

test('pair + fit find the one move of the project, by DMX address or by head number', () => {
	const rows = m.parseCsv(csv(-5.05, -0.1, -0.23)).rows
	const pr = m.pair(rows, patch())
	assert.strictEqual(pr.pairs.length, 4)
	assert.strictEqual(pr.by, 'DMX address')
	const f = m.fit(pr.pairs)
	assert.deepStrictEqual(f.shift, { x: -5.05, y: -0.1, z: -0.23 })
	assert.ok(f.rms < 1e-3 && !f.mirrored && Math.abs(f.yaw_deg) < 0.01)
	// a desk whose universes count from Art-Net + 1
	const off = m.pair(rows.map((r) => ({ ...r, universe: r.universe + 1 })), patch())
	assert.strictEqual(off.universe_offset, 1)
	assert.strictEqual(off.pairs.length, 4)
	// no addresses in the file: the head numbers decide
	const byHead = m.pair(rows.map((r) => ({ ...r, universe: 0, address: 0 })), patch(), (id) => ({ a: 1, b: 2, c: 3, d: 4 })[id])
	assert.strictEqual(byHead.by, 'head number')
	assert.strictEqual(byHead.pairs.length, 4)
})

test('a mirrored console plan is flagged, one stray head shows in worst', () => {
	const mir = m.fit(m.pair(m.parseCsv(csv(0, 0, 0, { mirror: true })).rows, patch()).pairs)
	assert.strictEqual(mir.mirrored, true)
	const rows = m.parseCsv(csv(1, 1, 0)).rows
	rows[3].pos[0] += 2 // the desk has the wash 2 m further out
	const f = m.fit(m.pair(rows, patch()).pairs)
	assert.deepStrictEqual(f.shift, { x: 1, y: 1, z: 0 })
	assert.strictEqual(f.worst[0].id, 'd')
	assert.ok(Math.abs(f.worst[0].err - 2) < 1e-6 && !f.mirrored)
})

test('shiftProject moves every stage-frame coordinate, setHeads takes the console positions', () => {
	const p = {
		previs: {
			mvr: { id: 'x', place: { x: -14, y: -50, z: 0, yaw: 0 } },
			stage: { objects: [{ position: [2, 1.5, -9] }] },
			tracking: { grid: { x_offset: 1, y_offset: 4, z_offset: 1.4 }, cameras: [{ cam: { pos_x: -9, pos_y: -6, pos_z: 8 }, points: [{ world: [1, 2, 3] }] }], ptz: [{ pose: { x: 2, y: -11, z: 2 }, aim_z: 1.4 }] },
		},
		fixtures: { patch: patch().map((f) => ({ ...f, aim_z: 1 })), marks: [{ id: 1, x: 2, y: 0, z: 0 }] },
	}
	m.shiftProject(p, { x: -5, y: -0.5, z: -0.25 })
	assert.deepStrictEqual(p.previs.mvr.place, { x: -19, y: -50.5, z: -0.25, yaw: 0 })
	assert.deepStrictEqual(p.previs.stage.objects[0].position, [-3, 1.25, -8.5])
	assert.deepStrictEqual(p.previs.tracking.grid, { x_offset: -4, y_offset: 3.5, z_offset: 1.15 })
	assert.deepStrictEqual(p.previs.tracking.cameras[0], { cam: { pos_x: -14, pos_y: -6.5, pos_z: 7.75 }, points: [{ world: [-4, 1.5, 2.75] }] })
	assert.deepStrictEqual(p.previs.tracking.ptz[0], { pose: { x: -3, y: -11.5, z: 1.75 }, aim_z: 1.4 }) // aim_z is relative
	assert.deepStrictEqual(p.fixtures.patch[0].pose, { x: -9, y: 8.5, z: 5.45 })
	assert.strictEqual(p.fixtures.patch[0].aim_z, 1)
	assert.deepStrictEqual(p.fixtures.marks[0], { id: 1, x: -3, y: -0.5, z: -0.25 })
	assert.strictEqual(m.setHeads(p, [{ id: 'b', target: [1, 2, 3] }]), 1)
	assert.deepStrictEqual(p.fixtures.patch[1].pose, { x: 1, y: 2, z: 3 })
})

test('the route previews without writing, applies through the save, refuses a mirrored plan', async () => {
	const saved = []
	const deps = () => ({ loadProject: () => ({ name: 'p', previs: {}, fixtures: { patch: patch() } }), fidOf: () => 0, save: async (p) => (saved.push(p), { status: 200, body: '{}' }) })
	const body = (r) => JSON.parse(r.body)
	const pre = await handle({ csv: csv(1, 2, 3) }, deps())
	assert.strictEqual(pre.status, 200)
	assert.deepStrictEqual(body(pre).fit.shift, { x: 1, y: 2, z: 3 })
	assert.strictEqual(body(pre).applied, null)
	assert.strictEqual(saved.length, 0)
	const done = await handle({ csv: csv(1, 2, 3), apply: 'shift' }, deps())
	assert.deepStrictEqual(body(done).applied, { mode: 'shift', shift: { x: 1, y: 2, z: 3 }, heads: 0 })
	assert.deepStrictEqual(saved[0].fixtures.patch[0].pose, { x: -3, y: 11, z: 8.7 })
	assert.strictEqual((await handle({ csv: csv(0, 0, 0, { mirror: true }), apply: 'shift' }, deps())).status, 409)
	assert.strictEqual(saved.length, 1)
	assert.strictEqual((await handle({ csv: 'nope' }, deps())).status, 400)
	assert.strictEqual((await handle({ csv: csv(0, 0, 0), apply: 'x' }, deps())).status, 400)
	const router = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
	assert.match(router, /routes-console-match'\)\.register\(routes\)/)
})
