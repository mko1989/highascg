'use strict'

/**
 * WO-1103 — tools/people/dna_to_glb.py (a MetaHuman DNA character → the skinned GLB the "bring your own" test puppet
 * loads), run against a stand-in for Epic's `dna` module (fixtures/wo1103-fake-dna/dna.py) answering from a tiny
 * synthetic character of OUR OWN (built here; never an excerpt of a real MetaHuman): a body DNA in centimetres with
 * MetaHuman joint names whose "x: right" axis is declared from the other side (the converter must notice from the
 * joint sides and not mirror the character), clockwise quads (the stored normals decide the winding), two LODs, and a
 * head DNA sharing the neck joints by name with two facial joints of its own. Proven: the GLB is valid glTF 2.0 with
 * one skin over the merged joints, left joints on +X, inverse bind matrices that undo the joint globals, every vertex
 * at its joint, metres, the chosen LOD, materials by mesh word, counter-clockwise fronts, a 90° Euler joint, the
 * progress file, and the refusals (no DNA, no library). What is NOT proven: Epic's real files (none on this machine).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const CONVERT = path.join(ROOT, 'tools', 'people', 'dna_to_glb.py')
const FAKE = path.join(__dirname, 'fixtures', 'wo1103-fake-dna')
const HAVE_PY = spawnSync('python3', ['--version']).status === 0

const J = (name, parent, t, r = [0, 0, 0]) => [name, parent, t, r]
function bodyJoints() {
	const j = [J('root', 0, [0, 0, 0]), J('pelvis', 0, [0, 95, 0]), J('spine_01', 1, [0, 8, 0]), J('spine_02', 2, [0, 10, 0]),
		J('spine_03', 3, [0, 10, 0]), J('spine_04', 4, [0, 10, 0]), J('spine_05', 5, [0, 10, 0]), J('neck_01', 6, [0, 12, 0]),
		J('neck_02', 7, [0, 5, 0]), J('head', 8, [0, 8, 0])]
	for (const [s, x] of [['l', 9], ['r', -9]]) {
		const b = j.length
		j.push(J(`thigh_${s}`, 1, [x, -4, 0]), J(`calf_${s}`, b, [0, -42, 0]), J(`foot_${s}`, b + 1, [0, -42, 0]), J(`ball_${s}`, b + 2, [0, -6, 12]))
	}
	for (const [s, x] of [['l', 1], ['r', -1]]) {
		const b = j.length
		j.push(J(`clavicle_${s}`, 6, [4 * x, 8, 0]), J(`upperarm_${s}`, b, [12 * x, 0, 0]), J(`lowerarm_${s}`, b + 1, [27 * x, 0, 0]), J(`hand_${s}`, b + 2, [25 * x, 0, 0]))
	}
	j.push(J('thigh_twist_01_l', 10, [0, -10, 0], [0, 90, 0]))
	return j
}
function worlds(joints) {
	const w = []
	for (const [, p, t] of joints) w.push(w.length === p ? t.slice() : w[p].map((v, i) => v + t[i]))
	return w
}
/** A 4 cm quad facing +z at each listed joint, weighted to it — clockwise seen from +z, normals +z. */
function quads(name, joints, which) {
	const w = worlds(joints)
	const m = { name, pos: [], uv: [], nrm: [[0, 0, 1]], layouts: [], faces: [], skin: [] }
	for (const ji of which) {
		const b = m.pos.length
		for (const [dx, dy] of [[-2, -2], [-2, 2], [2, 2], [2, -2]]) {
			m.pos.push([w[ji][0] + dx, w[ji][1] + dy, w[ji][2]])
			m.uv.push([0.5 + dx / 10, 0.5 + dy / 10])
			m.skin.push([[1, ji]])
			m.layouts.push([m.pos.length - 1, m.uv.length - 1, 0])
		}
		m.faces.push([b, b + 1, b + 2, b + 3])
	}
	return m
}
const AXES_FROM_THE_OTHER_SIDE = [1, 2, 4] // "x: right, y: up, z: front" — while the left joints sit at +x

