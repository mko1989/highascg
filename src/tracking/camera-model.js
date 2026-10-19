'use strict'

/**
 * WO-616 T2 — tracking camera model for the server hub: pinhole project / unproject and the radial k1/k2 lens.
 * Same maths and frames as godot/client/features/previs/tracking/camera_model.gd (the Godot side also owns the
 * calibration solve; the hub only needs to turn pixels into floor points and back, e.g. for detections and fusion).
 *
 * Ported from OpenFollow (https://github.com/openfollowapp/openfollow @ 2f8aa257, AGPL-3.0-or-later):
 * openfollow/scene/solver.py, openfollow/lens_model.py.
 * Copyright (C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz.
 * Changes: JavaScript; NaN rows → null.
 *
 * World = PSN metres (X stage left, Y upstage, Z up). Screen = pixels, top-left origin, Y down.
 * Camera = { pos_x, pos_y, pos_z, pitch, yaw, roll (deg), fov (HORIZONTAL deg), lens_k1, lens_k2 }.
 */

const FOV_MIN = 1
const FOV_MAX = 179
const INVERT_ITERS = 40
const INVERT_SETTLED = 1e-14
const INVERT_R_CAP = 4
const rad = (d) => (d * Math.PI) / 180

function hfovToVfov(hfov, aspect) {
	return (2 * Math.atan(Math.tan(rad(hfov) / 2) / aspect) * 180) / Math.PI
}

function validView(cam, w, h) {
	const fov = Number(cam?.fov)
	return fov >= FOV_MIN && fov <= FOV_MAX && Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0
}

/** Camera → world rotation (Y-up frame), row-major: R = Ry(-yaw) · Rx(pitch) · Rz(roll). */
function rotation(pitch, yaw, roll) {
	const a = rad(pitch), b = -rad(yaw), c = rad(roll)
	const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c)
	return [cb * cc + sb * sa * sc, -cb * sc + sb * sa * cc, sb * ca, ca * sc, ca * cc, -sa, -sb * cc + cb * sa * sc, sb * sc + cb * sa * cc, cb * ca]
}

function view(cam, w, h) {
	const aspect = w / h
	return {
		r: rotation(cam.pitch, cam.yaw, cam.roll),
		c: [Number(cam.pos_x), Number(cam.pos_z), -Number(cam.pos_y)],
		aspect,
		f: 1 / Math.tan(rad(hfovToVfov(Number(cam.fov), aspect)) / 2),
	}
}

/** PSN points [[x,y,z],…] → [[sx,sy] | null,…] (null = at / behind the camera). Pinhole only. */
function project(cam, pts, w, h) {
	if (!validView(cam, w, h)) return []
	const { r, c, aspect, f } = view(cam, w, h)
	return pts.map((p) => {
		const tx = p[0] - c[0], ty = p[2] - c[1], tz = -p[1] - c[2]
		const vx = r[0] * tx + r[3] * ty + r[6] * tz
		const vy = r[1] * tx + r[4] * ty + r[7] * tz
		const vz = r[2] * tx + r[5] * ty + r[8] * tz
		if (!(vz < -1e-9)) return null
		return [((f / aspect) * (vx / -vz) + 1) / 2 * w, (1 - f * (vy / -vz)) / 2 * h]
	})
}

/** Pinhole screen points → PSN points on the plane z = planeZ ([x,y,z] | null when the ray misses). */
function unproject(cam, screen, w, h, planeZ = 0) {
	if (!validView(cam, w, h)) return []
	const { r, c, aspect, f } = view(cam, w, h)
	return screen.map((s) => {
		if (!s) return null
		const dx = ((s[0] / w) * 2 - 1) * aspect / f
		const dy = (1 - (s[1] / h) * 2) / f
		const wx = r[0] * dx + r[1] * dy - r[2]
		const wy = r[3] * dx + r[4] * dy - r[5]
		const wz = r[6] * dx + r[7] * dy - r[8]
		if (Math.abs(wy) < 1e-12) return null
		const t = (planeZ - c[1]) / wy
		if (t <= 0) return null
		return [c[0] + t * wx, -(c[2] + t * wz), c[1] + t * wy]
	})
}

