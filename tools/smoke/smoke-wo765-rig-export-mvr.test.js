'use strict'

/**
 * WO-765 — the calibrated rig to the desk: mvr-patch.js matrixFromPose (the exact inverse of the importer's
 * poseFromMatrix), mvr-rig-export.js (the ORIGINAL archive with only calibrated fixtures' own <Matrix> replaced — every
 * other byte kept), rig-csv.js (the position table in the MVR / grandMA3 and the MagicQ frames) and the route.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { poseFromMatrix, matrixFromPose } = require('../../src/stage/mvr-patch')
const { parseScene } = require('../../src/stage/mvr-scene')
const { buildRigExport, unplace, invAffine } = require('../../src/stage/mvr-rig-export')
const { scanScene } = require('../../src/stage/mvr-xml-spans')
const { rigCsv, eulerZYX, rotationOf } = require('../../src/stage/rig-csv')
const { handleRigExport } = require('../../src/api/routes-rig-export')
const { mul } = require('../../src/stage/mvr-math')
const { buildZipStore } = require('../../src/support/zip-store')

const src = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
const wrap = (v) => Math.abs(((((v + 180) % 360) + 360) % 360) - 180)
const U = (n) => `0000000${n}-AAAA-BBBB-CCCC-DDDDDDDDDDDD`

/** A scene a desk might write: a nested truss fixture (parent shifted), a floor head, one without a Matrix, a comment,
 * odd whitespace and an unknown element — everything but the edited matrices must come back byte for byte. */
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<GeneralSceneDescription verMajor="1" verMinor="6" provider="Desk" providerVersion="9">
  <Scene>
    <AUXData><Class name="Fronts" uuid="CCCCCCCC-0000-0000-0000-000000000001"/></AUXData>
    <Layers>
      <Layer name="Rig" uuid="LLLLLLLL-0000-0000-0000-000000000001">
        <ChildList>
          <!-- truss: its fixtures' Matrix is local to it -->
          <Truss name="Front truss" uuid="TTTTTTTT-0000-0000-0000-000000000001">
            <Matrix>{0,1,0}{-1,0,0}{0,0,1}{1000,2000,5000}</Matrix>
            <Geometries><Geometry3D fileName="truss.glb"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,0}</Matrix></Geometry3D></Geometries>
            <ChildList>
              <Fixture name="Spot 1" uuid="${U(1)}" multipatch="">
                <Matrix>{1,0,0}{0,1,0}{0,0,1}{500,0,-100}</Matrix>
                <GDTFSpec>Maker@Spot.gdtf</GDTFSpec><GDTFMode>Mode 1</GDTFMode>
                <Addresses><Address break="0">1025</Address></Addresses><FixtureID>101</FixtureID><UnitNumber>7</UnitNumber>
                <Geometries><Geometry3D fileName="x.glb"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,0}</Matrix></Geometry3D></Geometries>
                <CustomCommands><CustomCommand>Body_Pan,f 50.0</CustomCommand></CustomCommands>
              </Fixture>
            </ChildList>
          </Truss>
          <Fixture name="Floor 2" uuid="${U(2)}"><Matrix>{-1,0,0}{0,-1,0}{0,0,1}{-3000,1000,400}</Matrix><GDTFSpec>Maker@Spot.gdtf</GDTFSpec><GDTFMode>Mode 1</GDTFMode><Addresses><Address break="0">41</Address></Addresses><FixtureID>102</FixtureID></Fixture>
          <Fixture name="No matrix 3" uuid="${U(3)}"><GDTFSpec>Maker@Spot.gdtf</GDTFSpec><GDTFMode>Mode 1</GDTFMode><FixtureID>103</FixtureID></Fixture>
          <Fixture name="Untouched 4" uuid="${U(4)}"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,6000}</Matrix><GDTFSpec>Maker@Spot.gdtf</GDTFSpec><GDTFMode>Mode 1</GDTFMode><FixtureID>104</FixtureID><Unknown a="&gt;">keep</Unknown></Fixture>
        </ChildList>
      </Layer>
    </Layers>
  </Scene>
