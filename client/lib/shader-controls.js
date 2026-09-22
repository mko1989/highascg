/**
 * shader-controls.js — turn a shader's raw detected literals into a SMALL set of human controls.
 *
 * The scanner (shader-param-scan.js) finds every tweakable number; on real shaders that is ~45 of
 * them and most are structural (luma weights, HSV constants, texture coordinates). This module
 * decides which few matter, names/sections them, and merges look-alikes into macro controls
 * ("Speed ×" drives every time multiplier at once). Pure functions, no DOM — works on ANY shader,
 * no per-shader authoring; an optional operator manifest (`cfg.controls`) pins/hides on top.
 *
 * A control never owns values — it references params by stable key, and the panel reads/writes
 * through the same span-rewrite path as the raw rows.
 */

import { scanShaderParams, scanShaderDeepParams } from './shader-param-scan.js'

export const SECTION_ORDER = ['Motion', 'Shape', 'Look', 'Colour', 'Audio']
export const PASS_KEYS = ['image', 'bufferA', 'bufferB', 'bufferC', 'bufferD']

const MAX_COLORS = 6
const MAX_SLIDERS = 8
const MIN_SCORE = 5

/** Scan common + every pass into one flat param list, each tagged with passKey and a stable key. */
export function scanShaderCfg(cfg) {
	const out = []
	const push = (passKey, source) => {
		const named = scanShaderParams(source || '')
		for (const p of named) out.push({ ...p, passKey, intLiteral: !String(source).slice(p.spans[0].start, p.spans[0].end).includes('.') })
		// Const literals appear in both scans — drop deep hits overlapping a named param.
		const taken = named.flatMap((p) => p.spans)
		for (const d of scanShaderDeepParams(source || '')) {
			if (!d.spans.some((ds) => taken.some((ts) => ds.start < ts.end && ts.start < ds.end))) out.push({ ...d, passKey })
		}
	}
	push('common', cfg?.common)
	for (const key of PASS_KEYS) if (cfg?.passes?.[key]?.source) push(key, cfg.passes[key].source)
	return assignKeys(out)
}

/**
 * Stable identity that survives editing a NEIGHBOURING literal (numbers are masked out of the
 * context) — the manifest and presets are keyed by this. Duplicates get an occurrence suffix.
 */
export function assignKeys(params) {
	const seen = new Map()
	for (const p of params) {
		const base = p.deep
			? `${p.passKey}:${String(p.context || p.name).replace(/^#\d+ /, '').replace(/\d*\.\d+|\d+\.?\d*/g, '0')}`
			: `${p.passKey}:${p.name}`
		const n = seen.get(base) || 0
		seen.set(base, n + 1)
		p.key = n ? `${base}~${n}` : base
	}
	return params
}

