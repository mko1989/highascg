'use strict'

/**
 * WO-615 T10 — fixtures from an MVR scene arrive patched: absolute / "Universe.Address" addresses, the pose from the
 * fixture's world matrix (round trip through gdtf-ik poseXf — what the IK and the previs place), mode matching, skip
 * reasons, and POST /api/stage/mvr/<id>/patch on a synthetic MVR carrying the synthetic test GDTF (the type is imported
 * once, the entries resolve through the server's own patch normalizer).
 * Fixture: tools/fixtures/gdtf/test-spot.xml (synthetic).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { zipStored } = require('./lib/zip-stored')
const { absAddress } = require('../../src/stage/mvr-scene')
const { buildMvrPatch, poseFromMatrix, splitAddress, firstAddress, matchMode } = require('../../src/stage/mvr-patch')
const { poseXf } = require('../../src/fixtures/gdtf-ik')
const { GODOT_FROM_MVR } = require('../../src/stage/mvr-math')
const { normalizePatch } = require('../../src/fixtures/follow-patch')
const mvrStore = require('../../src/stage/mvr-store')
const gdtfStore = require('../../src/fixtures/gdtf-store')
const { RouteRegistry } = require('../../src/api/route-registry')
const { register } = require('../../src/api/routes-stage-mvr')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')

/** Column-major 4×4 from MVR u, v, w columns and an origin in metres. */
const mat = (u, v, w, o) => [...u, 0, ...v, 0, ...w, 0, ...o, 1]

/** Largest difference between poseXf(pose) and the matrix it came from, in Godot's frame (basis + origin). */
function roundTripError(m, pose) {
	const g = poseXf(pose)
	const C = (c, r) => GODOT_FROM_MVR[c * 4 + r]
	const n = [0, 1, 2].map((c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]))
	const R = (c, r) => m[c * 4 + r] / n[c]
	let worst = 0
	for (let c = 0; c < 3; c++) {
		for (let r = 0; r < 3; r++) {
			let v = 0
			for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += C(a, r) * R(b, a) * C(b, c)
			worst = Math.max(worst, Math.abs(v - g[c * 3 + r]))
		}
	}
	return Math.max(worst, Math.abs(g[9] - m[12]), Math.abs(g[10] - m[14]), Math.abs(g[11] + m[13]))
}

test('addresses: absolute and Universe.Address; the first break wins', () => {
	assert.strictEqual(absAddress('513'), 513)
	assert.strictEqual(absAddress('3.1'), 1025)
	assert.strictEqual(absAddress(' 41.512 '), 40 * 512 + 512)
	for (const bad of ['', 'x', '0.5', '2.513', undefined]) assert.strictEqual(absAddress(bad), 0, String(bad))
	assert.deepStrictEqual(splitAddress(1), { universe: 1, address: 1 })
	assert.deepStrictEqual(splitAddress(512), { universe: 1, address: 512 })
	assert.deepStrictEqual(splitAddress(20993), { universe: 42, address: 1 })
	assert.strictEqual(splitAddress(0), null)
	assert.deepStrictEqual(firstAddress([{ break: 1, address: 1025 }, { break: 0, address: 600 }]), { universe: 2, address: 88 })
	assert.strictEqual(firstAddress([{ break: 0, address: 0 }]), null)
})

