/**
 * shader-param-describe.js — a SENTENCE about what tweaking this literal will visually do
 * (todos27.07.26, owner: "still looking at all the parameters i have no idea what which will
 * do"). Recognizes the common shader idioms around the span; falls back to a neutral phrase.
 * Works on the MASKED source (offsets match the scan spans).
 */

const TIME_RE = /\b(iTime|iGlobalTime|time)\b/i
const COORD_RE = /\b(uv|st|p|q|pos|coord|fragCoord)\b/i

/** Innermost→outward chain of enclosing call names around [start] (max 3). */
function callChain(masked, start) {
	const out = []
	let i = start
	for (let hop = 0; hop < 3; hop++) {
		let depth = 0
		let found = -1
		for (let j = i - 1; j >= 0 && j > i - 400; j--) {
			const c = masked[j]
			if (c === ')') depth++
			else if (c === '(') {
				if (depth > 0) depth--
				else {
					found = j
					break
				}
			} else if (c === ';' || c === '{' || c === '}') break
		}
		if (found < 0) break
		const m = masked.slice(Math.max(0, found - 40), found).match(/([A-Za-z_]\w*)\s*$/)
		out.push(m ? m[1] : '')
		i = found
	}
	return out
}

/**
 * @param {string} masked
 * @param {number} start
 * @param {number} end
 * @param {'color'|'slider'} kind
 * @returns {string} short phrase ('' when nothing better than the generic name exists)
 */
export function describeParam(masked, start, end, kind) {
	if (kind === 'color') return 'a color used by the shader'
	const pre = masked.slice(Math.max(0, start - 70), start)
	const post = masked.slice(end, end + 50)
	const around = pre + '◆' + post
	const chain = callChain(masked, start)
	const inner = chain[0] || ''

	// for-loop bound
	if (/for\s*\([^)]*[<>]=?\s*$/.test(pre)) return 'iteration count — more = finer detail, slower render'

	// length(p) - ◆  /  ◆ - length(p)
	if (/length\s*\([^)]*\)\s*[-+]\s*$/.test(pre)) return 'size / radius of the shape'
	// exp(-◆*x) or exp(-x*◆)
	if (inner === 'exp' && /-\s*$/.test(pre.replace(/[\d.\s]*$/, ''))) return 'falloff — higher = tighter glow'
	if (inner === 'exp') return 'exponential response — small changes act strongly'
	if (inner === 'pow') return 'curve/contrast — higher = harder edges'
	if (inner === 'mix') return 'blend amount between two looks (0 → first, 1 → second)'
	if (inner === 'smoothstep' || inner === 'step') return 'threshold/edge — where the transition sits'
	if (inner === 'clamp') return 'limit on the value range'
	if (inner === 'mod' || inner === 'fract') return 'repetition — pattern tiling/wrap'

	const mulTime = (TIME_RE.test(pre) && /[*\/]\s*$/.test(pre)) || (/^\s*[*\/]/.test(post) && TIME_RE.test(post))
	const mulCoord = (COORD_RE.test(pre) && /[*\/]\s*$/.test(pre)) || (/^\s*[*\/]/.test(post) && COORD_RE.test(post))
	if (inner === 'sin' || inner === 'cos') {
		if (mulTime || TIME_RE.test(around)) return 'wave speed — how fast it oscillates'
		if (mulCoord) return 'wave frequency — more = tighter ripples'
		return 'wave shaping (phase/offset)'
	}
	if (mulTime) return 'animation speed'
	if (mulCoord) return 'pattern scale/zoom — higher = more repeats'
	if (/[-+]\s*$/.test(pre) && COORD_RE.test(pre)) return 'position offset'
	if (/[*\/]\s*$/.test(pre) || /^\s*[*\/]/.test(post)) return 'strength multiplier on the value next to it'
	if (/[-+]\s*$/.test(pre) || /^\s*[-+]/.test(post)) return 'offset added into the calculation'
	return ''
}
