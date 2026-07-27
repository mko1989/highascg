/**
 * WO-340 — shader parameter scanner: detects tweakable float/color literals
 * in GLSL source code and provides rewrite capability for live updates.
 * Pure functions, no DOM/browser APIs (runs in node).
 */

/**
 * @typedef {Object} Param
 * @property {string} name
 * @property {'color'|'slider'} kind
 * @property {number[]} values
 * @property {Array<{start: number, end: number}>} spans
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {1|2|3|4} vec
 */

const SKIP_NAMES = new Set(['PI', 'TAU', 'EPS', 'EPSILON', 'E', 'INFINITY'])

/** @param {string} text @returns {number | null} */
function parseFloatLiteral(text) {
	const trimmed = text.trim()
	if (!/^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/.test(trimmed)) return null
	const n = parseFloat(trimmed)
	return Number.isFinite(n) ? n : null
}

/** @param {string} source @param {number} lineStart @param {string} lineText @returns {Array<{value: number, start: number, end: number}>} */
function extractFloatLiteralsFromLine(source, lineStart, lineText) {
	const floats = []
	const re = /-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)/g
	let match
	while ((match = re.exec(lineText)) !== null) {
		const value = parseFloatLiteral(match[0])
		if (value !== null) {
			floats.push({ value, start: lineStart + match.index, end: lineStart + match.index + match[0].length })
		}
	}
	return floats
}

/**
 * Scan shader source for tweakable parameters.
 * @param {string} source
 * @returns {Param[]}
 */
export function scanShaderParams(source) {
	const params = []
	const lines = source.split('\n')

	let inBlockComment = false
	let lineStart = 0

	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const lineText = lines[lineIdx]
		let lineInBlock = inBlockComment
		for (let i = 0; i < lineText.length; i++) {
			if (!inBlockComment && lineText[i] === '/' && lineText[i + 1] === '*') {
				inBlockComment = true
				i++
			} else if (inBlockComment && lineText[i] === '*' && lineText[i + 1] === '/') {
				inBlockComment = false
				i++
			}
		}
		if (lineInBlock) { lineStart += lineText.length + 1; continue }
		const commentIdx = lineText.indexOf('//')
		const effectiveText = commentIdx >= 0 ? lineText.substring(0, commentIdx) : lineText
		const trailingComment = commentIdx >= 0 ? lineText.substring(commentIdx + 2) : ''

		const m1 = /^\s*#define\s+([A-Za-z_]\w*)\s+([-0-9.]+(?:[eE][+-]?[0-9]+)?)\s*$/.exec(effectiveText)
		if (m1 && !SKIP_NAMES.has(m1[1])) {
			const floatTexts = extractFloatLiteralsFromLine(source, lineStart, effectiveText)
			if (floatTexts.length === 1) {
				const p = createParamFromAnnotation(m1[1], [floatTexts[0].value], [floatTexts[0]], 1, trailingComment, source)
				if (p) params.push(p)
			}
			lineStart += lineText.length + 1; continue
		}

		const m2 = /^\s*#define\s+([A-Za-z_]\w*)\s+vec([234])\s*\(\s*(.*?)\s*\)\s*$/.exec(effectiveText)
		if (m2 && !SKIP_NAMES.has(m2[1])) {
			const vecSize = parseInt(m2[2], 10), vecStart = lineStart + effectiveText.indexOf(m2[3])
			const floatTexts = extractFloatLiteralsFromLine(source, vecStart, m2[3])
			if (floatTexts.length === vecSize) {
				const p = createParamFromAnnotation(m2[1], floatTexts.map(f => f.value), floatTexts, vecSize, trailingComment)
				if (p) params.push(p)
			}
			lineStart += lineText.length + 1; continue
		}

		const m3 = /^\s*const\s+float\s+([A-Za-z_]\w*)\s*=\s*(.*?)\s*;\s*$/.exec(effectiveText)
		if (m3 && !SKIP_NAMES.has(m3[1]) && !/[a-zA-Z_()[\]{}+\-*/%]/.test(m3[2])) {
			const floatTexts = extractFloatLiteralsFromLine(source, lineStart, effectiveText)
			if (floatTexts.length === 1) {
				const p = createParamFromAnnotation(m3[1], [floatTexts[0].value], [floatTexts[0]], 1, trailingComment, source)
				if (p) params.push(p)
			}
			lineStart += lineText.length + 1; continue
		}

		const m4 = /^\s*const\s+vec([234])\s+([A-Za-z_]\w*)\s*=\s*vec\1\s*\((.*?)\)\s*;\s*$/.exec(effectiveText)
		if (m4 && !SKIP_NAMES.has(m4[2])) {
			const vecSize = parseInt(m4[1], 10), vecStart = lineStart + effectiveText.indexOf(m4[3])
			const floatTexts = extractFloatLiteralsFromLine(source, vecStart, m4[3])
			if (floatTexts.length === vecSize) {
				const p = createParamFromAnnotation(m4[2], floatTexts.map(f => f.value), floatTexts, vecSize, trailingComment)
				if (p) params.push(p)
			}
			lineStart += lineText.length + 1; continue
		}

		lineStart += lineText.length + 1
	}

	return params
}

