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
	let startVal = parseFloat(inp.value) || 0
	const sensitivity = 0.5

	function parseVal() {
		const v = parseNumberInput(inp.value, NaN)
		return !isNaN(v) ? v : min !== -Infinity ? min : 0
	}
	function formatVal(v) {
		return decimals >= 0 ? Number(v).toFixed(decimals) : String(v)
	}
	function apply(v) {
		let n = typeof v === 'number' ? v : parseVal()
		n = Math.max(min, Math.min(max, n))
		inp.value = formatVal(n)
		onChange?.(n)
	}

	const DRAG_THRESHOLD = 5
	let dragging = false
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
			const dx = (ev.clientX - startX) * sensitivity * step
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
		apply(Math.max(min, Math.min(max, cur + dir * step * mult)))
	}, { passive: false })

	return { wrap, input: inp, setValue: (v) => { inp.value = formatVal(v); apply(v) } }
}

export const KF_PROPERTIES = [
	{ value: 'opacity', label: 'Opacity', min: 0, max: 1, default: 1 },
	{ value: 'volume', label: 'Volume', min: 0, max: 2, default: 1 },
	{ value: 'position', label: 'Position', pair: ['fill_x', 'fill_y'], default: { x: 0, y: 0 } },
	{ value: 'scale', label: 'Scale', pair: ['scale_x', 'scale_y'], locked: true, min: 0, max: 4, default: 1 },
]
export const KF_PROP_MAP = Object.fromEntries(KF_PROPERTIES.map((p) => [p.value, p]))
