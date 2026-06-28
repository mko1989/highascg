/**
 * Inspector — per-effect-type parameter editors + effects list/drop-zone.
 * Renders editors for mixer effects on scene layers and timeline clips.
 *
 * @see 22_WO_MIXER_EFFECTS.md T2.1–T2.3
 * @see 74_WO_MIXER_EFFECTS_INSPECTOR_PARAMS_AND_SMOKE.md
 * @see effect-registry.js for definitions
 */

import { createDragInput } from './inspector-common.js'
import {
	MIXER_EFFECTS,
	EFFECT_MAP,
	createEffectInstance,
	effectPrimarySchema,
	effectAdvancedSchema,
} from '../lib/effect-registry.js'
import { scheduleLiveEffectApply } from '../lib/effect-apply-live.js'

/**
 * Render a single parameter editor based on schema type.
 * @param {HTMLElement} container
 * @param {import('../lib/effect-registry.js').EffectParamSchema} schema
 * @param {*} currentValue
 * @param {(value: *) => void} onChange
 */
function renderParamEditor(container, schema, currentValue, onChange) {
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
		const uid = `inspector-fx-${schema.key}-${Math.random().toString(36).slice(2, 8)}`
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

	// float or int — use drag input
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
 * @param {HTMLElement} container
 * @param {import('../lib/effect-registry.js').EffectDefinition} def
 * @param {{ type: string, params: object }} effect
 * @param {import('../lib/effect-registry.js').EffectParamSchema[]} schemaFields
 * @param {(params: object) => void} onParamsChange
 */
function renderEffectParamBlock(container, def, effect, schemaFields, onParamsChange) {
	for (const schema of schemaFields) {
		const curVal = effect.params?.[schema.key] ?? schema.default
		renderParamEditor(container, schema, curVal, (newVal) => {
			const updated = { ...effect.params, [schema.key]: newVal }
			onParamsChange(updated)
		})
	}
}

/**
 * Render the full editor for one effect instance.
 * @param {HTMLElement} container
 * @param {{ type: string, params: object }} effect
 * @param {(params: object) => void} onChange - Called with updated params
 * @param {() => void} onRemove - Called when user clicks remove
 * @param {import('../lib/effect-apply-live.js').SceneLayerLiveContext | import('../lib/effect-apply-live.js').TimelineClipLiveContext | null} [liveApplyContext]
 */
export function renderEffectEditor(container, effect, onChange, onRemove, liveApplyContext = null) {
	const def = EFFECT_MAP.get(effect.type)
	if (!def) return

	const notifyChange = (updatedParams) => {
		onChange(updatedParams)
		if (liveApplyContext) {
			scheduleLiveEffectApply(liveApplyContext, effect.type, updatedParams)
		}
	}

	const card = document.createElement('div')
	card.className = 'inspector-effect-card'

	const header = document.createElement('div')
	header.className = 'inspector-effect-card__header'
	const title = document.createElement('span')
	title.className = 'inspector-effect-card__title'
	title.textContent = `${def.icon} ${def.label}`
	header.appendChild(title)

	const removeBtn = document.createElement('button')
	removeBtn.type = 'button'
	removeBtn.className = 'inspector-effect-card__remove'
	removeBtn.textContent = '✕'
	removeBtn.title = `Remove ${def.label}`
	removeBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		onRemove()
	})
	header.appendChild(removeBtn)
	card.appendChild(header)

	const primaryFields = effectPrimarySchema(def)
	const advancedFields = effectAdvancedSchema(def)

	const paramsBlock = document.createElement('div')
	paramsBlock.className = 'inspector-effect-card__params'

	if (primaryFields.length > 0) {
		renderEffectParamBlock(paramsBlock, def, effect, primaryFields, notifyChange)
	}

	if (advancedFields.length > 0) {
		const details = document.createElement('details')
		details.className = 'inspector-effect-card__advanced'
		if (primaryFields.length === 0) details.open = true
		const summary = document.createElement('summary')
		summary.className = 'inspector-effect-card__advanced-summary'
		summary.textContent = primaryFields.length === 0 ? 'Parameters' : 'Advanced'
		details.appendChild(summary)
		const advancedBlock = document.createElement('div')
		advancedBlock.className = 'inspector-effect-card__advanced-params'
		renderEffectParamBlock(advancedBlock, def, effect, advancedFields, notifyChange)
		details.appendChild(advancedBlock)
		paramsBlock.appendChild(details)
	}

	card.appendChild(paramsBlock)
	container.appendChild(card)
}

