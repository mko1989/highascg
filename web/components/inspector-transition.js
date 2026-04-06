/**
 * Dashboard clip — transition override UI (column transition per-cell override).
 */

import { parseNumberInput } from '../lib/math-input.js'
import { dashboardState, DEFAULT_TRANSITION, TRANSITION_TYPES, TRANSITION_TWEENS } from '../lib/dashboard-state.js'

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {number} opts.colIdx
 * @param {number} opts.layerIdx
 * @param {object} opts.cell
 */
export function appendDashboardClipTransitionOverride(root, { colIdx, layerIdx, cell }) {
	const transGrp = document.createElement('div')
	transGrp.className = 'inspector-group'
	transGrp.innerHTML = '<div class="inspector-group__title">Transition Override</div>'
	const hasTransOverride =
		cell.overrides?.transition != null || cell.overrides?.transitionDuration != null || cell.overrides?.transitionTween != null
	const colTrans = dashboardState.getColumn(colIdx)?.transition || { ...DEFAULT_TRANSITION }
	const transOverrideCheck = document.createElement('input')
	transOverrideCheck.type = 'checkbox'
	transOverrideCheck.checked = !!hasTransOverride
	transOverrideCheck.id = 'inspector-trans-override'
	const transOverrideLabel = document.createElement('label')
	transOverrideLabel.htmlFor = 'inspector-trans-override'
	transOverrideLabel.textContent = 'Override column transition'
	const transOverrideWrap = document.createElement('div')
	transOverrideWrap.className = 'inspector-field'
	transOverrideWrap.appendChild(transOverrideCheck)
	transOverrideWrap.appendChild(transOverrideLabel)
	transGrp.appendChild(transOverrideWrap)

	const transFieldsWrap = document.createElement('div')
	transFieldsWrap.className = 'inspector-transition-fields'
	transFieldsWrap.style.display = hasTransOverride ? 'block' : 'none'
	const typeSel = document.createElement('select')
	typeSel.className = 'inspector-field__select'
	TRANSITION_TYPES.forEach((t) => {
		const opt = document.createElement('option')
		opt.value = t; opt.textContent = t
		if (t === (cell.overrides?.transition ?? colTrans.type)) opt.selected = true
		typeSel.appendChild(opt)
	})
	const durInp = document.createElement('input')
	durInp.type = 'text'
	durInp.className = 'inspector-field__input inspector-math-input'
	durInp.placeholder = 'Frames'
	durInp.setAttribute('inputmode', 'decimal')
	durInp.value = String(cell.overrides?.transitionDuration ?? colTrans.duration ?? 0)
	const tweenSel = document.createElement('select')
	tweenSel.className = 'inspector-field__select'
	TRANSITION_TWEENS.forEach((tw) => {
		const opt = document.createElement('option')
		opt.value = tw; opt.textContent = tw
		if (tw === (cell.overrides?.transitionTween ?? colTrans.tween ?? 'linear')) opt.selected = true
		tweenSel.appendChild(opt)
	})
	transFieldsWrap.appendChild(typeSel)
	transFieldsWrap.appendChild(durInp)
	transFieldsWrap.appendChild(tweenSel)

	transOverrideCheck.addEventListener('change', () => {
		transFieldsWrap.style.display = transOverrideCheck.checked ? 'block' : 'none'
		if (!transOverrideCheck.checked) {
			dashboardState.setCellOverrides(colIdx, layerIdx, {
				transition: undefined, transitionDuration: undefined, transitionTween: undefined,
			})
		} else {
			dashboardState.setCellOverrides(colIdx, layerIdx, {
				transition: typeSel.value,
				transitionDuration: Math.max(0, Math.round(parseNumberInput(durInp.value, 0))),
				transitionTween: tweenSel.value,
			})
		}
	})
	typeSel.addEventListener('change', () => dashboardState.setCellOverrides(colIdx, layerIdx, { transition: typeSel.value }))
	durInp.addEventListener('change', () => {
		const v = parseNumberInput(durInp.value, 0)
		dashboardState.setCellOverrides(colIdx, layerIdx, { transitionDuration: Math.max(0, Math.round(v)) })
	})
	tweenSel.addEventListener('change', () => dashboardState.setCellOverrides(colIdx, layerIdx, { transitionTween: tweenSel.value }))
	transGrp.appendChild(transFieldsWrap)
	root.appendChild(transGrp)
}
