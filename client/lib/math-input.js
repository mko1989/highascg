/**
 * Safe math evaluation for number inputs. Supports expressions like 1920/2, 100+50, (960-10)*2.
 * Only allows digits, operators + - * /, parentheses, and decimal point.
 * CSP-safe, no eval (WO-200).
 */
export function evaluateMath(str) {
	if (str == null || typeof str !== 'string') return NaN
	const s = String(str).trim()
	if (!s) return NaN
	// Only allow safe characters
	if (!/^[\d\s+\-*/.()]+$/.test(s)) return NaN
	try {
		const parser = new Parser(s)
		const result = parser.parseExpr()
		// Ensure all tokens were consumed (no dangling operators or parens)
		if (parser.peek()) {
			throw new Error('Unexpected token after expression')
		}
		return typeof result === 'number' && isFinite(result) ? result : NaN
	} catch {
		return NaN
	}
}

/**
 * Recursive descent parser for safe math expressions.
 * Grammar:
 *   expr := term (('+'|'-') term)*
 *   term := factor (('*'|'/') factor)*
 *   factor := NUMBER | '(' expr ')' | ('-'|'+') factor
 */
class Parser {
	constructor(str) {
		this.tokens = this.tokenize(str)
		this.pos = 0
	}

	tokenize(str) {
		const tokens = []
		let i = 0
		while (i < str.length) {
			const ch = str[i]
			// Skip whitespace
			if (/\s/.test(ch)) {
				i++
				continue
			}
			// Parse number (including decimals)
			if (/\d/.test(ch) || (ch === '.' && i + 1 < str.length && /\d/.test(str[i + 1]))) {
				let num = ''
				while (i < str.length && (/\d/.test(str[i]) || str[i] === '.')) {
					num += str[i]
					i++
				}
				tokens.push({ type: 'NUMBER', value: parseFloat(num) })
				continue
			}
			// Parse operators and delimiters
			if ('+-*/()'.includes(ch)) {
				tokens.push({ type: ch, value: ch })
				i++
				continue
			}
			// Invalid character (should have been caught by regex, but be safe)
			throw new Error('Invalid character: ' + ch)
		}
		return tokens
	}

	peek() {
		return this.tokens[this.pos]
	}

	consume() {
		return this.tokens[this.pos++]
	}

	parseExpr() {
		let result = this.parseTerm()
		while (this.peek() && (this.peek().type === '+' || this.peek().type === '-')) {
			const op = this.consume()
			const right = this.parseTerm()
			if (op.type === '+') {
				result = result + right
			} else {
				result = result - right
			}
		}
		return result
	}

	parseTerm() {
		let result = this.parseFactor()
		while (this.peek() && (this.peek().type === '*' || this.peek().type === '/')) {
			const op = this.consume()
			const right = this.parseFactor()
			if (op.type === '*') {
				result = result * right
			} else {
				result = result / right
			}
		}
		return result
	}

	parseFactor() {
		const tok = this.peek()
		if (!tok) {
			throw new Error('Unexpected end of input')
		}

		if (tok.type === 'NUMBER') {
			this.consume()
			return tok.value
		} else if (tok.type === '(') {
			this.consume()
			const result = this.parseExpr()
			if (!this.peek() || this.peek().type !== ')') {
				throw new Error('Missing closing parenthesis')
			}
			this.consume()
			return result
		} else if (tok.type === '+' || tok.type === '-') {
			const op = this.consume()
			const value = this.parseFactor()
			return op.type === '+' ? value : -value
		} else {
			throw new Error('Unexpected token: ' + tok.type)
		}
	}
}

/**
 * Parse inspector input: try math expression first, then plain number.
 * @param {string|number|null|undefined} str
 * @param {number} [fallback=NaN] - used when empty or unparseable
 * @returns {number}
 */
export function parseNumberInput(str, fallback = NaN) {
	if (str == null || str === '') return fallback
	const s = String(str).trim()
	if (!s) return fallback
	const m = evaluateMath(s)
	if (!isNaN(m)) return m
	const v = parseFloat(s)
	return isNaN(v) ? fallback : v
}