test('pose: hung, yawed, standing, pitched and side mounts round-trip through poseXf', () => {
	const cases = [
		[mat([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 2, 6]), { hang: 'truss', yaw: 0, pitch: 0, roll: 0 }],
		[mat([-1, 0, 0], [0, -1, 0], [0, 0, 1], [-1.5, -1, 8.524]), { hang: 'truss', yaw: -180, pitch: 0, roll: 0 }], // Basic Festival
		[mat([0.919613, -0.392826, 0], [-0.392826, -0.919613, 0], [0, 0, -1], [1.5, 3.7, 2]), { hang: 'floor', pitch: 0, roll: 0 }], // Circle Stage
		[mat([0, 0, 1], [1, 0, 0], [0, 1, 0], [-3, 2, 0.958]), { hang: 'truss', yaw: 90, pitch: 0, roll: 90 }], // Midsize side mount
		[mat([1, 0, 0], [0, 0.5, 0.866025], [0, -0.866025, 0.5], [0, 0, 7]), { hang: 'truss', yaw: 0, pitch: 60, roll: 0 }],
	]
	for (const [m, want] of cases) {
		const pose = poseFromMatrix(m)
		for (const [k, v] of Object.entries(want)) assert.strictEqual(pose[k], v, `${k} of ${JSON.stringify(pose)}`)
		assert.ok(roundTripError(m, pose) < 2e-3, JSON.stringify(pose))
	}
	assert.deepStrictEqual([poseFromMatrix(cases[0][0]).x, poseFromMatrix(cases[0][0]).y, poseFromMatrix(cases[0][0]).z], [1, 2, 6], 'MVR = PSN axes')
	// any rotation (scaled columns too) is representable
	let seed = 7
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
	for (let i = 0; i < 200; i++) {
		const q = [rnd(), rnd(), rnd(), rnd()]
		const l = Math.hypot(...q)
		const [w, x, y, z] = q.map((v) => v / l)
		const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
			[2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]]
		const m = mat([0, 1, 2].map((r) => R[r][0] * 1.5), [0, 1, 2].map((r) => R[r][1]), [0, 1, 2].map((r) => R[r][2]), [rnd(), rnd(), 5])
		const pose = poseFromMatrix(m)
		assert.ok(Math.abs(pose.roll) <= 90 && Math.abs(pose.pitch) <= 90, JSON.stringify(pose))
		assert.ok(roundTripError(m, pose) < 2e-3, `rotation ${i}: ${JSON.stringify(pose)}`)
	}
	assert.strictEqual(poseFromMatrix(mat([-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0])).mirrored, true)
})

test('modes: exact, trimmed / case-insensitive; an empty GDTFMode is never guessed', () => {
	const names = ['Mode 8 - Pixel RGBW', 'Standard']
	assert.strictEqual(matchMode(names, 'Standard'), 'Standard')
	assert.strictEqual(matchMode(names, 'Mode 8 - Pixel RGBW '), 'Mode 8 - Pixel RGBW', 'Circle Stage writes a trailing space')
	assert.strictEqual(matchMode(names, 'mode 8 -  pixel rgbw'), 'Mode 8 - Pixel RGBW')
	assert.strictEqual(matchMode(names, ''), '', 'Basic Festival #327 has none — its first mode overlapped the neighbours')
	assert.strictEqual(matchMode(names, 'Other'), '')
})

test('entries: ids, protocols, names, skip reasons, notes', () => {
	const type = { id: 'aaaaaaaaaaaa', modes: [{ name: 'Std', breaks: 1 }, { name: 'Two', breaks: 2 }] }
	const fx = (uuid, name, f) => ({ uuid, name, kind: 'Fixture', fixture: { spec: 'M@T', mode: 'Std', id: '', addresses: [{ break: 0, address: 1025 }],
		matrix: mat([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 6]), ...f } })
	const objects = [
		fx('AB-01', 'Spot', {}), fx('AB-02', 'Spot', {}), fx('AB-03', 'Spot', { id: '7', mode: 'Two' }),
		fx('AB-04', 'X', { spec: 'Nope@Gone' }), fx('AB-05', 'X', { mode: '' }), fx('AB-06', 'X', { mode: 'Zzz' }),
		fx('AB-07', 'X', { addresses: [] }), fx('', 'X', {}), fx('AB-09', 'X', { spec: 'Bad@File' }), { uuid: 'S', name: 'Truss', kind: 'Truss' },
	]
	const typeFor = (s) => (s === 'M@T' ? type : s === 'Bad@File' ? { error: 'GDTF "Bad@File" could not be read: boom' } : null)
	const a = buildMvrPatch(objects, { typeFor })
	assert.deepStrictEqual(a.fixtures.map((f) => [f.id, f.name, f.protocol, f.universe, f.address, f.dest, f.mode]), [
		['mvr-ab-01', 'Spot', 'artnet', 2, 1, '255.255.255.255', 'Std'],
		['mvr-ab-02', 'Spot (2)', 'artnet', 2, 1, '255.255.255.255', 'Std'],
		['mvr-ab-03', 'Spot 7', 'artnet', 2, 1, '255.255.255.255', 'Two'],
	], 'MVR universe 3 = Art-Net 2')
	assert.deepStrictEqual(a.skipped.map((s) => s.reason), ['GDTF "Nope@Gone" is not in the MVR file', 'no GDTFMode in the MVR file',
		'mode "Zzz" not in M@T', 'no DMX address (unpatched in the MVR file)', 'no uuid in the MVR file', 'GDTF "Bad@File" could not be read: boom'])
	assert.deepStrictEqual(a.notes, ['Only the first DMX break is output for: M@T · Two'])
	const s = buildMvrPatch(objects.slice(0, 1), { protocol: 'sacn', typeFor })
	assert.deepStrictEqual([s.fixtures[0].protocol, s.fixtures[0].universe, s.fixtures[0].dest], ['sacn', 3, ''], 'sACN universe = MVR universe')
	assert.deepStrictEqual(s.fixtures[0].pose, { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0, pitch: 0, roll: 0 })
})