/** Normalised radius where the lens warp first folds; Infinity when it never does. */
function lensFoldRadius(k1, k2) {
	if (k2 === 0) return k1 < 0 ? Math.sqrt(-1 / (3 * k1)) : Infinity
	const disc = 9 * k1 * k1 - 20 * k2
	if (disc < 0) return Infinity
	const q = -0.5 * (3 * k1 + ((k1 !== 0 ? 3 * k1 : 1) >= 0 ? Math.sqrt(disc) : -Math.sqrt(disc)))
	const pos = [q / (5 * k2), q !== 0 ? 1 / q : Infinity].filter((s) => s > 0)
	return pos.length ? Math.sqrt(Math.min(...pos)) : Infinity
}

function invertRadius(rd, k1, k2) {
	const rMax = Math.min(lensFoldRadius(k1, k2), INVERT_R_CAP)
	let lo = 0, hi = rMax, r = Math.min(rd, rMax)
	for (let i = 0; i < INVERT_ITERS; i++) {
		const r2 = r * r
		const hv = r * (1 + k1 * r2 + k2 * r2 * r2) - rd
		const slope = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2
		if (hv < 0) lo = r
		if (hv > 0) hi = r
		const cand = slope > 1e-12 ? r - hv / slope : NaN
		const moved = Number.isNaN(cand) || cand < lo || cand > hi ? 0.5 * (lo + hi) : cand
		const done = Math.abs(moved - r) <= INVERT_SETTLED
		r = moved
		if (done) break
	}
	return r
}

function radial(pts, w, h, k1, k2, inverse) {
	if (k1 === 0 && k2 === 0) return pts.map((p) => (p ? [p[0], p[1]] : null))
	const cx = w / 2, cy = h / 2, hd = 0.5 * Math.hypot(w, h)
	return pts.map((p) => {
		if (!p) return null
		const dx = (p[0] - cx) / hd, dy = (p[1] - cy) / hd
		let s
		if (inverse) {
			const rd = Math.hypot(dx, dy)
			s = rd > 0 ? invertRadius(rd, k1, k2) / rd : 1
		} else {
			const r2 = dx * dx + dy * dy
			s = 1 + k1 * r2 + k2 * r2 * r2
		}
		return [cx + dx * s * hd, cy + dy * s * hd]
	})
}

/** Pinhole pixels → where the camera's lens shows them. */
const applyDistortion = (pts, w, h, k1, k2) => radial(pts, w, h, k1, k2, false)
/** Lens pixels (a click / detection on the video) → pinhole pixels for unproject. */
const invertDistortion = (pts, w, h, k1, k2) => radial(pts, w, h, k1, k2, true)

/** A pixel on the camera's real (distorted) picture → the PSN floor point under it. */
function pixelToFloor(cam, px, w, h, planeZ = 0) {
	const k1 = Number(cam.lens_k1) || 0, k2 = Number(cam.lens_k2) || 0
	return unproject(cam, invertDistortion([px], w, h, k1, k2), w, h, planeZ)[0] ?? null
}

/**
 * WO-616 T10: a pixel on the real (distorted) picture → its viewing ray in PSN metres: { o: camera centre, d: unit
 * direction }, or null for an invalid camera. Fusion triangulates two cameras' head rays with this.
 */
function pixelRay(cam, px, w, h) {
	if (!validView(cam, w, h)) return null
	const k1 = Number(cam.lens_k1) || 0, k2 = Number(cam.lens_k2) || 0
	const s = invertDistortion([px], w, h, k1, k2)[0]
	if (!s) return null
	const { r, aspect, f } = view(cam, w, h)
	const dx = ((s[0] / w) * 2 - 1) * aspect / f
	const dy = (1 - (s[1] / h) * 2) / f
	const wx = r[0] * dx + r[1] * dy - r[2]
	const wy = r[3] * dx + r[4] * dy - r[5]
	const wz = r[6] * dx + r[7] * dy - r[8]
	const n = Math.hypot(wx, wy, wz)
	return { o: [Number(cam.pos_x), Number(cam.pos_y), Number(cam.pos_z)], d: [wx / n, -wz / n, wy / n] }
}

module.exports = { hfovToVfov, rotation, project, unproject, lensFoldRadius, invertRadius, applyDistortion, invertDistortion, pixelToFloor, pixelRay }