/**
 * Create a number input with math evaluation and optional drag-to-adjust.
 * @param {object} opts - { label, value, min, max, step, decimals, onChange, allowMath, placeholder }
 * @returns {{ wrap: HTMLElement, input: HTMLInputElement, setValue: (v: number) => void }}
 */
export function createMathInput(opts) {
	const {
		label,
		value,
		min = -Infinity,
		max = Infinity,
		step = 1,
		decimals = 0,
		onChange,
		allowMath = true,
		placeholder = '',
		dragSensitivity = 0.5,
		slider,
	} = opts

	const wrap = document.createElement('div')
	wrap.className = 'inspector-field'
	const lab = document.createElement('label')
	lab.className = 'inspector-field__label'
	const key = document.createElement('span')
	key.className = 'inspector-field__key'
	key.textContent = label
	const inp = document.createElement('input')
	inp.type = 'text'
	inp.className = 'inspector-field__input inspector-drag-input inspector-math-input'
	inp.value = value != null && value !== '' ? String(value) : ''
	if (placeholder) inp.placeholder = placeholder
	lab.appendChild(key)
	lab.appendChild(inp)
	wrap.appendChild(lab)

	let sliderEl = null
	function syncSlider(val) {
		if (sliderEl && Number.isFinite(val)) {
			sliderEl.value = val
		}
	}

	function parseVal() {
		if (allowMath) {
			const v = parseNumberInput(inp.value, NaN)
			if (!isNaN(v)) return v
		}
		const v = parseFloat(inp.value)
		return isNaN(v) ? (min !== -Infinity ? min : 0) : v
	}

	function formatVal(v) {
		if (decimals >= 0) return Number(v).toFixed(decimals)
		return String(v)
	}

	function apply(v) {
		let n = typeof v === 'number' ? v : parseVal()
		n = Math.max(min, Math.min(max, n))
		inp.value = formatVal(n)
		syncSlider(n)
		onChange?.(n)
	}

	// Drag to adjust — only engage after movement past threshold so click-to-focus still works
	const DRAG_THRESHOLD = 5
	let startX = 0
	let startVal = 0
	let dragging = false
	const mult = step < 1 ? Math.pow(10, Math.ceil(-Math.log10(Math.max(step, 0.0001)))) : 1
	inp.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return
		startX = e.clientX
		startVal = parseVal()
		dragging = false
		const onMove = (ev) => {
			if (!dragging) {
				if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return
				dragging = true
				inp.blur()
			}
			ev.preventDefault()
			const dx = (ev.clientX - startX) * dragSensitivity * step * mult
			startX = ev.clientX
			startVal = Math.max(min, Math.min(max, startVal + dx))
			inp.value = formatVal(startVal)
			onChange?.(startVal)
		}
		const onUp = () => {
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
		}
		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	})

	inp.addEventListener('change', () => apply(parseVal()))
	inp.addEventListener('blur', () => apply(parseVal()))

	inp.addEventListener('wheel', (e) => {
		e.preventDefault()
		const dir = e.deltaY < 0 ? 1 : -1
		const mult = e.shiftKey ? 10 : 1
		const cur = parseVal()
		const n = Math.max(min, Math.min(max, cur + dir * step * mult))
		inp.value = formatVal(n)
		syncSlider(n)
		onChange?.(n)
	}, { passive: false })

	// Mini slider: only render when slider is enabled and both bounds are finite
	if (slider && Number.isFinite(min) && Number.isFinite(max)) {
		sliderEl = document.createElement('input')
		sliderEl.type = 'range'
		sliderEl.className = 'inspector-mini-slider'
		sliderEl.min = min
		sliderEl.max = max
		sliderEl.step = step
		sliderEl.value = value != null && Number.isFinite(value) ? value : Math.max(min, Math.min(max, min !== -Infinity ? min : 0))
		wrap.appendChild(sliderEl)

		// Slider input → update text field + fire onChange (respect drag semantics)
		sliderEl.addEventListener('input', (e) => {
			const n = Number(e.target.value)
			if (!Number.isNaN(n)) {
				inp.value = formatVal(n)
				onChange?.(n)
			}
		})
	}

	return { wrap, input: inp, setValue: (v) => { inp.value = formatVal(v); apply(v) } }
}