function sampleMvr() {
	const gdtf = zipStored({ 'description.xml': XML })
	const xml = `<?xml version="1.0"?><GeneralSceneDescription verMajor="1" verMinor="6"><Scene><Layers>
	<Layer name="Rig" uuid="L1"><ChildList><GroupObject name="Truss" uuid="G1"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,6000}</Matrix><ChildList>
		<Fixture uuid="F1-AA" name="Spot"><Matrix>{1,0,0}{0,0.5,0.866025}{0,-0.866025,0.5}{1000,2000,0}</Matrix><GDTFSpec>HighAsCG@Test Spot</GDTFSpec>
			<GDTFMode>Standard</GDTFMode><Addresses><Address break="0">2.1</Address></Addresses><FixtureID>101</FixtureID></Fixture>
		<Fixture uuid="F2-AA" name="Bar"><GDTFSpec>HighAsCG@Test Spot.gdtf</GDTFSpec><GDTFMode>Pixels</GDTFMode>
			<Addresses><Address break="0">600</Address></Addresses><FixtureID>102</FixtureID></Fixture>
		<Fixture uuid="F3-AA" name="Ghost"><GDTFSpec>Nobody@Ghost</GDTFSpec><GDTFMode>A</GDTFMode><Addresses><Address break="0">1</Address></Addresses></Fixture>
	</ChildList></GroupObject></ChildList></Layer></Layers></Scene></GeneralSceneDescription>`
	return zipStored({ 'GeneralSceneDescription.xml': xml, 'HighAsCG@Test Spot.gdtf': gdtf })
}

test('POST /api/stage/mvr/<id>/patch: GDTFs imported once, entries resolve in the server patch', async () => {
	const rec = await mvrStore.importMvr(sampleMvr(), 'Rig.mvr')
	const routes = new RouteRegistry()
	register(routes)
	const reloads = []
	const ctx = { fixtureService: { reload: () => reloads.push(1) } }
	const post = async (p, body) => {
		const r = await routes.dispatch('POST', p, JSON.stringify(body), ctx, null, {})
		return { status: r.status, body: JSON.parse(r.body) }
	}
	const r = await post(`/api/stage/mvr/${rec.id}/patch`, { protocol: 'artnet' })
	assert.strictEqual(r.status, 200)
	assert.deepStrictEqual(r.body.fixtures.map((f) => [f.id, f.name, f.universe, f.address, f.mode]), [
		['mvr-f1-aa', 'Spot 101', 1, 1, 'Standard'],
		['mvr-f2-aa', 'Bar 102', 1, 88, 'Pixels'],
	])
	assert.deepStrictEqual(r.body.skipped.map((s) => s.name + ': ' + s.reason), ['Ghost: GDTF "Nobody@Ghost" is not in the MVR file'])
	const spot = r.body.fixtures[0]
	assert.deepStrictEqual(spot.pose, { x: 1, y: 2, z: 6, hang: 'truss', yaw: 0, pitch: 60, roll: 0 }, 'group + fixture matrix, pitched 60°')
	assert.strictEqual(r.body.types.length, 1)
	assert.strictEqual(r.body.types[0].fixtures, 2)
	assert.strictEqual(gdtfStore.list().length, 1)
	assert.strictEqual(reloads.length, 1, 'the engine re-resolves the patch')
	const n = normalizePatch({ patch: r.body.fixtures }, { resolveMode: (id, m) => gdtfStore.mode(id, m) })
	assert.deepStrictEqual(n.fixtures.map((f) => f.problem), [null, null])
	assert.deepStrictEqual([n.fixtures[0].pose.pitch, n.fixtures[0].moving], [60, true], 'pitch survives normalization; the head moves')

	const again = await post(`/api/stage/mvr/${rec.id}/patch`, { protocol: 'sacn' })
	assert.deepStrictEqual(again.body.fixtures.map((f) => [f.protocol, f.universe, f.typeId]), [['sacn', 2, spot.typeId], ['sacn', 2, spot.typeId]])
	assert.strictEqual(gdtfStore.list().length, 1, 'same bytes → same type, not a second copy')
	assert.strictEqual((await post('/api/stage/mvr/0123456789ab/patch', {})).status, 404)
	assert.strictEqual((await post(`/api/stage/mvr/${rec.id}/other`, {})).status, 404)
})
