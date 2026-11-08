'use strict'

/**
 * WO-1000 — a FragCoord shader's own controls (`uniform float u_x; //default, [min, max]`) for the Shader Live session
 * (shader-live-session.js view, shader-live-ops.js set / reset). The values live in `cfg.values` ({ u_x: number[] }),
 * which the Godot runner reads into its UBO slots without a recompile (fragcoord_rd.gd use / fragcoord_glsl.gd slot_values).
 *
 * The parse MUST match fragcoord_glsl.gd `uniforms()` — the GPU side computes its own defaults from the same text:
 * common first, then pass1..8, then main; first declaration wins; built-ins and u_passN skipped; at most 16 value slots;
 * default = the initialiser, else the comment before `[`; no default → 0 pulled into the range; the last number fills a
 * vector. A key in the session is `u:<name>` so it never collides with a literal param key.
 */

const { FC_PASS_KEYS } = require('./fragcoord-config')

const SLOTS = 16
const PREFIX = 'u:'
const BUILTINS = new Set([
	'u_resolution', 'u_time', 'u_time_delta', 'u_mouse', 'u_date', 'u_camera_pos', 'u_refresh_rate', 'u_camera_dir',
	'u_scroll', 'u_camera_view', 'u_drag', 'u_frame', 'u_color_gamut', 'u_recursion', 'u_max_recursion', 'u_audio',
	'u_keyboard', 'u_webcam', 'u_main', 'fragColor',
]) // prettier-ignore
const TEXTURE_TYPES = new Set(['sampler2D', 'sampler3D', 'samplerCube'])
const VALUE_TYPES = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 }
const UNIFORM_RE =
	/^[ \t]*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*(?:=\s*([^;]*))?;[ \t]*(?:\/\/([^\n]*))?/gm
const NUM_RE = /(?<![\w.])[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
const RANGE_RE = /\[\s*([^\],]+),\s*([^\]]+)\]/

const nums = (s) => (String(s).match(NUM_RE) || []).map(Number)
const src = (p) => (p && typeof p === 'object' ? String(p.source || '') : '')

/**
 * The value uniforms of a FragCoord config, in slot order.
 * @returns {Array<{ name: string, type: string, n: number, values: number[], min?: number, max?: number }>}
 */
function fragcoordUniforms(cfg) {
	const ps = cfg?.passes || {}
	if (!src(ps.main).trim()) return []
	const order = [...FC_PASS_KEYS.slice(1), 'main'] // pass1..8, then main (FragCoord's draw order)
	const texts = [String(cfg.common || ''), ...order.map((k) => src(ps[k])).filter((t) => t.trim())]
	const out = []
	const seen = new Set()
	for (const t of texts) {
		for (const m of t.matchAll(UNIFORM_RE)) {
			const [, type, name, init = '', note = ''] = m
			if (BUILTINS.has(name) || name.startsWith('u_pass') || seen.has(name)) continue
			if (TEXTURE_TYPES.has(type)) {
				seen.add(name)
				continue
			}
			if (!(type in VALUE_TYPES) || out.length >= SLOTS) continue
			seen.add(name)
			const n = VALUE_TYPES[type]
			const vals = nums(init !== '' ? init : note.split('[')[0])
			const r = note.match(RANGE_RE)
			const lo = r ? parseFloat(r[1]) : NaN
			const hi = r ? parseFloat(r[2]) : NaN
			if (!vals.length && r) vals.push(Math.min(Math.max(0, lo), hi))
			while (vals.length < n) vals.push(vals.length ? vals[vals.length - 1] : 0)
			const u = { name, type, n, values: vals.slice(0, n) }
			if (r && Number.isFinite(lo) && Number.isFinite(hi)) Object.assign(u, { min: lo, max: hi })
			out.push(u)
		}
	}
	return out
}

/** The current values of `u` from a `values` map (a number or an array, short arrays keep the default for the rest). */
function valuesOf(u, values) {
	const o = values && typeof values === 'object' ? values[u.name] : undefined
	const given = typeof o === 'number' ? [o] : Array.isArray(o) ? o : []
	return u.values.map((d, i) => (Number.isFinite(given[i]) ? given[i] : d))
}

/** Widget hints: a vec3/vec4 in 0..1 is a colour (FragCoord's rule); ints and bools step by 1. */
function widgetOf(u, cur) {
	if ((u.type === 'vec3' || u.type === 'vec4') && u.min === 0 && u.max === 1)
		return { kind: 'color', min: 0, max: 1, step: 0.01 }
	if (u.type === 'bool') return { kind: 'toggle', min: 0, max: 1, step: 1 }
	const lo = Number.isFinite(u.min) ? u.min : Math.min(0, ...cur, ...u.values)
	const hi = Number.isFinite(u.max) ? u.max : Math.max(1, ...[...cur, ...u.values].map((v) => (v > 0 ? v * 2 : 0)))
	const step = u.type === 'int' ? 1 : Math.max(0.0001, Number(((hi - lo) / 200).toPrecision(2)))
	return { kind: 'float', min: lo, max: hi, step }
}

/**
 * What the Shader Live view lists for a FragCoord shader: param-like rows the Godot value widgets draw.
 * @param {object} cfg the session's working config
 * @param {object} pristine the library's `values` when the session opened
 */
function uniformParams(cfg, pristine) {
	if (cfg?.dialect !== 'fragcoord') return []
	return fragcoordUniforms(cfg).map((u) => {
		const values = valuesOf(u, cfg.values)
		return {
			key: PREFIX + u.name,
			name: u.name,
			type: u.type,
			vec: u.n,
			values,
			defaults: u.values,
			...widgetOf(u, values),
			changed: JSON.stringify(values) !== JSON.stringify(valuesOf(u, pristine)),
		}
	})
}

const isUniformKey = (key) => String(key ?? '').startsWith(PREFIX)

/**
 * `set` / `reset` on a `u:` key: `next` = the new values (clamped into the declared range), or null = back to the
 * library's value. Mutates `cfg.values`; returns an error string or ''.
 */
function setUniform(cfg, key, next, pristine) {
	const name = String(key).slice(PREFIX.length)
	const u = fragcoordUniforms(cfg).find((x) => x.name === name)
	if (!u) return `unknown uniform ${name}`
	const values = { ...(cfg.values && typeof cfg.values === 'object' ? cfg.values : {}) }
	if (next == null) {
		if (pristine && pristine[name] !== undefined) values[name] = pristine[name]
		else delete values[name]
	} else {
		if (!Array.isArray(next) || next.length !== u.n || next.some((v) => !Number.isFinite(Number(v))))
			return `bad values for ${name}`
		const clamp = (v) => (Number.isFinite(u.min) && Number.isFinite(u.max) ? Math.min(u.max, Math.max(u.min, v)) : v)
		const vals = next.map((v) => clamp(u.type === 'int' || u.type === 'bool' ? Math.round(Number(v)) : Number(v)))
		values[name] = u.n === 1 ? vals[0] : vals
	}
	cfg.values = values
	return ''
}

module.exports = { SLOTS, PREFIX, fragcoordUniforms, uniformParams, isUniformKey, setUniform, valuesOf }