/**
 * Infer a display-decimals count from a step attribute string (as found on a native
 * `<input type="number" step="...">`). Returns `null` when no sensible fixed-decimal
 * formatting should be forced (missing/`any`/non-numeric step) — callers should fall
 * back to `String(value)` in that case.
 * @param {string|number|null|undefined} step
 * @returns {number|null}
 */
export function inferDecimalsFromStep(step) {
	if (step == null || step === '' || step === 'any') return null
	const n = Number(step)
	if (!Number.isFinite(n) || n <= 0) return null
	if (Number.isInteger(n)) return 0
	const s = String(step)
	const dot = s.indexOf('.')
	if (dot === -1) return 0
	return s.length - dot - 1
}

/**
 * Pure decision logic for committing a raw (possibly math-expression) input string to a
 * clamped number — factored out of `attachMathInput` so it can be unit-tested without a
 * DOM. Garbage/empty input restores `lastGood` (or clamps to `min`/0 when there is no
 * last-good value yet) instead of blowing up the field.
 * @param {string|number|null|undefined} rawValue
 * @param {{min?: number, max?: number, decimals?: number|null, lastGood?: number|null}} [opts]
 * @returns {{ value: number, text: string, restored: boolean }}
 */
export function computeMathCommit(rawValue, opts = {}) {
	const { min = -Infinity, max = Infinity, decimals = null, lastGood = null } = opts
	const parsed = parseNumberInput(rawValue, NaN)
	let value
	let restored = false
	if (Number.isNaN(parsed)) {
		restored = true
		if (lastGood != null && Number.isFinite(lastGood)) {
			value = lastGood
		} else if (Number.isFinite(min)) {
			value = min
		} else if (Number.isFinite(max)) {
			value = max
		} else {
			value = 0
		}
	} else {
		value = parsed
	}
	if (Number.isFinite(min)) value = Math.max(min, value)
	if (Number.isFinite(max)) value = Math.min(max, value)
	const text = decimals != null && decimals >= 0 ? value.toFixed(decimals) : String(value)
	return { value, text, restored }
}

function resolveBound(inputEl, optsVal, attrName, fallback) {
	if (optsVal != null) {
		const n = Number(optsVal)
		return Number.isFinite(n) ? n : fallback
	}
	const attr = inputEl.getAttribute ? inputEl.getAttribute(attrName) : null
	if (attr == null || attr === '') return fallback
	const n = Number(attr)
	return Number.isFinite(n) ? n : fallback
}

// One shared capture-phase `change` listener for the whole document, keyed by a WeakMap
// so detached inputs are garbage-collected automatically (no per-input listener to leak).
// Capture-phase on an ancestor is required (not just `blur`) because the browser fires the
// *native* `change` event — with the raw, un-evaluated text still in `.value` — before
// `blur`. Correcting the value here, ahead of that dispatch reaching the target/bubble
// phase, means every already-wired `change` listener at the call sites sees the final
// math-evaluated, clamped number instead of a momentarily-wrong parse of the raw text.
const attachedMathInputs = new WeakMap()
let globalCommitListenerInstalled = false

function ensureGlobalCommitListener() {
	if (globalCommitListenerInstalled) return
	globalCommitListenerInstalled = true
	document.addEventListener(
		'change',
		(e) => {
			const entry = attachedMathInputs.get(e.target)
			if (!entry) return
			runCommit(e.target, entry)
		},
		true,
	)
}

