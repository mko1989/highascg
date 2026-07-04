/**
 * Shared inspector helpers — drag inputs and timeline keyframe property defs.
 */

import { parseNumberInput } from '../lib/math-input.js'

/**
 * Create a numeric input with drag-to-adjust (Millumin/After Effects style).
 * Supports basic math on commit (e.g. 1920/2, 100+50).
 */
export function createDragInput(opts) {
	const { label, value, min = -Infinity, max = Infinity, step = 0.01, decimals = 2, onChange, placeholder = '' } = opts
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

	let startX = 0
	let startVal = 0
	const sensitivity = 0.5
	/** Last value we committed — restore on blur when the field is empty or not parseable. */
	let lastCommitted =
		typeof value === 'number' && !Number.isNaN(value) ? value : min !== -Infinity ? min : 0

	function parseRaw() {
		return parseNumberInput(inp.value, NaN)
	}
	/** For drag/wheel: fall back to last committed if the field is empty. */
	function parseValOrLast() {
		const v = parseRaw()
		if (!Number.isNaN(v)) return v
		return lastCommitted
	}
	function formatVal(v) {
		return decimals >= 0 ? Number(v).toFixed(decimals) : String(v)
	}
	function commitNumber(n, triggerChange = true) {
		const clamped = Math.max(min, Math.min(max, n))
		inp.value = formatVal(clamped)
		if (clamped !== lastCommitted) {
			lastCommitted = clamped
			if (triggerChange) onChange?.(clamped)
		}
	}
	function commitFromField() {
		const raw = parseRaw()
		if (Number.isNaN(raw)) {
			inp.value = formatVal(lastCommitted)
			return
		}
		commitNumber(raw)
	}

	const DRAG_THRESHOLD = 5
	let dragging = false
	inp.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return
		startX = e.clientX
		startVal = parseValOrLast()
		dragging = false
		const onMove = (ev) => {
			if (!dragging) {
				if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return
				dragging = true
				inp.blur()
			}
			ev.preventDefault()
			const dx = (ev.clientX - startX) * sensitivity * step
			startX = ev.clientX
			startVal = Math.max(min, Math.min(max, startVal + dx))
			inp.value = formatVal(startVal)
			if (startVal !== lastCommitted) {
				lastCommitted = startVal
				onChange?.(startVal)
			}
		}
		const onUp = () => {
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
		}
		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	})
	inp.addEventListener('change', commitFromField)
	inp.addEventListener('blur', commitFromField)

	inp.addEventListener('wheel', (e) => {
		e.preventDefault()
		const dir = e.deltaY < 0 ? 1 : -1
		const mult = e.shiftKey ? 10 : 1
		const cur = parseValOrLast()
		commitNumber(cur + dir * step * mult)
	}, { passive: false })

	return {
		wrap,
		input: inp,
		setValue: (v, triggerChange = true) => {
			commitNumber(v, triggerChange)
		},
	}
}

/**
 * Numeric field with up/down step buttons (for discrete indices, counts, etc.).
 * @param {{
 *   label: string,
 *   value: number,
 *   min?: number,
 *   max?: number,
 *   step?: number,
 *   shiftStep?: number,
 *   onChange: (value: number) => void,
 *   onInvalid?: (reason: string) => void,
 * }} opts
 */
export function createStepperInput(opts) {
	const {
		label,
		value,
		min = -Infinity,
		max = Infinity,
		step = 1,
		shiftStep = step * 10,
		onChange,
		onInvalid,
	} = opts

	const row = document.createElement('div')
	row.className = 'inspector-layer-index'

	const lab = document.createElement('label')
	lab.className = 'inspector-layer-index__label'
	lab.textContent = label

	const control = document.createElement('div')
	control.className = 'inspector-layer-index__control'

	const inp = document.createElement('input')
	inp.type = 'text'
	inp.inputMode = 'numeric'
	inp.className = 'inspector-layer-index__input inspector-math-input'
	inp.setAttribute('aria-label', label)

	const steps = document.createElement('div')
	steps.className = 'inspector-layer-index__steps'

	const upBtn = document.createElement('button')
	upBtn.type = 'button'
	upBtn.className = 'inspector-layer-index__step-btn'
	upBtn.textContent = '▲'
	upBtn.title = `Increase (${step}; Shift = ${shiftStep})`
	upBtn.setAttribute('aria-label', `Increase ${label}`)

	const downBtn = document.createElement('button')
	downBtn.type = 'button'
	downBtn.className = 'inspector-layer-index__step-btn'
	downBtn.textContent = '▼'
	downBtn.title = `Decrease (${step}; Shift = ${shiftStep})`
	downBtn.setAttribute('aria-label', `Decrease ${label}`)

	let lastCommitted =
		typeof value === 'number' && !Number.isNaN(value) ? Math.round(value) : min !== -Infinity ? min : 0

	function formatVal(v) {
		return String(Math.round(v))
	}

	function clamp(n) {
		return Math.max(min, Math.min(max, Math.round(n)))
	}

	function commitNumber(n, triggerChange = true) {
		const next = clamp(n)
		inp.value = formatVal(next)
		if (next !== lastCommitted) {
			lastCommitted = next
			if (triggerChange) onChange?.(next)
		}
	}

	function commitFromField() {
		const raw = parseNumberInput(inp.value, NaN)
		if (Number.isNaN(raw)) {
			inp.value = formatVal(lastCommitted)
			onInvalid?.('Enter a valid number')
			return
		}
		const rounded = Math.round(raw)
		if (rounded < min || rounded > max) {
			inp.value = formatVal(lastCommitted)
			onInvalid?.(`Value must be between ${min} and ${max}`)
			return
		}
		commitNumber(rounded)
	}

	function nudge(dir, shiftKey) {
		const delta = (shiftKey ? shiftStep : step) * dir
		commitNumber(lastCommitted + delta)
	}

	inp.value = formatVal(lastCommitted)
	inp.addEventListener('change', commitFromField)
	inp.addEventListener('blur', commitFromField)
	inp.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			inp.blur()
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			nudge(1, e.shiftKey)
		} else if (e.key === 'ArrowDown') {
			e.preventDefault()
			nudge(-1, e.shiftKey)
		}
	})

	upBtn.addEventListener('click', (e) => {
		e.preventDefault()
		nudge(1, e.shiftKey)
	})
	downBtn.addEventListener('click', (e) => {
		e.preventDefault()
		nudge(-1, e.shiftKey)
	})

	steps.appendChild(upBtn)
	steps.appendChild(downBtn)
	control.appendChild(inp)
	control.appendChild(steps)
	lab.appendChild(control)
	row.appendChild(lab)

	return {
		row,
		input: inp,
		setValue: (v, triggerChange = false) => {
			lastCommitted = clamp(v)
			inp.value = formatVal(lastCommitted)
			if (triggerChange) onChange?.(lastCommitted)
		},
	}
}

export const KF_PROPERTIES = [
	{ value: 'opacity', label: 'Opacity', min: 0, max: 1, default: 1 },
	{ value: 'volume', label: 'Volume', min: 0, max: 2, default: 1 },
	{ value: 'position', label: 'Position', pair: ['fill_x', 'fill_y'], default: { x: 0, y: 0 } },
	{ value: 'scale', label: 'Scale', pair: ['scale_x', 'scale_y'], locked: true, min: 0, max: 4, default: 1 },
]
export const KF_PROP_MAP = Object.fromEntries(KF_PROPERTIES.map((p) => [p.value, p]))