const AUDIO_NAME_RE = /freq|bass|beat|audio|sound|fft|spectrum|volume|treble|\bmids?\b/i
/* Evidence that a vec3 of 0–1 literals really is a COLOUR (vs a box size or a direction). */
const COLOR_EVIDENCE_RE = /\b\w*(col|colour|color|tint|rgb|hue|paint|sky|fog|glow|shade|back|bg)\w*\b|\bmix\s*\(/i
const NOT_COLOR_RE = /sd[A-Z]\w*\s*\(|\blength\s*\(|normalize|cross|reflect|\bdot\s*\(|\b(rd|ro|dir|normal)\b/

/**
 * Role comes from the NAME the decoder gave the literal — never from its generic fallback
 * phrases ("strength multiplier on the value next to it" fits every `x * 0.3`).
 * @returns {'color'|'speed'|'zoom'|'size'|'intensity'|'detail'|'audio'|'other'}
 */
export function roleOf(p) {
	if (p.kind === 'color') return 'color'
	const name = String(p.name || '').replace(/ #\d+$/, '')
	const desc = String(p.desc || '')
	if (AUDIO_NAME_RE.test(name)) return 'audio'
	if (/speed/i.test(name)) return 'speed'
	if (/\bscale\b|zoom/i.test(name)) return 'zoom'
	if (/radius|size|width|height/i.test(name) || /^size \//.test(desc)) return 'size'
	if (/iter|octave/i.test(name) || /^iteration count/.test(desc)) return 'detail'
	if (/bright|glow|intens|gain|opacity|alpha|fade|contrast|exponent|falloff|mix amount|sensitiv|strength|amount|^(col|color|rgb) level/i.test(name) || /^(falloff|curve\/contrast|blend amount)/.test(desc)) return 'intensity'
	return 'other'
}

const ROLE_BASE = { speed: 6, zoom: 5, size: 5, intensity: 5, detail: 5, audio: 4, color: 3, other: 0 }

/** Higher = more likely a value a human wants to ride. ≥ MIN_SCORE makes the main panel. */
export function scoreParam(p, role = roleOf(p)) {
	let s = ROLE_BASE[role]
	if (!p.deep) return Math.max(s, 5) + 1 // author-declared const/#define — the shader's own knobs
	const expr = p.expr || ''
	if (/texture\w*\s*\(|texelFetch\s*\(/.test(expr)) s -= 6 // lookup coordinates, not looks
	if (p.kind === 'color') {
		const [r, g, b] = p.values
		const spread = Math.max(r, g, b) - Math.min(r, g, b)
		if (COLOR_EVIDENCE_RE.test(expr)) s += 3
		if (NOT_COLOR_RE.test(expr)) s -= 4
		if (spread < 0.05) s -= r === 0 || r === 1 ? 6 : 3 // black/white/grey accumulators
		return s + Math.min(1.5, spread * 3)
	}
	const v = p.values[0]
	if (role === 'audio' && /sens|gain|amount|factor|level|activity|mult|strength|threshold/i.test(p.name)) s += 1
	if (/\bdot\s*\(|hsv|rgb2|luma|konvert/i.test(expr)) s -= 3 // colour-space maths
	if (v === 0 || v === 1 || v === -1) s -= 3 // structural identities
	if (/iResolution|iMouse/.test(expr)) s -= 4 // (2.0*fragCoord - iResolution) is coordinate plumbing
	if (Math.abs(v) >= 100 || /fract\s*\(\s*sin|hash|rand/i.test(expr)) s -= 4 // hash/noise magic numbers
	if (/fract\s*\(/.test(expr) && Math.abs(v) < 0.5) s -= 3 // fract(p * .1031) — a hash, not a tile count
	return s
}

const SECTION_OF = { speed: 'Motion', zoom: 'Shape', size: 'Shape', intensity: 'Look', detail: 'Look', other: 'Look', color: 'Colour', audio: 'Audio' }

/** A colour's label comes from the variable it initialises, not the arithmetic around it. */
function colorLabel(p) {
	const m = /(?:vec[34]|float)\s+(\w+)\s*=|(\w+)\s*[-+*/]?=[^=]/.exec(p.expr || '')
	const v = m ? m[1] || m[2] : ''
	return !v || /^(col|color|colour|fragColor|c|d|r)$/i.test(v) ? 'Colour' : prettyLabel(v)
}

/** 'SPEED' → 'Speed', 'FREQ_RANGE' → 'Freq range', 'beatMove' → 'Beat move'. */
export function prettyLabel(name) {
	const s = String(name || '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[_\s]+/g, ' ')
		.trim()
		.toLowerCase()
	return s ? s[0].toUpperCase() + s.slice(1) : 'Value'
}

/** True when the literal DIVIDES (`iTime / ◆`) — a macro must then scale it by 1/k, or "faster" runs backwards. */
export const isDivisor = (p) => /\/\s*$/.test(String(p.expr || '').split('◆')[0])

const isToggle = (p) => !p.deep && p.vec === 1 && p.intLiteral && (p.values[0] === 0 || p.values[0] === 1)

/**
 * @typedef {Object} Control
 * @property {string} id
 * @property {'slider'|'color'|'toggle'|'macro'} widget
 * @property {string} label
 * @property {string} section
 * @property {string[]} keys  param keys this control drives (1 unless macro)
 * @property {string[]} [inverse]  macro members that are divisors (driven by base / k)
 * @property {string} hint    one-line "what does this do"
 * @property {boolean} pinned
 */

/**
 * @param {Array<object>} params  scanShaderCfg() output
 * @param {{ manifest?: object|null, labelOf?: (p: object) => string|undefined }} [opts]
 * @returns {{ controls: Control[], hiddenCount: number }}
 */
export function buildControls(params, opts = {}) {
	const manifest = opts.manifest || {}
	const hidden = new Set(manifest.hidden || [])
	const pins = new Map((manifest.pinned || []).map((x) => [x.key, x]))
	const labelOf = (p) => opts.labelOf?.(p) || (p.deep && p.kind === 'color' ? colorLabel(p) : prettyLabel(p.name))
	const rows = params.map((p) => {
		const role = roleOf(p)
		return { p, role, score: hidden.has(p.key) ? -99 : scoreParam(p, role) }
	})

	/** @type {Control[]} */
	const out = []
	const used = new Set()
	const add = (c) => {
		out.push(c)
		c.keys.forEach((k) => used.add(k))
	}
	const single = (r, pinned) => {
		const p = r.p
		const pin = pins.get(p.key)
		const widget = p.kind === 'color' ? 'color' : isToggle(p) ? 'toggle' : 'slider'
		return {
			id: p.key,
			widget,
			label: pin?.label || labelOf(p),
			section: pin?.section || SECTION_OF[r.role],
			keys: [p.key],
			hint: p.desc || (p.deep ? '' : 'declared in the shader source'),
			pinned,
		}
	}

	for (const r of rows) if (pins.has(r.p.key) && !hidden.has(r.p.key)) add(single(r, true))

	// Macros: many time multipliers / coordinate scales → ONE ride-them-all control.
	const macroRoles = [['speed', 'Speed ×', 'Motion', 'multiplies every animation-time rate at once'], ['zoom', 'Zoom ×', 'Shape', 'scales every pattern/coordinate multiplier at once']]
	for (const [role, label, section, hint] of macroRoles) {
		const members = rows.filter((r) => r.role === role && r.p.deep && r.score >= MIN_SCORE && !used.has(r.p.key) && r.p.vec === 1)
		if (members.length >= 2) add({ id: `macro:${role}`, widget: 'macro', label, section, keys: members.map((r) => r.p.key), inverse: members.filter((r) => isDivisor(r.p)).map((r) => r.p.key), hint: `${hint} (${members.length} values)`, pinned: false })
	}

	// Colours — the most vivid few, as a palette.
	rows
		.filter((r) => r.role === 'color' && r.score >= MIN_SCORE && !used.has(r.p.key))
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_COLORS)
		.forEach((r) => add(single(r, false)))

	rows
		.filter((r) => r.role !== 'color' && r.score >= MIN_SCORE && !used.has(r.p.key))
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(0, MAX_SLIDERS - out.filter((c) => c.widget !== 'color').length))
		.forEach((r) => add(single(r, false)))

	const order = new Map(params.map((p, i) => [p.key, i]))
	out.sort(
		(a, b) =>
			SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
			(order.get(a.keys[0]) ?? 0) - (order.get(b.keys[0]) ?? 0),
	)
	// Twins ("Colour", "Colour") become "Colour 1", "Colour 2".
	const counts = new Map()
	for (const c of out) counts.set(c.label, (counts.get(c.label) || 0) + 1)
	const nth = new Map()
	for (const c of out) {
		if (counts.get(c.label) < 2) continue
		const n = (nth.get(c.label) || 0) + 1
		nth.set(c.label, n)
		c.label = `${c.label} ${n}`
	}

	return { controls: out, hiddenCount: params.length - used.size }
}

/** Current macro multiplier: mean of value / pristine over the targets (1 when untouched). */
export function macroFactor(params, control, pristineByKey) {
	const ratios = []
	for (const k of control.keys) {
		const p = params.find((x) => x.key === k)
		const base = pristineByKey.get(k)?.[0]
		if (p && base) ratios.push(control.inverse?.includes(k) ? base / p.values[0] : p.values[0] / base)
	}
	return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1
}