function runCommit(el, entry) {
	const decision = computeMathCommit(el.value, {
		min: entry.min,
		max: entry.max,
		decimals: entry.decimals,
		lastGood: entry.lastGood,
	})
	el.value = decision.text
	entry.lastGood = decision.value
	return decision
}

/**
 * Convert an existing `<input>` (typically `type="number"`) into a math-capable text
 * field with minimal disruption to the call site: it keeps its markup, class names, and
 * — crucially — its existing `input`/`change` listeners. Call this *in addition to*
 * whatever wiring the site already has; do not remove the site's own listeners.
 *
 * - Converts to `type="text"` + `inputmode="decimal"`.
 * - min/max/decimals default to the element's existing `min`/`max`/`step` attributes when
 *   not given in `opts` (decimals inferred from `step`; integer step ⇒ 0).
 * - Evaluates the math expression (via `parseNumberInput`) and clamps on blur or Enter.
 * - Garbage input restores the last-good value instead of committing NaN/zero.
 * - Because commit correction runs in a capture-phase `change` listener (see above), the
 *   site's own `change` handler always sees the corrected value. For sites wired to
 *   `input` only (continuous/live reactions), a synthetic `input` event is dispatched
 *   after a real edit is committed so they also pick up the final value.
 *
 * @param {HTMLInputElement} inputEl
 * @param {{min?: number, max?: number, decimals?: number, onCommit?: (value: number) => void}} [opts]
 * @returns {{ getValue: () => number, commit: () => number, destroy: () => void }|null}
 */
export function attachMathInput(inputEl, opts = {}) {
	if (!inputEl || typeof inputEl.addEventListener !== 'function') return null

	const min = resolveBound(inputEl, opts.min, 'min', -Infinity)
	const max = resolveBound(inputEl, opts.max, 'max', Infinity)
	const decimals =
		opts.decimals != null
			? opts.decimals
			: inferDecimalsFromStep(inputEl.getAttribute ? inputEl.getAttribute('step') : null)
	const onCommit = typeof opts.onCommit === 'function' ? opts.onCommit : null

	inputEl.type = 'text'
	if (inputEl.setAttribute) inputEl.setAttribute('inputmode', 'decimal')

	const initial = computeMathCommit(inputEl.value, { min, max, decimals, lastGood: null })
	inputEl.value = initial.text
	const entry = { min, max, decimals, lastGood: initial.value }
	attachedMathInputs.set(inputEl, entry)
	ensureGlobalCommitListener()

	let valueAtFocus = null
	const onFocus = () => {
		valueAtFocus = inputEl.value
		// If the call site set `.value` directly since the last commit (e.g. re-rendering
		// from fresh state, or a linked control like a video-mode preset picker), resync
		// the last-good cache so a later "restore on garbage" reflects what's on screen
		// rather than a stale value from before that external write.
		const v = parseNumberInput(inputEl.value, NaN)
		if (!Number.isNaN(v)) {
			entry.lastGood = Math.max(entry.min, Math.min(entry.max, v))
		}
	}
	const onKeydown = (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			inputEl.blur()
		}
	}
	const onBlur = () => {
		const dirty = valueAtFocus != null && valueAtFocus !== inputEl.value
		const decision = runCommit(inputEl, entry)
		valueAtFocus = null
		if (dirty) {
			inputEl.dispatchEvent(new Event('input', { bubbles: true }))
			onCommit?.(decision.value)
		}
	}
	inputEl.addEventListener('focus', onFocus)
	inputEl.addEventListener('keydown', onKeydown)
	inputEl.addEventListener('blur', onBlur)

	return {
		getValue: () => entry.lastGood,
		commit: () => {
			const decision = runCommit(inputEl, entry)
			inputEl.dispatchEvent(new Event('input', { bubbles: true }))
			onCommit?.(decision.value)
			return decision.value
		},
		destroy: () => {
			attachedMathInputs.delete(inputEl)
			inputEl.removeEventListener('focus', onFocus)
			inputEl.removeEventListener('keydown', onKeydown)
			inputEl.removeEventListener('blur', onBlur)
		},
	}
}