/**
 * Render the full effects group: drop zone + list of current effects with editors.
 * @param {HTMLElement} root - Inspector root element
 * @param {object} opts
 * @param {Array<{ type: string, params: object }>} opts.effects - Current effects array
 * @param {(effects: Array) => void} opts.onUpdate - Called with the updated effects array
 * @param {import('../lib/effect-apply-live.js').SceneLayerLiveContext | import('../lib/effect-apply-live.js').TimelineClipLiveContext | null} [opts.liveApplyContext]
 */
export function renderEffectsGroup(root, { effects, onUpdate, liveApplyContext = null }) {
	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-effects-group'
	grp.innerHTML = '<div class="inspector-group__title">Mixer Effects</div>'

	const dropZone = document.createElement('div')
	dropZone.className = 'inspector-effects-dropzone'
	dropZone.textContent = '⊕ Drop effect here'

	dropZone.addEventListener('dragover', (e) => {
		try {
			e.preventDefault()
			e.dataTransfer.dropEffect = 'copy'
			dropZone.classList.add('inspector-effects-dropzone--active')
		} catch (_) {}
	})
	dropZone.addEventListener('dragleave', () => {
		dropZone.classList.remove('inspector-effects-dropzone--active')
	})
	dropZone.addEventListener('drop', (e) => {
		e.preventDefault()
		dropZone.classList.remove('inspector-effects-dropzone--active')
		try {
			const data = JSON.parse(e.dataTransfer.getData('application/json') || '{}')
			if (data.type !== 'effect' || !data.value) return
			const existing = effects || []
			const alreadyHas = existing.some((fx) => fx.type === data.value)
			if (alreadyHas) return
			const instance = createEffectInstance(data.value)
			if (!instance) return
			const next = [...existing, instance]
			onUpdate(next)
			if (liveApplyContext) {
				scheduleLiveEffectApply(liveApplyContext, instance.type, instance.params)
			}
		} catch (err) {
			console.warn('[Inspector] Effect drop failed:', err)
		}
	})
	grp.appendChild(dropZone)

	const sel = document.createElement('select')
	sel.className = 'inspector-field__select'
	sel.style.marginTop = '8px'
	sel.style.width = '100%'
	sel.setAttribute('aria-label', 'Select effect to add')

	const defOpt = document.createElement('option')
	defOpt.value = ''
	defOpt.textContent = '⊕ Choose effect to add...'
	sel.appendChild(defOpt)

	for (const fx of MIXER_EFFECTS) {
		const o = document.createElement('option')
		o.value = fx.type
		o.textContent = `${fx.icon} ${fx.label}`
		sel.appendChild(o)
	}

	sel.addEventListener('change', () => {
		const type = sel.value
		if (!type) return
		const existing = effects || []
		const alreadyHas = existing.some((fx) => fx.type === type)
		if (alreadyHas) {
			sel.value = ''
			return
		}
		const instance = createEffectInstance(type)
		if (!instance) return
		onUpdate([...existing, instance])
		if (liveApplyContext) {
			scheduleLiveEffectApply(liveApplyContext, instance.type, instance.params)
		}
		sel.value = ''
	})
	grp.appendChild(sel)

	const list = effects || []
	for (let i = 0; i < list.length; i++) {
		const fx = list[i]
		renderEffectEditor(
			grp,
			fx,
			(newParams) => {
				const updated = [...list]
				updated[i] = { ...fx, params: newParams }
				onUpdate(updated)
			},
			() => {
				const updated = list.filter((_, idx) => idx !== i)
				onUpdate(updated)
			},
			liveApplyContext,
		)
	}

	if (list.length === 0) {
		const hint = document.createElement('p')
		hint.className = 'inspector-field inspector-field--hint'
		hint.style.fontSize = '0.75rem'
		hint.style.color = 'var(--text-muted, #8b949e)'
		hint.textContent = 'Drag effects from the Effects tab in the sources panel, or drop them on a layer/clip.'
		grp.appendChild(hint)
	}

	root.appendChild(grp)
}