function character(dir) {
	const body = bodyJoints()
	const all = body.map((_, i) => i).filter((i) => body[i][0] !== 'thigh_twist_01_l')
	fs.writeFileSync(path.join(dir, 'body.dna'), JSON.stringify({ axes: AXES_FROM_THE_OTHER_SIDE, tunit: 0, runit: 0, joints: body, lods: [[0], [1]],
		meshes: [quads('body_lod0_mesh', body, all), quads('body_lod1_mesh', body, all.filter((i) => i % 2 === 0 || i === 9))] }))
	const head = [J('spine_05', 0, [0, 143, 0]), J('neck_01', 0, [0, 12, 0]), J('neck_02', 1, [0, 5, 0]), J('head', 2, [0, 8, 0]),
		J('FACIAL_C_FacialRoot', 3, [0, 5, 8]), J('FACIAL_L_Eye', 4, [3, 4, 2])]
	fs.mkdirSync(path.join(dir, 'Head'))
	fs.writeFileSync(path.join(dir, 'Head', 'head.dna'), JSON.stringify({ axes: AXES_FROM_THE_OTHER_SIDE, tunit: 0, runit: 0, joints: head, lods: [[0]],
		meshes: [quads('head_lod0_mesh', head, [3, 4, 5])] }))
}

function readGlb(file) {
	const b = fs.readFileSync(file)
	assert.equal(b.toString('latin1', 0, 4), 'glTF')
	assert.equal(b.readUInt32LE(4), 2)
	assert.equal(b.readUInt32LE(8), b.length)
	const jl = b.readUInt32LE(12)
	assert.equal(b.toString('latin1', 16, 20), 'JSON')
	const doc = JSON.parse(b.toString('utf8', 20, 20 + jl))
	const bin = b.subarray(20 + jl + 8)
	const acc = (i) => {
		const a = doc.accessors[i]
		const v = doc.bufferViews[a.bufferView]
		const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]
		const rd = { 5126: (o) => bin.readFloatLE(o), 5123: (o) => bin.readUInt16LE(o), 5125: (o) => bin.readUInt32LE(o) }[a.componentType]
		const sz = { 5126: 4, 5123: 2, 5125: 4 }[a.componentType]
		const out = []
		for (let k = 0; k < a.count; k++) {
			const row = []
			for (let c = 0; c < n; c++) row.push(rd(v.byteOffset + (k * n + c) * sz))
			out.push(n === 1 ? row[0] : row)
		}
		return out
	}
	return { doc, acc }
}
const qmat = ([x, y, z, w], t) => [
	[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), t[0]],
	[2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), t[1]],
	[2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), t[2]], [0, 0, 0, 1]]
const mul = (a, b) => a.map((r, i) => b[0].map((_, j) => r.reduce((s, _v, k) => s + a[i][k] * b[k][j], 0)))
const run = (args) => spawnSync('python3', ['-I', '-B', CONVERT, ...args], { encoding: 'utf8' })

