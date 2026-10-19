'use strict'

/**
 * WO-616 T9 — person detection, the pure half: the `project.previs.tracking.detection` slice, which tracking
 * cameras the sidecar watches, and sidecar pixel tracks → stage floor points.
 *
 * Slice (client-owned with the rest of previs.tracking; every field optional):
 *   { enabled: false, model: 'yolo26n.onnx', confidence: 0.2, interval_ms: 67, max_persons: 10, grace_ms: 500,
 *     threads: 4, cameras: { <camera id>: { enabled: true, masks: [{ enabled, vertices: [[x, y] 0–1, …] }] } } }
 * Defaults are OpenFollow's (detection.py / tracking.py @ 2f8aa257). `model` is a file name inside the models
 * directory (HIGHASCG_TRACKING_MODELS), never a path. A camera without an entry is watched; masks keep a box only
 * when its feet point lies inside an enabled one (no usable mask = whole picture).
 *
 * Floor point: the box's bottom-centre (feet), scaled from the normalised box to the camera's calibration raster,
 * undistorted and cast onto the plane z = grid.z_offset (camera-model.pixelToFloor) — OpenFollow's
 * detection-to-stage path (geometry.py screen_to_world).
 */

const { pixelToFloor } = require('./camera-model')

const DETECTION_DEFAULTS = Object.freeze({
	enabled: false,
	model: 'yolo26n.onnx',
	confidence: 0.2,
	interval_ms: 67,
	max_persons: 10,
	grace_ms: 500,
	threads: 4,
})
const LIMITS = {
	confidence: [0.1, 0.95],
	interval_ms: [20, 2000],
	max_persons: [1, 50],
	grace_ms: [0, 10000],
	threads: [1, 16],
}
const MODEL_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}\.onnx$/
const ROLE_RE = /^(pgm[1-4]|prv[1-4]|in([1-9]|1[0-6])|ch[1-9][0-9]?)$/

const clamp = (v, [lo, hi], dflt) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Number(v))) : dflt)
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)))

function normalizeMasks(src) {
	const out = []
	for (const m of Array.isArray(src) ? src : []) {
		const verts = (Array.isArray(m?.vertices) ? m.vertices : [])
			.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
			.map((p) => [clamp01(p[0]), clamp01(p[1])])
		if (verts.length >= 3) out.push({ enabled: m.enabled !== false, vertices: verts })
	}
	return out
}

/** Any value → a complete, clamped detection config (see the header). */
function normalizeDetection(src) {
	const s = src && typeof src === 'object' && !Array.isArray(src) ? src : {}
	const out = { enabled: s.enabled === true, model: MODEL_RE.test(String(s.model || '')) && !String(s.model).includes('..') ? String(s.model) : DETECTION_DEFAULTS.model }
	for (const k of Object.keys(LIMITS)) out[k] = clamp(s[k], LIMITS[k], DETECTION_DEFAULTS[k])
	out.max_persons = Math.round(out.max_persons)
	out.threads = Math.round(out.threads)
	out.cameras = {}
	const cams = s.cameras && typeof s.cameras === 'object' && !Array.isArray(s.cameras) ? s.cameras : {}
	for (const [id, c] of Object.entries(cams)) out.cameras[id] = { enabled: c?.enabled !== false, masks: normalizeMasks(c?.masks) }
	return out
}

/**
 * previs.tracking → the cameras to detect on: [{ id, role, raster: [w, h], cam, masks }]. Needs a surface role
 * (WO-597) and the camera not switched off in the detection slice; an unsolved camera still detects (pixel boxes
 * show in its view) but its persons carry floor: null.
 */
function detectCameras(tracking, det) {
	const out = []
	const seen = new Set()
	for (const c of Array.isArray(tracking?.cameras) ? tracking.cameras : []) {
		const id = String(c?.id || '')
		const role = String(c?.role || '')
		if (!id || seen.has(id) || !ROLE_RE.test(role)) continue
		const dc = det.cameras[id] || { enabled: true, masks: [] }
		if (!dc.enabled) continue
		seen.add(id)
		const r = Array.isArray(c.raster) ? c.raster.map(Number) : []
		const raster = r.length >= 2 && r[0] > 0 && r[1] > 0 ? [r[0], r[1]] : [1920, 1080]
		out.push({ id, role, raster, cam: c.cam && typeof c.cam === 'object' ? c.cam : null, masks: dc.masks })
	}
	return out
}

/** Sidecar box (normalised x1, y1, x2, y2) → [x, y, z] PSN metres on the floor plane, or null. */
function boxToFloor(box, camEntry, planeZ = 0) {
	if (!camEntry?.cam || !Array.isArray(box) || box.length < 4) return null
	const [w, h] = camEntry.raster
	const p = pixelToFloor(camEntry.cam, [((Number(box[0]) + Number(box[2])) / 2) * w, Number(box[3]) * h], w, h, planeZ)
	return p && p.every(Number.isFinite) ? p.map((v) => Math.round(v * 1000) / 1000) : null
}

/** One sidecar `tracks` message → the persons list a client / the pinning engine sees. */
function personsFrom(msg, camEntry, planeZ = 0) {
	const out = []
	for (const t of Array.isArray(msg?.tracks) ? msg.tracks : []) {
		if (!Array.isArray(t?.box) || t.box.length < 4) continue
		out.push({
			tid: Number(t.tid),
			box: t.box.slice(0, 4).map(Number),
			score: Number(t.score) || 0,
			age_s: Number(t.age_s) || 0,
			floor: boxToFloor(t.box, camEntry, planeZ),
		})
	}
	return out
}

module.exports = { DETECTION_DEFAULTS, normalizeDetection, detectCameras, boxToFloor, personsFrom }