</GeneralSceneDescription>
`

const scene = (xml) => parseScene(xml, { has: () => false, resolveGdtf: async () => null })
const fxOf = (sc, n) => sc.objects.find((o) => String(o.uuid).toUpperCase() === U(n))
const cal = (pose, extra = {}) => ({ ...pose, source: 'measured', verdict: 'good', rms_deg: 0.2, marks: 4, ...extra })

describe('WO-765 matrixFromPose: the exact inverse of the importer', () => {
	it('round trip pose → matrix → pose within 1 mm / 0.01° (truss and floor, pitch and roll)', () => {
		let s = 12345
		const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
		for (let i = 0; i < 3000; i++) {
			const p = { x: (r() - 0.5) * 40, y: (r() - 0.5) * 40, z: r() * 15, yaw: r() * 358 - 179, pitch: r() * 170 - 85,
				roll: r() * 170 - 85, hang: r() < 0.3 ? 'floor' : 'truss' }
			const q = poseFromMatrix(matrixFromPose(p))
			assert.equal(q.hang, p.hang)
			assert.ok(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 0.001)
			for (const k of ['yaw', 'pitch', 'roll']) assert.ok(wrap(q[k] - p[k]) < 0.01, `${k} ${p[k]} → ${q[k]}`)
		}
	})

	it('keeps a file frame’s column scale and handedness (a mirrored frame stays mirrored)', () => {
		const like = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1]
		const p = { x: 1, y: 2, z: 3, yaw: 20, pitch: 4, roll: -3, hang: 'truss' }
		const m = matrixFromPose(p, like)
		assert.ok(Math.abs(Math.hypot(m[0], m[1], m[2]) - 2) < 1e-9)
		const q = poseFromMatrix(m)
		for (const k of ['yaw', 'pitch', 'roll']) assert.ok(wrap(q[k] - p[k]) < 0.01, `${k}`)
	})

	it('unplace undoes the scene placement (shift + turn) and invAffine inverts', () => {
		const place = { x: 2, y: -1, z: 0.5, yaw: 90 }
		// mvr_model.gd place_pose: file (−3, 0, 5) → Godot (−3, 5, 0) → Basis(UP, −90°) → (0, 5, −3) + (2, 0.5, 1) → stage (2, 2, 5.5)
		const f = unplace({ x: 2, y: 2, z: 5.5, yaw: 100 }, place)
		assert.ok(Math.hypot(f.x + 3, f.y - 0, f.z - 5) < 1e-9 && Math.abs(f.yaw - 10) < 1e-9, JSON.stringify(f))
		assert.match(src('godot/client/features/previs/mvr_model.gd'), /Transform3D\(Basis\(Vector3\.UP, -deg_to_rad\(float\(place\.yaw\)\)\), Vector3\(place\.x, place\.z, -float\(place\.y\)\)\)/)
		const m = matrixFromPose({ x: 1, y: 2, z: 3, yaw: 30, pitch: 5, roll: 2 })
		const id = mul(m, invAffine(m))
		id.forEach((v, i) => assert.ok(Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) < 1e-9))
	})
})

describe('WO-765 calibrated export from the original archive', () => {
	it('moves only calibrated fixtures, by their own <Matrix> (local to the truss), and keeps every other byte', async () => {
		const sc = await scene(XML)
		const t1 = { x: 1.3, y: 2.6, z: 4.85, yaw: 3, pitch: 2, roll: -1.5, hang: 'truss' }
		const t2 = { x: -3.2, y: 1.1, z: 0.45, yaw: 2, pitch: 1, roll: 0, hang: 'floor' }
		const t3 = { x: 4, y: 4, z: 6, yaw: 0, pitch: 0, roll: 0, hang: 'truss' }
		const patch = [
			{ id: `mvr-${U(1).toLowerCase()}`, name: 'Spot 1', pose: poseFromMatrix(fxOf(sc, 1).fixture.matrix), calibrated_pose: cal(t1) },
			{ id: `mvr-${U(2).toLowerCase()}`, name: 'Floor 2', pose: { hang: 'floor' }, calibrated_pose: cal(t2, { source: 'inferred', residual_m: 0.08 }) },
			{ id: `mvr-${U(3).toLowerCase()}`, name: 'No matrix 3', pose: {}, calibrated_pose: cal(t3) },
			{ id: `mvr-${U(4).toLowerCase()}`, name: 'Untouched 4', pose: {} },
		]
		const files = { 'GeneralSceneDescription.xml': Buffer.from(XML), 'Maker@Spot.gdtf': Buffer.from('gdtf'), 'truss.glb': Buffer.from('glb') }
		const { files: out, report } = buildRigExport({ patch, sceneXml: XML, objects: sc.objects, files, withMarks: false, at: 'T' })
		assert.deepEqual(report.counts, { calibrated: 2, inferred: 1, unchanged: 1, added: 0, skipped: 0, marks: 0 })
		assert.deepEqual(Object.keys(out).sort(), Object.keys(files).sort(), 'every member kept')
		assert.equal(out['Maker@Spot.gdtf'], files['Maker@Spot.gdtf'])
		const x2 = out['GeneralSceneDescription.xml'].toString('utf8')
		// byte for byte outside the three matrices (+ the report comment after the declaration)
		const a = scanScene(XML)
		const b = scanScene(x2)
		const strip = (text, sc2) => {
			let s = text
			for (const f of [...sc2.fixtures].reverse()) {
				if (!/^No matrix|^Untouched/.test(f.name) && f.matrix) s = s.slice(0, f.matrix.start) + '<M/>' + s.slice(f.matrix.end)
				if (/^No matrix/.test(f.name)) s = s.slice(0, f.bodyStart) + s.slice(f.bodyStart).replace(/^<Matrix>[^<]*<\/Matrix>/, '')
			}
			return s.replace(/<!-- HighAsCG calibrated rig export[\s\S]*?-->\n/, '')
		}
		assert.equal(strip(x2, b).replace('?>\n\n', '?>\n'), strip(XML, a))
		assert.match(x2, /<!-- HighAsCG calibrated rig export \(WO-765\), T\n {5}2 measured, 1 inferred, 1 unchanged, 0 added/)
		assert.match(x2, /101 Spot 1: calibrated moved [\d.]+ m turned [\d.]+ deg \(good, fit 0.2 deg, 4 marks\)/)
		assert.match(x2, /102 Floor 2: inferred .*\(inferred, \+\/-0.08 m\)/)
		// the desk reads the calibrated poses back (world = truss · local), same UUIDs / IDs / addresses / GDTF
		const sc2 = await scene(x2)
		for (const [n, want] of [[1, t1], [2, t2], [3, t3]]) {
			const f = fxOf(sc2, n).fixture
			const q = poseFromMatrix(f.matrix)
			assert.equal(q.hang, want.hang, `hang ${n}`)
			assert.ok(Math.hypot(q.x - want.x, q.y - want.y, q.z - want.z) < 0.001, `position ${n}`)
			for (const k of ['yaw', 'pitch', 'roll']) assert.ok(wrap(q[k] - want[k]) < 0.01, `${k} ${n}: ${q[k]} vs ${want[k]}`)
		}
		for (const n of [1, 2, 3, 4]) {
			const [o, p] = [fxOf(sc, n).fixture, fxOf(sc2, n).fixture]
			assert.deepEqual([p.id, p.unit, p.spec, p.mode, JSON.stringify(p.addresses)], [o.id, o.unit, o.spec, o.mode, JSON.stringify(o.addresses)])
		}
		assert.deepEqual(fxOf(sc2, 4).fixture.matrix, fxOf(sc, 4).fixture.matrix, 'uncalibrated keeps its matrix')
		assert.match(x2, /<Unknown a="&gt;">keep<\/Unknown>/)
		assert.match(x2, /<CustomCommand>Body_Pan,f 50.0<\/CustomCommand>/)
	})

	it('a patch head the file lacks is added (stable UUID, its GDTF packed); marks become FocusPoints', async () => {
		const sc = await scene(XML)
		const patch = [{ id: 'fx9', name: 'Extra', typeId: 'abcdefabcdef', mode: 'Std', universe: 1, address: 11,
			pose: { x: 1, y: 1, z: 5 }, calibrated_pose: cal({ x: 1.1, y: 1, z: 5, yaw: 4, hang: 'truss' }) }]
		const run = () => buildRigExport({ patch, sceneXml: XML, objects: sc.objects, files: {}, marks: [{ id: 1, name: 'DSL', x: 3, y: -2, z: 0 }],
			nameOf: (id) => `HighAsCG@T@hacg-${id}.gdtf`, gdtfOf: () => Buffer.from('G'), at: 'T' })
		const { files, report } = run()
		const x2 = files['GeneralSceneDescription.xml'].toString('utf8')
		assert.equal(report.counts.added, 1)
		assert.ok(files['HighAsCG@T@hacg-abcdefabcdef.gdtf'])
		assert.match(x2, /<Layer name="HighAsCG fixtures" uuid="[0-9A-F-]{36}"><ChildList><Fixture name="Extra" uuid="[0-9A-F-]{36}"><Matrix>/)
		assert.match(x2, /<Address break="0">523<\/Address><\/Addresses><FixtureID>105<\/FixtureID>/)
		assert.match(x2, /<FocusPoint name="DSL" uuid="[0-9A-F-]{36}"><Matrix>\{1,0,0\}\{0,1,0\}\{0,0,1\}\{3000,-2000,0\}<\/Matrix><Geometries\/><\/FocusPoint>/)
		assert.equal(run().files['GeneralSceneDescription.xml'].toString(), x2, 'a re-export writes the same UUIDs')
		const sc2 = await scene(x2)
		assert.ok(sc2.objects.some((o) => o.name === 'Extra' && o.fixture), 'the added head parses as a fixture')
	})

	it('no archive: a new MVR of the patch alone', async () => {
		const { files, report } = buildRigExport({ patch: [{ id: 'a', name: 'A', typeId: 't', mode: 'm', universe: 0, address: 1, pose: { x: 0, y: 0, z: 5 } }],
			gdtfOf: () => null, at: 'T' })
		assert.equal(report.base, 'new')
		assert.match(report.notes[0], /GDTF of type t not found/)
		const sc = await scene(files['GeneralSceneDescription.xml'].toString())
		assert.equal(sc.objects.filter((o) => o.fixture).length, 1)
	})
})

describe('WO-765 position table (CSV)', () => {
	const head = (name, pose) => ({ fid: 1, name, status: 'calibrated', matrix: matrixFromPose({ x: 1, y: 2, z: 5, ...pose }) })
	it('MVR / grandMA3 frame: hung straight = 0 / 0 / 0, floor = turned over, right-hand turns about X / Y / Z', () => {
		const csv = rigCsv([head('hang', {}), head('floor', { hang: 'floor', z: 0 }), head('pitch', { pitch: 10 })], { addressOf: () => ({ universe: 0, address: 41 }) })
		const rows = csv.trim().split('\r\n')
		assert.equal(rows[0], 'Fixture ID,Name,Universe,Address,"X (m, stage left +)","Y (m, upstage +)","Z (m, up)",Rot X (deg),Rot Y (deg),Rot Z (deg),Status,Moved (m),Turned (deg),Fit,UUID')
		assert.match(rows[1], /^1,hang,0,41,1,2,5,0,0,0,calibrated/)
		assert.match(rows[2], /^1,floor,0,41,1,2,0,0,180,0,/)
		assert.match(rows[3], /^1,pitch,0,41,1,2,5,10,0,0,/)
	})
	it('Euler Rz·Ry·Rx reconstructs the rotation', () => {
		const R = rotationOf(matrixFromPose({ yaw: 33, pitch: 7, roll: -5 }))
		const [a, b, c] = eulerZYX(R).map((v) => (v * Math.PI) / 180)
		const Rx = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]
		const Ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]]
		const Rz = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]]
		const mm = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)))
		mm(mm(Rz, Ry), Rx).flat().forEach((v, i) => assert.ok(Math.abs(v - R.flat()[i]) < 1e-9))
	})
	it('MagicQ frame: X = MVR X, Y up, Z towards the audience (−MVR Y), its own headings', () => {
		const rows = rigCsv([head('hang', {})], { desk: 'magicq' }).trim().split('\r\n')
		assert.equal(rows[0], 'Head no,Head name,Universe,DMX,X Pos,Y Pos,Z Pos,X Rot,Y Rot,Z Rot,Status')
		assert.match(rows[1], /^1,hang,,,1,5,-2,0,0,0,calibrated$/)
	})
})

describe('WO-765 route GET /api/stage/rig-export', () => {
	it('mvr / csv / json from the saved project and the stored archive; registered', async () => {
		const sc = await scene(XML)
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo765-'))
		const file = path.join(dir, 'abcdefabcdef.mvr')
		fs.writeFileSync(file, buildZipStore({ 'GeneralSceneDescription.xml': Buffer.from(XML), 'Maker@Spot.gdtf': Buffer.from('g') }))
		const project = { name: 'Show A', previs: { mvr: { id: 'abcdefabcdef', place: { x: 0, y: 0, z: 0, yaw: 0 } } },
			fixtures: { marks: [], patch: [{ id: `mvr-${U(4).toLowerCase()}`, name: 'Untouched 4', universe: 0, address: 1,
				pose: poseFromMatrix(fxOf(sc, 4).fixture.matrix), calibrated_pose: cal({ x: 0.2, y: 0, z: 6, yaw: 2, hang: 'truss' }) }] } }
		const deps = { loadProject: () => project, mvrFile: () => file }
		try {
			const mvr = await handleRigExport({}, deps)
			assert.equal(mvr.status, 200)
			assert.match(mvr.headers['Content-Disposition'], /Show_A_calibrated\.mvr/)
			assert.equal(mvr.headers['X-Rig-Calibrated'], '1')
			assert.equal(mvr.body.readUInt32LE(0), 0x04034b50, 'a zip')
			const json = await handleRigExport({ format: 'json' }, deps)
			const rep = JSON.parse(json.body)
			assert.equal(rep.heads[0].status, 'calibrated')
			assert.equal('matrix' in rep.heads[0], false)
			const csv = await handleRigExport({ format: 'csv', desk: 'magicq' }, deps)
			assert.match(csv.body, /^Head no,.*\r\n104,Untouched 4,0,1,0\.2,6,-0,|^Head no,.*\r\n104,Untouched 4,0,1,0\.2,6,0,/)
			assert.equal((await handleRigExport({}, { loadProject: () => ({}) })).status, 404)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
		assert.match(src('src/api/router.js'), /require\('\.\/routes-rig-export'\)\.register\(routes\)/)
	})
})
