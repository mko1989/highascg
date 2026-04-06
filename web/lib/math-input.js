/**
 * Safe math evaluation for number inputs. Supports expressions like 1920/2, 100+50, (960-10)*2.
 * Only allows digits, operators + - * /, parentheses, and decimal point.
 */
export function evaluateMath(str) {
	if (str == null || typeof str !== 'string') return NaN
	const s = String(str).trim()
	if (!s) return NaN
	// Only allow safe characters
	if (!/^[\d\s+\-*/.()]+$/.test(s)) return NaN
	try {
		const n = new Function(`"use strict"; return (${s})`)()
		return typeof n === 'number' && isFinite(n) ? n : NaN
	} catch {
		return NaN
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
		onChange?.(n)
	}, { passive: false })

	return { wrap, input: inp, setValue: (v) => { inp.value = formatVal(v); apply(v) } }
}