/**
 * Create a Param from parsed values and optional annotation.
 * @param {string} name
 * @param {number[]} values
 * @param {Array<{value: number, start: number, end: number}>} floatTexts
 * @param {1|2|3|4} vecSize
 * @param {string} annotation - trailing comment text after //
 * @param {string} [source] - full source text (for calculating step from original literals)
 * @returns {Param | null}
 */
function createParamFromAnnotation(name, values, floatTexts, vecSize, annotation, source) {
	const spans = floatTexts.map(f => ({ start: f.start, end: f.end }))
	const sliderMatch = /@slider\s*\(\s*([-0-9.]+)\s*,\s*([-0-9.]+)(?:\s*,\s*([-0-9.]+))?\s*\)/.exec(annotation)
	const colorMatch = /@color/.exec(annotation)
	if (sliderMatch) return { name, kind: 'slider', values, spans, min: parseFloat(sliderMatch[1]), max: parseFloat(sliderMatch[2]), step: sliderMatch[3] ? parseFloat(sliderMatch[3]) : calculateStep(values, floatTexts, source), vec: vecSize }
	if (colorMatch && vecSize >= 3) return { name, kind: 'color', values, spans, min: 0, max: 1, step: 0.01, vec: vecSize }
	if (vecSize >= 3 && values.every(v => v >= 0 && v <= 1)) return { name, kind: 'color', values, spans, min: 0, max: 1, step: 0.01, vec: vecSize }
	const minVal = values[0], min = minVal > 0 ? 0 : minVal < 0 ? 4 * minVal : 0, max = minVal > 0 ? 4 * minVal : minVal < 0 ? -4 * minVal : 1
	return { name, kind: 'slider', values, spans, min, max, step: calculateStep(values, floatTexts, source), vec: vecSize }
}

/**
 * Calculate step from the maximum number of decimal places in any value.
 * Uses source text if available to determine actual decimal places.
 * @param {number[]} values
 * @param {Array<{value: number, start: number, end: number}>} [floatTexts]
 * @param {string} [source]
 * @returns {number}
 */
function calculateStep(values, floatTexts, source) {
	let maxDecimals = 0

	// Try to extract decimals from original source text
	if (floatTexts && source) {
		for (const ft of floatTexts) {
			const text = source.slice(ft.start, ft.end)
			const decIdx = text.indexOf('.')
			if (decIdx >= 0) {
				const decimals = text.length - decIdx - 1
				maxDecimals = Math.max(maxDecimals, decimals)
			}
		}
	} else {
		// Fallback: use parsed values (loses precision info)
		for (const v of values) {
			const str = String(v)
			const decIdx = str.indexOf('.')
			if (decIdx >= 0) {
				const decimals = str.length - decIdx - 1
				maxDecimals = Math.max(maxDecimals, decimals)
			}
		}
	}

	if (maxDecimals === 0) {
		return 1
	}

	const step = Math.pow(10, -maxDecimals)
	return Math.max(0.001, Math.min(1, step))
}

/**
 * Rewrite parameter values in source by splicing new formatted numbers into spans.
 * Processes spans right-to-left to preserve earlier offsets.
 * @param {string} source
 * @param {Param} param
 * @param {number[]} newValues
 * @returns {string}
 * @throws if newValues.length doesn't match spans.length or source has drifted
 */
export function rewriteParamValues(source, param, newValues) {
	if (newValues.length !== param.spans.length) {
		throw new Error(
			`rewriteParamValues: length mismatch (param.spans=${param.spans.length}, newValues=${newValues.length})`,
		)
	}

	// Validate spans and source hasn't drifted
	for (const span of param.spans) {
		const text = source.slice(span.start, span.end)
		if (parseFloatLiteral(text) === null) {
			throw new Error(`rewriteParamValues: source drifted at span [${span.start}, ${span.end})`)
		}
	}

	// Build edits right-to-left
	const edits = []
	for (let i = param.spans.length - 1; i >= 0; i--) {
		edits.push({ span: param.spans[i], value: newValues[i] })
	}

	let result = source
	for (const edit of edits) {
		const formatted = formatFloat(edit.value)
		result = result.slice(0, edit.span.start) + formatted + result.slice(edit.span.end)
	}

	return result
}

/**
 * Format a number for GLSL: round to 4 decimals, trim trailing zeros,
 * but always keep at least one decimal digit.
 * @param {number} value
 * @returns {string}
 */
function formatFloat(value) {
	// Round to 4 decimals
	const rounded = Math.round(value * 10000) / 10000
	let str = rounded.toString()

	// If no decimal point, add .0
	if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
		return str + '.0'
	}

	// For scientific notation, return as-is
	if (str.includes('e') || str.includes('E')) {
		return str
	}

	// Trim trailing zeros but keep at least one decimal digit
	str = str.replace(/0+$/, '')
	if (str.endsWith('.')) {
		str += '0'
	}

	return str
}

