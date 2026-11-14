'use strict'

/**
 * WO-1074 §2.7 — RC car game: a coarse height field of the scene over the hall, for elevated decks (pure).
 *
 * Every cell (CELL m square, over the hall rect + 1 m) holds a 32-bit mask of height bins: bit k is set when any scene
 * geometry lies in [base + k · BIN, base + (k + 1) · BIN), base = hall floor + 0.05 m (the floor itself never counts),
 * BIN = 0.25 m → bins up to 8 m above the floor; anything higher sets bit 31 ("the ceiling"). It is filled from the
 * same world triangles the bake already walks (sampled at CELL / 2, like the obstacle slab grid) — what the GLB draws;
 * parts it leaves out (fixtures, dropped small objects) are not drawn, so a deck may pass through them. `box()` adds a
 * solid AABB (synthetic scenes, tests). A higher floor (the stage) is cleared below its own y
 * (its body is a floor, not a thing under a deck). Queries:
 *   - `bandHit(x, z, half, yLo, yHi)` — is any geometry in (yLo, yHi) within `half` (+ the cell) of (x, z)?
 *   - `topBelow(x, z, y)` / `bottomAbove(x, z, y)` — the highest occupied height ≤ y (the hall floor when none) and
 *     the lowest occupied height ≥ y (Infinity when none) in that cell;
 *   - `toJSON()` / `fromJSON()` — the compact form the scene JSON carries (`heights`), so `validateTrack` can check
 *     deck clearances from a cached scene too.
 * Memory: 4 bytes per cell (a 27 × 61 m hall: ≈ 7 k cells, 28 kB).
 */

const CELL = 0.5
const BIN = 0.25
const BINS = 32
const FLOOR_EPS = 0.05

/** An empty field over `rect` ([minX, minZ, maxX, maxZ]) whose floor is at `floorY`. */
function createHeightField(rect, floorY, opts = {}) {
	const cell = opts.cell || CELL
	const x0 = rect[0] - 1, z0 = rect[1] - 1
	const nx = Math.max(1, Math.ceil((rect[2] - rect[0] + 2) / cell)), nz = Math.max(1, Math.ceil((rect[3] - rect[1] + 2) / cell))
	return wrap({ cell, bin: BIN, x0, z0, nx, nz, floor: floorY, base: floorY + FLOOR_EPS, mask: new Uint32Array(nx * nz) })
}

