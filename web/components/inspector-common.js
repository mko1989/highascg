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
	function commitNumber(n) {
		const clamped = Math.max(min, Math.min(max, n))
		inp.value = formatVal(clamped)
		if (clamped !== lastCommitted) {
			lastCommitted = clamped
			onChange?.(clamped)
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
		setValue: (v) => {
			commitNumber(v)
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