/**
 * Scan all pass sources (image, bufferA, etc.) and common source for parameters.
 * @param {Object} passes - { image: {source}, bufferA: {source} | null, ... }
 * @param {string} common - common GLSL source
 * @returns {Array<Param & { passKey: 'common'|'image'|'bufferA'|... }>}
 */
export function scanAllPassSources(passes, common) {
	const allParams = []

	// Scan common first
	for (const param of scanShaderParams(common)) {
		allParams.push({ ...param, passKey: 'common' })
	}

	// Scan each pass
	for (const [passKey, passConfig] of Object.entries(passes)) {
		if (!passConfig || !passConfig.source) continue
		for (const param of scanShaderParams(passConfig.source)) {
			allParams.push({ ...param, passKey })
		}
	}

	return allParams
}

/* ────────────────────────────────────────────────────────────────────────────
 * WO-345 follow-up (owner 2026-07-27): AUTO-extract tweakables from the shader
 * BODY — no code changes by the user. GLSL discriminator: float literals always
 * carry a decimal point; integers (loop bounds, indices, swizzle math) do not —
 * so every decimal literal outside comments/defines is a safe ride candidate.
 * vec3(a,b,c) with all components in [0,1] groups into a color picker.
 * Same Param shape as scanShaderParams → rewriteParamValues works unchanged.
 * ──────────────────────────────────────────────────────────────────────────── */

const DEEP_PARAM_CAP = 48

/** Mask comments and preprocessor lines with spaces (offsets preserved). */
function maskNonCode(source) {
	let s = String(source)
	s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
	s = s.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
	s = s.replace(/^[ \t]*#[^\n]*/gm, (m) => ' '.repeat(m.length))
	return s
}

function deepRange(v) {
	const av = Math.abs(v)
	if (av === 0) return { min: -1, max: 1, step: 0.01 }
	const span = av * 4
	const step = Math.max(0.0001, Math.min(1, Math.pow(10, Math.floor(Math.log10(av)) - 2)))
	return { min: v < 0 ? -span : 0, max: v < 0 ? span / 4 : span, step }
}

function contextLabel(source, start, end, idx) {
	const pre = source.slice(Math.max(0, start - 14), start).replace(/\s+/g, ' ')
	const post = source.slice(end, end + 10).replace(/\s+/g, ' ')
	return `#${idx + 1} ${pre}◆${post}`.trim()
}

/**
 * Scan a shader source for ALL tweakable decimal literals in the code body.
 * @param {string} source
 * @returns {Array<{name:string,kind:'color'|'slider',values:number[],spans:Array<{start:number,end:number}>,min:number,max:number,step:number,vec:1|3,deep:true}>}
 */
export function scanShaderDeepParams(source) {
	const src = String(source || '')
	const masked = maskNonCode(src)
	const lits = []
	const re = /(\d+\.\d*|\.\d+)/g
	let m
	while ((m = re.exec(masked)) !== null) {
		const start = m.index
		const end = start + m[0].length
		// Not part of an identifier / swizzle chain (e.g. `foo.5` cannot occur; guard anyway).
		const before = masked[start - 1]
		if (before && /[\w.]/.test(before)) continue
		if (/[\w.]/.test(masked[end] || '')) continue
		lits.push({ start, end, value: parseFloat(m[0]) })
		if (lits.length > DEEP_PARAM_CAP * 4) break
	}

	const out = []
	const used = new Set()
	// Pass 1: vec3(lit, lit, lit) with all comps in [0,1] → color.
	const vecRe = /vec3\s*\(/g
	let vm
	while ((vm = vecRe.exec(masked)) !== null) {
		const openIdx = vm.index + vm[0].length - 1
		const comps = lits.filter((l) => l.start > openIdx && l.start < openIdx + 60 && !used.has(l.start))
		if (comps.length < 3) continue
		const three = comps.slice(0, 3)
		const closeIdx = masked.indexOf(')', openIdx)
		if (closeIdx < 0 || three[2].end > closeIdx) continue
		const between = masked.slice(openIdx + 1, closeIdx)
		// Only pure literal args (commas + whitespace + the literals themselves).
		if (/[a-zA-Z_]/.test(between)) continue
		if (!three.every((l) => l.value >= 0 && l.value <= 1)) continue
		three.forEach((l) => used.add(l.start))
		out.push({
			name: contextLabel(src, vm.index, closeIdx + 1, out.length),
			kind: 'color',
			values: three.map((l) => l.value),
			spans: three.map((l) => ({ start: l.start, end: l.end })),
			min: 0,
			max: 1,
			step: 0.01,
			vec: 3,
			deep: true,
		})
		if (out.length >= DEEP_PARAM_CAP) return out
	}
	// Pass 2: remaining literals → individual sliders.
	for (const l of lits) {
		if (used.has(l.start)) continue
		const r = deepRange(l.value)
		out.push({
			name: contextLabel(src, l.start, l.end, out.length),
			kind: 'slider',
			values: [l.value],
			spans: [{ start: l.start, end: l.end }],
			min: r.min,
			max: r.max,
			step: r.step,
			vec: 1,
			deep: true,
		})
		if (out.length >= DEEP_PARAM_CAP) break
	}
	return out
}