function wrap(F) {
	const { cell, bin, x0, z0, nx, nz, base, mask } = F
	const top = base + BINS * bin
	const binOf = (y) => (y >= top ? BINS - 1 : Math.floor((y - base) / bin))
	const mark = (x, y, z) => {
		if (y < base) return
		const i = Math.floor((x - x0) / cell), k = Math.floor((z - z0) / cell)
		if (i >= 0 && k >= 0 && i < nx && k < nz) mask[k * nx + i] |= 1 << binOf(y)
	}
	/** Bits of bins overlapping the open interval (yLo, yHi). */
	const bandBits = (yLo, yHi) => {
		if (yHi <= base) return 0
		const a = Math.min(BINS - 1, Math.max(0, Math.floor((Math.max(yLo, base) - base) / bin))), b = Math.min(BINS - 1, Math.ceil((yHi - base) / bin) - 1)
		if (b < a) return 0
		return b - a >= 31 ? 0xffffffff : ((2 ** (b - a + 1) - 1) * 2 ** a) >>> 0
	}
	const cellAt = (x, z) => {
		const i = Math.floor((x - x0) / cell), k = Math.floor((z - z0) / cell)
		return i >= 0 && k >= 0 && i < nx && k < nz ? mask[k * nx + i] : 0
	}
	return {
		cell, bin, x0, z0, nx, nz, floor: F.floor, base,
		/** One world triangle (9 floats), sampled at cell / 2. */
		tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
			if (Math.max(ay, by, cy) < base) return
			if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x0 + nx * cell) return
			if (Math.max(az, bz, cz) < z0 || Math.min(az, bz, cz) > z0 + nz * cell) return
			const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz))
			const n = Math.min(300, Math.max(1, Math.ceil(e / Math.min(cell / 2, bin))))
			for (let i = 0; i <= n; i++) {
				for (let j = 0; j <= n - i; j++) {
					const u = i / n, v = j / n, w = 1 - u - v
					mark(w * ax + u * bx + v * cx, w * ay + u * by + v * cy, w * az + u * bz + v * cz)
				}
			}
		},
		/** A solid box (world AABB). */
		box(min, max) {
			if (max[1] < base) return
			const bits = bandBits(min[1] - 1e-9, max[1] + 1e-9) || (1 << binOf(max[1]))
			const i0 = Math.max(0, Math.floor((min[0] - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((max[0] - x0) / cell))
			const k0 = Math.max(0, Math.floor((min[2] - z0) / cell)), k1 = Math.min(nz - 1, Math.floor((max[2] - z0) / cell))
			for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) mask[k * nx + i] |= bits
		},
		/** Clear every bin below `y` (+ a bin) in the cells overlapping `rect` (a higher floor's body). */
		clearBelow(rect, y) {
			const keep = ~bandBits(-Infinity, y + FLOOR_EPS) >>> 0
			const i0 = Math.max(0, Math.floor((rect[0] - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((rect[2] - x0) / cell))
			const k0 = Math.max(0, Math.floor((rect[1] - z0) / cell)), k1 = Math.min(nz - 1, Math.floor((rect[3] - z0) / cell))
			for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) mask[k * nx + i] &= keep
		},
		/** Any geometry in (yLo, yHi) in a cell within `half` of (x, z)? */
		bandHit(x, z, half, yLo, yHi) {
			const bits = bandBits(yLo, yHi)
			if (!bits) return false
			const r = half + cell * 0.71
			const i0 = Math.max(0, Math.floor((x - r - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((x + r - x0) / cell))
			const k0 = Math.max(0, Math.floor((z - r - z0) / cell)), k1 = Math.min(nz - 1, Math.floor((z + r - z0) / cell))
			for (let k = k0; k <= k1; k++) {
				for (let i = i0; i <= i1; i++) {
					if (!(mask[k * nx + i] & bits)) continue
					if (Math.hypot(x0 + (i + 0.5) * cell - x, z0 + (k + 0.5) * cell - z) <= r) return true
				}
			}
			return false
		},
		/** Highest occupied height at or below y in the cell of (x, z) (bin tops; the floor when none). */
		topBelow(x, z, y) {
			const m = cellAt(x, z)
			for (let k = Math.min(BINS - 1, binOf(y)); k >= 0; k--) if (m & (1 << k)) return Math.min(y, base + (k + 1) * bin)
			return F.floor
		},
		/** Lowest occupied height at or above y in the cell of (x, z) (bin bottoms; Infinity when none). */
		bottomAbove(x, z, y) {
			const m = cellAt(x, z)
			for (let k = Math.max(0, binOf(y)); k < BINS; k++) if (m & (1 << k)) return Math.max(y, base + k * bin)
			return Infinity
		},
		toJSON() {
			return { cell, bin, bins: BINS, origin: [x0, z0], nx, nz, floor: F.floor, base, data: Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength).toString('base64') }
		},
		mask,
	}
}

/** The scene JSON's `heights` → a field (null when absent or malformed). Cached on the object. */
function fromJSON(h) {
	if (!h || typeof h !== 'object') return null
	if (h.__field) return h.__field
	const ok = [h.cell, h.bin, h.nx, h.nz, h.floor, h.base].every(Number.isFinite) && Array.isArray(h.origin) && typeof h.data === 'string'
	if (!ok || h.bins !== BINS || h.bin !== BIN) return null
	const buf = Buffer.from(h.data, 'base64')
	if (buf.length !== h.nx * h.nz * 4) return null
	const mask = new Uint32Array(h.nx * h.nz)
	for (let i = 0; i < mask.length; i++) mask[i] = buf.readUInt32LE(i * 4)
	const f = wrap({ cell: h.cell, bin: h.bin, x0: h.origin[0], z0: h.origin[1], nx: h.nx, nz: h.nz, floor: h.floor, base: h.base, mask })
	Object.defineProperty(h, '__field', { value: f, enumerable: false })
	return f
}

/** The field a scene object carries: `scene.field` (live, during the bake) or its JSON `heights`. */
const fieldOf = (scene) => scene?.field || fromJSON(scene?.heights) || null

module.exports = { createHeightField, fromJSON, fieldOf, BIN, BINS }
