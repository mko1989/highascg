'use strict'

/**
 * WO-1104 — a stage drape's pleats (project.previs.stage.objects type "drape"), generated from its parameters: the twin
 * of godot/client/features/previs/drape_geometry.gd (same FNV-1a seed of the id, same 32-bit hash, same fold nodes and
 * half-cosine profile), so a drape looks the same in the previs, the exported .mvr (mvr-export.js) and the games' bake
 * (modules/rc-game/server/rc-scene-drape.js). Pure; no textures — nothing in it comes from anyone's model.
 *
 * Object frame: origin bottom-centre, x across, y up, z towards the audience. Drape fields: size_m [w, h],
 * color "#rrggbb", fullness % (0 = flat molton), pleat_m (fold to fold).
 */

const SAMPLES = [3, 4, 6, 8] // points per half pleat at previs quality Low … Ultra
const MAX_COLS = 4000
const JITTER_W = 0.3
const AMP_MIN = 0.7
const ROW_SCALE = [1, 0.95, 0.88] // fold depth at the floor, halfway, at the top
const ARC_STEPS = 64
const DEFAULTS = { size_m: [6, 4], color: '#151515', fullness: 60, pleat_m: 0.25 }

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** stage_objects.gd normalize for the drape fields (what the twins read). */
function drapeOf(o) {
	const s = Array.isArray(o?.size_m) ? o.size_m : DEFAULTS.size_m
	const color = /^#[0-9a-f]{6}$/i.test(String(o?.color || '')) ? String(o.color) : DEFAULTS.color
	return { id: String(o?.id ?? ''), size_m: [clamp(num(Number(s[0]), 6), 0.1, 100), clamp(num(Number(s[1]), 4), 0.1, 100)], color,
		fullness: clamp(num(Number(o?.fullness), DEFAULTS.fullness), 0, 200), pleat_m: clamp(num(Number(o?.pleat_m), DEFAULTS.pleat_m), 0.08, 2) }
}

/** FNV-1a (32 bit) of the id's UTF-8 bytes. */
function seedOf(id) {
	let h = 2166136261
	for (const b of Buffer.from(String(id), 'utf8')) h = Math.imul(h ^ b, 16777619) >>> 0
	return h
}

/** Deterministic 0..1 from (seed, i) — drape_geometry.gd hash01 (its 64-bit ints masked to 32 = Math.imul here). */
function hash01(seed, i) {
	let x = (seed ^ Math.imul(i, 374761393)) >>> 0
	x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0
	x = Math.imul(x ^ (x >>> 15), 0x5bd1e995) >>> 0
	x = (x ^ (x >>> 16)) >>> 0
	return x / 4294967296
}

function arcRatio(k) {
	let s = 0
	for (let i = 0; i < ARC_STEPS; i++) s += Math.sqrt(1 + (k * Math.sin((2 * Math.PI * (i + 0.5)) / ARC_STEPS)) ** 2)
	return s / ARC_STEPS
}

/** Half the fold depth (m) for fullness (0..2) at `spacing` m. */
function amplitude(fullness, spacing) {
	if (fullness < 0.005) return 0
	let lo = 0, hi = 20
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2
		if (arcRatio(mid) < 1 + fullness) lo = mid
		else hi = mid
	}
	return (((lo + hi) / 2) * spacing) / (2 * Math.PI)
}

const pleats = (d) => (d.fullness < 0.5 ? 0 : Math.max(1, Math.round(d.size_m[0] / d.pleat_m)))

/** Fold nodes [x, z] at the floor, left → right (2n + 1; 2 when flat). */
function nodes(o) {
	const d = drapeOf(o)
	const w = d.size_m[0]
	const n = pleats(d)
	if (!n) return [[-w / 2, 0], [w / 2, 0]]
	const seed = seedOf(d.id)
	const a = amplitude(d.fullness / 100, w / n)
	const widths = []
	let total = 0
	for (let j = 0; j < 2 * n; j++) {
		widths.push(1 + JITTER_W * (hash01(seed, j) - 0.5))
		total += widths[j]
	}
	const out = []
	let x = -w / 2
	for (let j = 0; j <= 2 * n; j++) {
		const depth = a * (AMP_MIN + (1 - AMP_MIN) * hash01(seed, 7919 + j))
		out.push([x, j % 2 === 0 ? depth : -depth])
		if (j < 2 * n) x += (w * widths[j]) / total
	}
	out[out.length - 1][0] = w / 2
	return out
}

/** The sampled plan profile at the floor (`samples` points per half pleat). */
function profile(o, samples) {
	const nd = nodes(o)
	const halves = nd.length - 1
	const s = halves > 1 ? clamp(samples, 1, Math.max(1, Math.floor(MAX_COLS / halves))) : 1
	const out = []
	for (let j = 0; j < halves; j++) {
		for (let i = 0; i < s; i++) {
			const t = i / s
			const e = (1 - Math.cos(Math.PI * t)) / 2
			out.push([nd[j][0] + (nd[j + 1][0] - nd[j][0]) * t, nd[j][1] + (nd[j + 1][1] - nd[j][1]) * e])
		}
	}
	out.push(nd[halves])
	return out
}

/**
 * The cloth mesh in the object frame: { positions, normals, uvs (metres: u along the cloth, v down), indices, tris }.
 * Winding as stage_builder.gd's strips (front = +Z side); the cloth is double-sided wherever it is drawn.
 */
function mesh(o, samples = SAMPLES[1]) {
	const d = drapeOf(o)
	const prof = profile(d, samples)
	const h = d.size_m[1]
	const rows = ROW_SCALE.length
	const pos = [], nrm = [], uv = [], idx = []
	let u = 0
	for (let i = 0; i < prof.length; i++) {
		if (i > 0) u += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1])
		const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)]
		for (let r = 0; r < rows; r++) {
			const k = ROW_SCALE[r]
			const dx = b[0] - a[0], dz = (b[1] - a[1]) * k
			const l = Math.hypot(dx, dz) || 1
			const y = (h * r) / (rows - 1)
			pos.push(prof[i][0], y, prof[i][1] * k)
			nrm.push(-dz / l, 0, dx / l)
			uv.push(u, h - y)
		}
	}
	for (let i = 0; i + 1 < prof.length; i++) {
		for (let r = 0; r + 1 < rows; r++) {
			const bl = i * rows + r, br = (i + 1) * rows + r
			idx.push(bl + 1, br + 1, br, bl + 1, br, bl)
		}
	}
	return { positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uv), indices: new Uint32Array(idx), tris: idx.length / 3 }
}

/** "#rrggbb" (sRGB) → linear [r, g, b, 1]. */
function linearColor(hex) {
	const v = parseInt(drapeOf({ color: hex }).color.slice(1), 16)
	const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
	return [lin(((v >> 16) & 255) / 255), lin(((v >> 8) & 255) / 255), lin((v & 255) / 255), 1]
}

module.exports = { SAMPLES, seedOf, hash01, amplitude, nodes, profile, mesh, linearColor }
