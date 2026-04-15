/**
 * Inspector — PIP overlay section for scene layers.
 * Lets users pick an overlay type (border, shadow, edge_strip, glow) and
 * configure parameters that map to CG HTML templates on CasparCG.
 *
 * @see 25_WO_PIP_OVERLAY_EFFECTS.md T5
 * @see pip-overlay-registry.js
 */

import { createDragInput } from './inspector-common.js'
import {
	PIP_OVERLAYS,
	PIP_OVERLAY_MAP,
	createPipOverlayInstance,
} from '../lib/pip-overlay-registry.js'

/**
 * Render a single parameter editor (mirrors inspector-effects.js renderParamEditor but adds color type).
 */
function renderParamEditor(container, schema, currentValue, onChange) {
	if (schema.type === 'color') {
		const wrap = document.createElement('div')
		wrap.className = 'inspector-field inspector-row'
		const lab = document.createElement('label')
		lab.className = 'inspector-field__label'
		lab.textContent = schema.label
		const inp = document.createElement('input')
		inp.type = 'color'
		inp.className = 'inspector-field__color'
		inp.value = currentValue || schema.default || '#ffffff'
		function clearColorSuppress() {
			window.__hacgSuppressSceneLayerInspectorRefresh = false
		}
		inp.addEventListener('input', () => {
			window.__hacgSuppressSceneLayerInspectorRefresh = true
			onChange(inp.value)
		})
		inp.addEventListener('change', clearColorSuppress)
		inp.addEventListener('blur', () => {
			setTimeout(clearColorSuppress, 350)
		})
		lab.appendChild(inp)
		wrap.appendChild(lab)
		container.appendChild(wrap)
		return
	}

	if (schema.type === 'select') {
		const wrap = document.createElement('div')
		wrap.className = 'inspector-field'
		const lab = document.createElement('label')
		lab.className = 'inspector-field__label'
		lab.textContent = schema.label
		const sel = document.createElement('select')
		sel.className = 'inspector-field__select'
		for (const opt of schema.options) {
			const o = document.createElement('option')
			o.value = opt
			o.textContent = opt
			if (String(opt) === String(currentValue)) o.selected = true
			sel.appendChild(o)
		}
		sel.addEventListener('change', () => onChange(sel.value))
		lab.appendChild(sel)
		wrap.appendChild(lab)
		container.appendChild(wrap)
		return
	}

	if (schema.type === 'bool') {
		const wrap = document.createElement('div')
		wrap.className = 'inspector-field inspector-row'
		const cb = document.createElement('input')
		cb.type = 'checkbox'
		const uid = `inspector-pip-${schema.key}-${Math.random().toString(36).slice(2, 8)}`
		cb.id = uid
		cb.checked = !!currentValue
		const lab = document.createElement('label')
		lab.htmlFor = uid
		lab.textContent = schema.label
		cb.addEventListener('change', () => onChange(cb.checked))
		wrap.appendChild(cb)
		wrap.appendChild(lab)
		container.appendChild(wrap)
		return
	}

	const v = currentValue != null ? Number(currentValue) : (schema.default ?? 0)
	const di = createDragInput({
		label: schema.label,
		value: v,
		min: schema.min ?? -Infinity,
		max: schema.max ?? Infinity,
		step: schema.step ?? 0.01,
		decimals: schema.decimals ?? 2,
		onChange: (val) => onChange(val),
	})
	container.appendChild(di.wrap)
}

/**
 * Render the PIP Overlay inspector group.
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {{ type: string, params: object } | null} opts.pipOverlay
 * @param {(overlay: { type: string, params: object } | null) => void} opts.onUpdate
 */
export function renderPipOverlayGroup(root, { pipOverlay, onUpdate }) {
	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-pip-overlay-group'
	grp.innerHTML = '<div class="inspector-group__title">PIP Overlay</div>'

	const selectorWrap = document.createElement('div')
	selectorWrap.className = 'inspector-field'
	const selectorLabel = document.createElement('label')
	selectorLabel.className = 'inspector-field__label'
	selectorLabel.textContent = 'Type'
	const sel = document.createElement('select')
	sel.className = 'inspector-field__select'

	const noneOpt = document.createElement('option')
	noneOpt.value = ''
	noneOpt.textContent = 'None'
	if (!pipOverlay) noneOpt.selected = true
	sel.appendChild(noneOpt)

	for (const def of PIP_OVERLAYS) {
		const o = document.createElement('option')
		o.value = def.type
		o.textContent = def.label
		if (pipOverlay?.type === def.type) o.selected = true
		sel.appendChild(o)
	}

	sel.addEventListener('change', () => {
		const v = sel.value
		if (!v) {
			onUpdate(null)
		} else {
			const existing = pipOverlay?.type === v ? pipOverlay : createPipOverlayInstance(v)
			onUpdate(existing)
		}
	})

	selectorLabel.appendChild(sel)
	selectorWrap.appendChild(selectorLabel)
	grp.appendChild(selectorWrap)

	if (pipOverlay?.type) {
		const def = PIP_OVERLAY_MAP.get(pipOverlay.type)
		if (def) {
			const paramsBlock = document.createElement('div')
			paramsBlock.className = 'inspector-pip-overlay-params'
			for (const schema of def.schema) {
				const curVal = pipOverlay.params?.[schema.key] ?? schema.default
				renderParamEditor(paramsBlock, schema, curVal, (newVal) => {
					const updated = {
						type: pipOverlay.type,
						params: { ...pipOverlay.params, [schema.key]: newVal },
					}
					onUpdate(updated)
				})
			}
			grp.appendChild(paramsBlock)
		}

		const removeBtn = document.createElement('button')
		removeBtn.type = 'button'
		removeBtn.className = 'inspector-btn inspector-btn--danger'
		removeBtn.textContent = 'Remove Overlay'
		removeBtn.style.marginTop = '0.5rem'
		removeBtn.addEventListener('click', () => onUpdate(null))
		grp.appendChild(removeBtn)
	} else {
		const hint = document.createElement('p')
		hint.className = 'inspector-field inspector-field--hint'
		hint.style.fontSize = '0.75rem'
		hint.style.color = 'var(--text-muted, #8b949e)'
		hint.textContent = 'Select an overlay type to add a border, shadow, glow, or animated edge strip to this PIP layer.'
		grp.appendChild(hint)
	}

	root.appendChild(grp)
}
