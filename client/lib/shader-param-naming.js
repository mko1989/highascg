/**
 * shader-param-naming.js — turn a raw GLSL literal into a HUMAN name + category (todos27.07.26,
 * owner: "i cant belive the simple shader code cant be decoded to be human readable parameters
 * in cattegories"). Works on the MASKED source (comments/#-lines blanked) so offsets line up
 * with shader-param-scan spans. Pure string heuristics — no GLSL parser needed for naming:
 *   float speed = ◆;        → "speed"
 *   p.x += ◆                → "p.x"
 *   mix(a, b, ◆)            → "mix amount"
 *   sin(iTime * ◆)          → "speed"          (multiplies time)
 *   uv * ◆                  → "scale"          (multiplies coords)
 *   for (i=0; i<◆; i++)     → "iterations"
 * Every result also carries the ordinal so twins stay distinguishable ("speed", "speed #2").
 */

/** Known function → per-argument role names (1-based gaps fall back to "arg N"). */
const FN_ARGS = {
	mix: [null, null, 'mix amount'],
	pow: ['base', 'exponent'],
	smoothstep: ['edge low', 'edge high', null],
	step: ['edge', null],
	clamp: [null, 'min', 'max'],
	mod: [null, 'divisor'],
	fract: [null],
	exp: ['exponent'],
	atan: [null, null],
	reflect: [null, null],
	refract: [null, null, 'ior'],
	vec2: ['x', 'y'],
	vec3: ['x', 'y', 'z'],
	vec4: ['x', 'y', 'z', 'w'],
}

const TIME_ID_RE = /^(iTime|iGlobalTime|time|t|iFrame)$/i
const COORD_ID_RE = /^(uv|st|p|q|pos|coord|fragCoord|xy)$/i

/** Statement window around the literal (masked source). */
function statementAround(masked, start) {
	let a = start
	while (a > 0 && !';{}'.includes(masked[a - 1])) a--
	let b = start
	while (b < masked.length && !';{}'.includes(masked[b])) b++
	return { text: masked.slice(a, start), from: a, tail: masked.slice(start, b) }
}

/** Nearest enclosing call: walk back over balanced parens; return { fn, argIndex } or null. */
function enclosingCall(masked, start, stmtFrom) {
	let depth = 0
	let commas = 0
	for (let i = start - 1; i >= stmtFrom; i--) {
		const c = masked[i]
		if (c === ')') depth++
		else if (c === ',' && depth === 0) commas++
		else if (c === '(') {
			if (depth > 0) {
				depth--
				continue
			}
			const m = masked.slice(stmtFrom, i).match(/([A-Za-z_]\w*)\s*$/)
			return { fn: m ? m[1] : '', argIndex: commas }
		}
	}
	return null
}

/** The identifier a literal multiplies/divides (either side), or ''. */
function multipliedIdent(masked, start, end) {
	const pre = masked.slice(Math.max(0, start - 40), start)
	const post = masked.slice(end, end + 40)
	const m1 = pre.match(/([A-Za-z_][\w.]*)\s*[*/]\s*$/)
	if (m1) return m1[1].split('.')[0]
	const m2 = post.match(/^\s*[*/]\s*([A-Za-z_][\w.]*)/)
	if (m2) return m2[1].split('.')[0]
	return ''
}

/**
 * @param {string} masked maskNonCode(source) — spans must match scan offsets
 * @param {number} start literal span start
 * @param {number} end literal span end
 * @param {'color'|'slider'} kind
 * @returns {{ label: string, category: string }}
 */
export function nameDeepParam(masked, start, end, kind) {
	const stmt = statementAround(masked, start)
	let label = ''

	// for-loop bound → iterations. Checked on the raw window (the ';' inside `for(...)`
	// truncates the statement slice, so stmt.text never contains the `for(` itself).
	if (/for\s*\([^)]*[<>]=?\s*$/.test(masked.slice(Math.max(0, start - 60), start))) {
		return { label: 'iterations', category: 'Detail' }
	}

	// Declaration init: float speed = ...◆
	const decl = stmt.text.match(/(?:const\s+)?(?:float|int|vec[234])\s+([A-Za-z_]\w*)\s*=[^=]*$/)
	// Assignment: brightness *= ◆ / p.x = ◆ (the = must not be ==)
	const assign = !decl && stmt.text.match(/(?:^|[^=<>!+\-*/])([A-Za-z_][\w.]*)\s*(?:[-+*/]?=)\s*[^=]*$/)
	const target = decl ? decl[1] : assign ? assign[1] : ''

	const call = enclosingCall(masked, start, stmt.from)
	const mulId = multipliedIdent(masked, start, end)

	if (call && FN_ARGS[call.fn]) {
		const role = FN_ARGS[call.fn][call.argIndex]
		if (role) label = target ? `${target} ${role}` : role
	}
	if (!label && mulId) {
		if (TIME_ID_RE.test(mulId)) label = target ? `${target} speed` : 'speed'
		else if (COORD_ID_RE.test(mulId)) label = target ? `${target} scale` : 'scale'
		else label = `${mulId} factor`
	}
	if (!label && call && call.fn && !FN_ARGS[call.fn]) {
		label = target ? `${target} (${call.fn})` : `${call.fn} arg ${call.argIndex + 1}`
	}
	if (!label && target) label = target
	if (!label) label = kind === 'color' ? 'color' : 'value'

	return { label, category: categorize(label, mulId, kind, stmt) }
}

function categorize(label, mulId, kind, stmt) {
	if (kind === 'color') return 'Colors'
	const hay = `${label} ${mulId} ${stmt.text.slice(-48)}`.toLowerCase()
	if (/speed|time|rate|freq|phase|itime/.test(hay)) return 'Speed & time'
	if (/scale|zoom|size|radius|width|height|dist|uv|coord|offset|pos\b/.test(hay)) return 'Scale & shape'
	if (/iter|steps|octav|count|loop|detail/.test(hay)) return 'Detail'
	if (/bright|contrast|gamma|glow|intens|alpha|opacity|mix|amount|exponent|power|fade/.test(hay)) return 'Intensity'
	return 'Other values'
}

/** Fixed section order for the editor. */
export const DEEP_CATEGORY_ORDER = ['Colors', 'Speed & time', 'Scale & shape', 'Intensity', 'Detail', 'Other values']

/** Suffix duplicate labels with an ordinal so twins stay distinguishable. */
export function dedupeLabels(params) {
	const seen = new Map()
	for (const p of params) {
		const n = seen.get(p.name) || 0
		seen.set(p.name, n + 1)
		if (n > 0) p.name = `${p.name} #${n + 1}`
	}
	return params
}
