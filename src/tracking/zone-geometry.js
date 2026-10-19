'use strict'

/**
 * WO-616 T7 — trigger-zone polygon geometry (pure): point-in-polygon and the inward "hysteresis" shrink.
 *
 * Ported from OpenFollow (github.com/openfollowapp/openfollow @ 2f8aa257, AGPL-3.0-or-later,
 * Copyright (C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz):
 * openfollow/zones/geometry.py (point_in_polygon, polygon_signed_area, shrink_polygon).
 * Changes: JavaScript; vertices are [x, y] arrays (PSN metres); otherwise line for line, including the miter
 * clamp (cos ≥ 0.2), the half-shorter-edge bound and the fall-back to no shrink when the offset flips or
 * collapses the polygon.
 */

/** Ray casting; < 3 vertices is never inside. */
function pointInPolygon(px, py, v) {
	const n = v.length
	if (n < 3) return false
	let inside = false
	let [x1, y1] = v[n - 1]
	for (let i = 0; i < n; i++) {
		const [x2, y2] = v[i]
		if (y1 > py !== y2 > py) {
			const xi = x1 + ((py - y1) * (x2 - x1)) / (y2 - y1)
			if (px < xi) inside = !inside
		}
		x1 = x2
		y1 = y2
	}
	return inside
}

/** Shoelace signed area (positive = counter-clockwise). */
function signedArea(v) {
	const n = v.length
	let total = 0
	let [x1, y1] = v[n - 1]
	for (let i = 0; i < n; i++) {
		const [x2, y2] = v[i]
		total += x1 * y2 - x2 * y1
		x1 = x2
		y1 = y2
	}
	return total * 0.5
}

const copy = (v) => v.map(([x, y]) => [Number(x), Number(y)])

/** Each vertex moved inward by `amount` along its bisector (the exit polygon). */
function shrinkPolygon(v, amount) {
	const n = v.length
	if (n < 3 || !(amount > 0)) return copy(v)
	for (let i = 0; i < n; i++) {
		const [ax, ay] = v[i]
		const [bx, by] = v[(i + 1) % n]
		if ((bx - ax) ** 2 + (by - ay) ** 2 < 1e-9) return copy(v)
	}
	const orig = signedArea(v)
	const sign = orig > 0 ? 1 : -1
	const out = []
	for (let i = 0; i < n; i++) {
		const [px, py] = v[(i - 1 + n) % n]
		const [cx, cy] = v[i]
		const [nx, ny] = v[(i + 1) % n]
		const e1x = cx - px
		const e1y = cy - py
		const e2x = nx - cx
		const e2y = ny - cy
		const l1 = Math.hypot(e1x, e1y)
		const l2 = Math.hypot(e2x, e2y)
		const n1x = sign * (-e1y / l1)
		const n1y = sign * (e1x / l1)
		const n2x = sign * (-e2y / l2)
		const n2y = sign * (e2x / l2)
		let bx = n1x + n2x
		let by = n1y + n2y
		let blen = Math.hypot(bx, by)
		if (blen < 1e-9) {
			bx = n1x
			by = n1y
			blen = 1
		}
		bx /= blen
		by /= blen
		const cosHalf = Math.max(n1x * bx + n1y * by, 0.2)
		const offset = Math.min(amount / cosHalf, 0.5 * Math.min(l1, l2))
		out.push([cx + bx * offset, cy + by * offset])
	}
	const area = signedArea(out)
	if (area >= 0 !== orig >= 0 || Math.abs(area) < 0.05 * Math.abs(orig)) return copy(v)
	return out
}

module.exports = { pointInPolygon, signedArea, shrinkPolygon }
