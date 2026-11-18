'use strict'

/**
 * WO-616 T10a — fusion's picture-side checks (fusion.js): what one camera's person would look like in another
 * camera. A box whose feet are hidden (behind a piano, a monitor) or whose head is cut by the picture edge gives a
 * wrong feet point and a wrong head ray, so neither floor distance nor the head rays pair it with the other
 * camera's box of the same person. The other camera's feet point still says where the body stands: cast that body
 * (feet → head) into this camera's picture and compare it with the box there.
 *
 *   columnMatch  a's body, seen by b's camera, against b's box → { cost, feetBad } | null
 *   inView       would a person at (x, y) fill a usable part of this camera's picture? (the stand-still veto)
 */

const { project, applyDistortion } = require('./camera-model')

const BODY_M = 1.75
const BODY_RANGE_M = [1.0, 2.1]
const EDGE = 0.01 // a box edge this near the picture edge is cut by it
const X_SLACK = 1.0 // sideways miss allowed, in box widths (or body-width equivalents)
const Y_SLACK = 0.25 // top / bottom miss allowed, in projected body heights
const MIN_COVER = 0.35 // the box must show at least this much of the projected body…
const MAX_COVER = 2.0 // …and not be this many times taller (a box that swallowed the furniture in front is still taller)
const MAX_FEET_APART_M = 3 // hidden feet land a metre or two off; further apart it is somebody else in the same column
const VIEW_MARGIN = 0.02
const VIEW_MIN_HEIGHT = 0.2 // of the picture height: smaller than this the detector is not dependable

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const cutTop = (o) => o.box[1] <= EDGE
const cutBottom = (o) => o.box[3] >= 1 - EDGE

/** World points → normalised picture points of a tracking camera, or null when one is behind it. */
function toPicture(entry, pts) {
	const [w, h] = entry.raster
	const px = project(entry.cam, pts, w, h)
	if (!px || px.some((p) => p === null)) return null
	const d = applyDistortion(px, w, h, Number(entry.cam.lens_k1) || 0, Number(entry.cam.lens_k2) || 0)
	return d.map((p) => [p[0] / w, p[1] / h])
}

/** The body height the box of `o` implies: where its head ray passes over its own feet point (default when cut / implausible). */
function bodyHeight(o, planeZ) {
	if (!o.ray || cutTop(o)) return BODY_M
	const { o: c, d } = o.ray
	const len2 = d[0] * d[0] + d[1] * d[1]
	if (len2 < 1e-9) return BODY_M
	const t = ((o.feet[0] - c[0]) * d[0] + (o.feet[1] - c[1]) * d[1]) / len2
	const h = c[2] + t * d[2] - planeZ
	return h >= BODY_RANGE_M[0] && h <= BODY_RANGE_M[1] ? h : BODY_M
}

/**
 * Is the box of `b` the body `a` stands for (a's feet point trusted)? → { cost (0…1: the sideways miss), feetBad:
 * b's own feet point is not to be used (hidden, cut, or the box runs on into furniture) } or null. b's box must sit
 * on the projected body sideways, share its top or its bottom, and be of a comparable height.
 */
function columnMatch(a, b, planeZ = 0) {
	if (!a.entry || !b.entry || a.camera === b.camera || cutBottom(a)) return null
	if (Math.hypot(a.feet[0] - b.feet[0], a.feet[1] - b.feet[1]) > MAX_FEET_APART_M) return null
	const pts = toPicture(b.entry, [
		[a.feet[0], a.feet[1], planeZ + bodyHeight(a, planeZ)],
		[a.feet[0], a.feet[1], planeZ],
	])
	if (!pts) return null
	const top = pts[0][1],
		bottom = pts[1][1]
	const eh = bottom - top
	if (!(eh > 0.02)) return null
	const [w, h] = b.entry.raster
	const bw = b.box[2] - b.box[0]
	const xLimit = Math.max(bw, (0.3 * eh * h) / w) * X_SLACK
	const cx = (pts[0][0] + pts[1][0]) / 2
	const bx = (b.box[0] + b.box[2]) / 2
	// a box cut by the left / right picture edge shows one side of the body only: its centre is free towards that edge
	const outward = (b.box[0] <= EDGE && cx < bx) || (b.box[2] >= 1 - EDGE && cx > bx)
	const xOff = outward ? Math.max(0, Math.abs(bx - cx) - bw) : Math.abs(bx - cx)
	if (xOff > xLimit) return null
	const tol = Y_SLACK * eh
	const ct = clamp01(top),
		cb = clamp01(bottom)
	const topOk = Math.abs(b.box[1] - ct) <= tol
	const bottomOk = Math.abs(b.box[3] - cb) <= tol
	const cover = (b.box[3] - b.box[1]) / Math.max(cb - ct, 1e-6)
	if ((!topOk && !bottomOk) || cover < MIN_COVER || cover > MAX_COVER) return null
	return { cost: xOff / xLimit, feetBad: !bottomOk || cutBottom(b) }
}

/** Would a person standing at (x, y) on the plane be whole and large enough in this camera's picture? */
function inView(entry, x, y, planeZ = 0) {
	const pts = toPicture(entry, [
		[x, y, planeZ + BODY_M],
		[x, y, planeZ],
	])
	if (!pts) return false
	const ok = (p) => p.every((v) => v >= VIEW_MARGIN && v <= 1 - VIEW_MARGIN)
	return ok(pts[0]) && ok(pts[1]) && pts[1][1] - pts[0][1] >= VIEW_MIN_HEIGHT
}

module.exports = { columnMatch, inView, bodyHeight, cutTop, cutBottom }