describe('WO-1103 MetaHuman DNA → GLB converter (synthetic stand-in data)', { skip: !HAVE_PY && 'no python3' }, () => {
	it('converts head + body into one skinned GLB the own-puppet slot can load', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1103-dna-'))
		try {
			character(dir)
			const r = run([dir, '--lib', FAKE, '--lod', '1'])
			assert.equal(r.status, 0, r.stderr)
			const job = JSON.parse(fs.readFileSync(path.join(dir, 'convert.json'), 'utf8'))
			const out = path.join(dir, `${path.basename(dir)}.converted.glb`)
			assert.deepEqual([job.state, job.progress, job.out], ['done', 1, out])
			assert.deepEqual(job.dna.sort(), ['body.dna', 'head.dna'])
			if (process.env.WO1103_KEEP_GLB) fs.copyFileSync(out, process.env.WO1103_KEEP_GLB) // dev: load it in Godot (human_own.gd)
			const { doc, acc } = readGlb(out)
			const names = doc.nodes.filter((n) => n.mesh == null).map((n) => n.name)
			assert.equal(names.length, 29, 'the body joints + the two facial ones, the shared neck once')
			assert.equal(new Set(names).size, names.length)
			assert.deepEqual(doc.meshes.map((m) => m.name).sort(), ['body_lod1_mesh', 'head_lod0_mesh'], 'LOD 1 (the head has only LOD 0)')
			assert.deepEqual(doc.materials.map((m) => m.name).sort(), ['body', 'head'])
			const glob = new Array(doc.nodes.length)
			const walk = (i, p) => {
				const n = doc.nodes[i]
				glob[i] = mul(p, qmat(n.rotation, n.translation))
				for (const c of n.children || []) walk(c, glob[i])
			}
			walk(doc.skins[0].skeleton, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
			const at = (name) => glob[names.indexOf(name)].map((r) => r[3]).slice(0, 3)
			assert.ok(at('thigh_l')[0] > 0.05 && at('hand_l')[0] > 0.5 && at('thigh_r')[0] < -0.05, 'left joints on +X (not mirrored)')
			assert.ok(at('ball_l')[2] > at('foot_l')[2], 'the feet point +Z')
			assert.ok(Math.abs(at('head')[1] - 1.68) < 1e-4 && Math.abs(at('FACIAL_L_Eye')[1] - 1.77) < 1e-4, 'metres; the head DNA hangs off the merged head')
			const tw = doc.nodes[names.indexOf('thigh_twist_01_l')].rotation
			assert.ok(Math.abs(Math.abs(tw[1]) - Math.SQRT1_2) < 1e-4 && Math.abs(Math.abs(tw[3]) - Math.SQRT1_2) < 1e-4, `a 90° Euler joint: ${tw}`)
			const ibm = acc(doc.skins[0].inverseBindMatrices)
			doc.skins[0].joints.forEach((ni, k) => {
				const m = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => ibm[k][c * 4 + r]))
				const id = mul(m, glob[ni])
				for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) assert.ok(Math.abs(id[r][c] - (r === c ? 1 : 0)) < 1e-4, `IBM undoes ${names[ni]}`)
			})
			for (const mesh of doc.meshes) {
				const p = mesh.primitives[0]
				const pos = acc(p.attributes.POSITION)
				const nrm = acc(p.attributes.NORMAL)
				const jn = acc(p.attributes.JOINTS_0)
				pos.forEach((v, i) => {
					const j = glob[doc.skins[0].joints[jn[i][0]]].map((r) => r[3])
					assert.ok(Math.hypot(v[0] - j[0], v[1] - j[1], v[2] - j[2]) < 0.03, `${mesh.name} vertex ${i} at its joint`)
				})
				const idx = acc(p.indices)
				for (let t = 0; t < idx.length; t += 3) {
					const [a, b, c] = [pos[idx[t]], pos[idx[t + 1]], pos[idx[t + 2]]]
					const e1 = [0, 1, 2].map((i) => b[i] - a[i])
					const e2 = [0, 1, 2].map((i) => c[i] - a[i])
					const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
					assert.ok(cr[0] * nrm[idx[t]][0] + cr[1] * nrm[idx[t]][1] + cr[2] * nrm[idx[t]][2] > 0, `${mesh.name}: counter-clockwise fronts`)
				}
				assert.ok(Math.max(...pos.map((v) => v[1])) < 1.8 && Math.min(...pos.map((v) => v[1])) > -0.05, 'standing, metres')
			}
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('says why it cannot: no DNA in the folder, the library not built here', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1103-dna-'))
		try {
			assert.equal(run([dir, '--lib', FAKE]).status, 1)
			assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'convert.json'), 'utf8')).error, /no \.dna file/)
			character(dir)
			assert.equal(run([dir, '--lib', path.join(dir, 'nowhere')]).status, 1)
			const job = JSON.parse(fs.readFileSync(path.join(dir, 'convert.json'), 'utf8'))
			assert.equal(job.state, 'failed')
			assert.match(job.error, /openriglogic_build\.sh/)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('the owner build script pins Epic\'s commit and installs per machine', () => {
		const sh = fs.readFileSync(path.join(ROOT, 'tools', 'people', 'openriglogic_build.sh'), 'utf8')
		assert.match(sh, /^COMMIT=[0-9a-f]{40} /m)
		assert.match(sh, /\.local\/share\/highascg\/openriglogic/)
		assert.match(sh, /sudo apt install git cmake g\+\+ swig python3-dev/)
		const py = fs.readFileSync(CONVERT, 'utf8')
		assert.doesNotMatch(py, /urllib|requests|http[s]?:\/\//, 'the converter never sends the asset anywhere')
	})
})
