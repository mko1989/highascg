'use strict'

/**
 * WO-667 — posed dummies (research step 3). Sidecar: pose.py's self-test (keypoint decode out of the letterbox, both
 * heads, IoU attach to live tracks) when the box's tracking venv exists — CI has none, skipped there. Server: kps
 * pass-through, the pose_model setting and its config line, pose3d triangulation (2 cameras) and the upright-plane
 * fallback (1 camera) against the camera model's own projection, smoothing and keep. Godot: the Body pose picker and
 * the posed parts in the people layer.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const { normalizeDetection, personsFrom } = require('../../src/tracking/detect-model')
const { createDetectService } = require('../../src/tracking/detect-service')
const { project } = require('../../src/tracking/camera-model')
const { Pose3D, personJoints, onUprightPlane } = require('../../src/tracking/pose3d')

const ROOT = path.join(__dirname, '..', '..')
const VENV_PY = path.join(os.homedir(), '.local/share/highascg/tracking-venv/bin/python')
const RASTER = [1920, 1080]
const CAM_A = { pos_x: -3, pos_y: -9, pos_z: 4, pitch: -15, yaw: 18, roll: 0, fov: 55, lens_k1: 0, lens_k2: 0 }
const CAM_B = { pos_x: 4, pos_y: -8, pos_z: 3.5, pitch: -13, yaw: -25, roll: 0, fov: 50, lens_k1: 0, lens_k2: 0 }
const services = []
after(() => services.forEach((s) => s.stop()))

/** 17 joints of a person standing at (0.5, 1), PSN metres; joint 2 (an eye) left null-able by visibility. */
const BODY = Array.from({ length: 17 }, (_, j) => [0.5 + 0.03 * ((j % 5) - 2), 1 + 0.02 * (j % 3), 1.65 - j * 0.09])

/** A camera's view of BODY as sidecar kps (normalised, v 0.9; joint `hide` at v 0.1). */
function kpsOf(cam, hide = -1) {
	const px = project(cam, BODY, RASTER[0], RASTER[1])
	return px.flatMap((p, j) => [p[0] / RASTER[0], p[1] / RASTER[1], j === hide ? 0.1 : 0.9])
}

const near = (a, b, eps) => a && b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps

describe('WO-667 posed dummies', () => {
	it('pose.py self-test (sidecar venv only)', (t) => {
		if (!fs.existsSync(VENV_PY)) return t.skip('no tracking venv on this machine')
		const r = spawnSync(VENV_PY, [path.join(ROOT, 'tools/tracking-detect/test_pose.py')], { encoding: 'utf8' })
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.match(r.stdout, /^PASS$/m)
	})

	it('personsFrom: 51 keypoints within 0–1 pass through, anything else is dropped', () => {
		const ce = { id: 'a', raster: RASTER, cam: CAM_A }
		const box = [0.4, 0.3, 0.5, 0.8]
		const good = kpsOf(CAM_A)
		const ps = personsFrom({ tracks: [
			{ tid: 1, box, age_s: 0, kps: good },
			{ tid: 2, box, age_s: 0, kps: good.slice(0, 50) },
			{ tid: 3, box, age_s: 0, kps: good.map((v, i) => (i === 4 ? 1.5 : v)) },
			{ tid: 4, box, age_s: 0, kps: good.map((v, i) => (i === 4 ? '0.5' : v)) },
		] }, ce)
		assert.deepEqual(ps[0].kps, good)
		for (const p of ps.slice(1)) assert.equal('kps' in p, false, `tid ${p.tid}`)
	})

	it('pose_model: a model file name or off; the sidecar config carries its path', async () => {
		assert.equal(normalizeDetection({}).pose_model, '')
		assert.equal(normalizeDetection({ pose_model: 'yolo26n-pose.onnx' }).pose_model, 'yolo26n-pose.onnx')
		for (const pm of ['../x.onnx', '/abs/x.onnx', 'x.pt', 7]) assert.equal(normalizeDetection({ pose_model: pm }).pose_model, '', String(pm))
		const lines = []
		const spawn = () => {
			const proc = new EventEmitter()
			proc.pid = 4244
			proc.stdin = { writable: true, write: (s) => lines.push(s), end() {}, on() {} }
			proc.stdout = new PassThrough()
			proc.stderr = new PassThrough()
			proc.kill = () => {}
			return proc
		}
		const svc = createDetectService({ log: () => {} }, {
			spawn, exists: () => true, python: '/fake/python', modelsDir: '/fake/models', lease: () => Promise.resolve([]), autostart: false,
			project: { previs: { tracking: { cameras: [{ id: 'a', role: 'ch1', raster: RASTER, cam: CAM_A }],
				detection: { enabled: true, pose_model: 'yolo26n-pose.onnx' } } } },
		})
		services.push(svc)
		await new Promise((r) => setImmediate(r))
		assert.equal(JSON.parse(lines[0]).pose_model, '/fake/models/yolo26n-pose.onnx')
	})

	it('pose3d: two cameras triangulate every joint; a hidden one falls back to the upright plane', () => {
		const wp = { x: 0.5, y: 1 }
		const views = [
			{ entry: { cam: CAM_A, raster: RASTER }, person: { kps: kpsOf(CAM_A, 2) } },
			{ entry: { cam: CAM_B, raster: RASTER }, person: { kps: kpsOf(CAM_B) } },
		]
		const j = personJoints(wp, views)
		for (const i of [0, 1, 3, 9, 16]) assert.ok(near(j[i], BODY[i], 0.005), `joint ${i}: ${j[i]} vs ${BODY[i]}`)
		// joint 2 is seen by B only: the ray through it, cut with the plane through (0.5, 1) facing B
		assert.ok(near(j[2], BODY[2], 0.1), `joint 2 (mono): ${j[2]} vs ${BODY[2]}`)
		assert.equal(personJoints(wp, [{ entry: { cam: CAM_A, raster: RASTER }, person: {} }]), null, 'no keypoints → null')
	})

	it('pose3d: the upright plane through the floor point, facing the camera', () => {
		const ray = { o: [0, -10, 2], d: [0, 1, 0] }
		assert.deepEqual(onUprightPlane(ray, 0, 0), [0, 0, 2])
		assert.equal(onUprightPlane({ o: [0, -10, 2], d: [0, -1, 0] }, 0, 0), null, 'behind the camera')
		assert.equal(onUprightPlane({ o: [0, 0, 5], d: [0, 0, -1] }, 0, 0), null, 'camera straight above')
	})

	it('Pose3D: eases per step, snaps on a jump, keeps a coasting person 1 s, forgets dropped ones', () => {
		const p = new Pose3D()
		const frames = [{ id: 'a', entry: { cam: CAM_A, raster: RASTER }, persons: [{ tid: 1, box: [0.4, 0.3, 0.5, 0.8], kps: kpsOf(CAM_A) }] }]
		const w = (age) => [{ id: 7, x: 0.5, y: 1, keys: ['a:1'], age_s: age }]
		p.update(w(0), frames, 1000)
		const first = p.decorate(w(0), 1000)[0].joints
		assert.equal(first.length, 17)
		const moved = { ...frames[0], persons: [{ ...frames[0].persons[0], kps: kpsOf(CAM_A).map((v, i) => (i % 3 === 0 ? v + 0.01 : v)) }] }
		p.update(w(0), [moved], 1100)
		const raw = new Pose3D()
		raw.update(w(0), [moved], 0)
		const target = raw.decorate(w(0), 0)[0].joints
		const mid = p.decorate(w(0), 1100)[0].joints
		for (const i of [0, 9]) for (const k of [0, 1, 2]) assert.ok(Math.abs(mid[i][k] - (first[i][k] + target[i][k]) / 2) < 0.002, `eased joint ${i}`)
		assert.ok(p.decorate(w(0.5), 2000)[0].joints, 'coasting: kept within 1 s')
		assert.equal(p.decorate(w(1.5), 2200)[0].joints, undefined, 'dropped after 1 s')
		p.update([], frames, 2300)
		assert.equal(p.decorate(w(0), 2300)[0].joints, undefined, 'fusion dropped the person: forgotten')
	})

	it('Godot: Body pose picker; posed parts in the people layer; shader normals survive non-uniform scale', () => {
		const sec = fs.readFileSync(path.join(ROOT, 'godot/client/features/previs/tracking/detect_section.gd'), 'utf8')
		assert.match(sec, /_pair\(g, "Body pose", _pose\)/)
		assert.match(sec, /_set_key\("pose_model", "" if i == 0 else _pose\.get_item_text\(i\)\)/)
		const cards = fs.readFileSync(path.join(ROOT, 'godot/client/features/previs/tracking/person_cards.gd'), 'utf8')
		assert.match(cards, /var ps := PP\.parts\(c\.joints, c\.height\) if PP\.usable\(c\.joints\) else \[\]/)
		const shader = fs.readFileSync(path.join(ROOT, 'godot/client/features/previs/tracking/person_dummy.gdshader'), 'utf8')
		assert.match(shader, /world_nrm = normalize\(MODEL_NORMAL_MATRIX \* NORMAL\);/)
		const reg = fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8')
		assert.match(reg, /if \(stepped\) pose3d\.update\(fusion\.persons\(now\), _detect\.frames\(\), now\)/)
		assert.match(reg, /const world = pose3d\.decorate\(fusion\.persons\(now\), now\)/)
	})
})
