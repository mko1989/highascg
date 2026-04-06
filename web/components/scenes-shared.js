/**
 * Shared scenes editor helpers — AMCP snippets, transition row UI, take payload.
 */

import { TRANSITION_TYPES, TRANSITION_TWEENS } from '../lib/dashboard-state.js'
import { parseNumberInput } from '../lib/math-input.js'

export function amcpParam(str) {
	if (str == null || str === '') return ''
	const s = String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return /\s/.test(s) ? `"${s}"` : s
}

export function chLayerAmcp(ch, ln) {
	return `${Number(ch)}-${Number(ln)}`
}

export function isMediaOrFileSource(src) {
	const t = (src?.type || '').toLowerCase()
	return (t === 'media' || t === 'file') && !!src?.value
}

/**
 * @param {HTMLElement} mount
 * @param {{ type?: string, duration?: number, tween?: string }} dt
 * @param {(t: { type: string, duration: number, tween: string }) => void} onChange
 * @param {string} idPrefix
 * @param {{ label?: string, hint?: string }} [opts]
 */
export function mountLookTransitionControls(mount, dt, onChange, idPrefix, opts = {}) {
	const label = opts.label ?? 'Look transition'
	const hint = opts.hint ?? ''
	const transitionRow = document.createElement('div')
	transitionRow.className = 'scenes-look-transition'
	transitionRow.innerHTML = `
		<span class="scenes-look-transition__label"></span>
		<select id="${idPrefix}-type" class="scenes-look-transition__select" aria-label="Transition type"></select>
		<label class="scenes-look-transition__dur"><span>Duration</span>
			<input type="text" id="${idPrefix}-dur" class="scenes-look-transition__num inspector-math-input" inputmode="decimal" />
			<span class="scenes-look-transition__unit">frames</span>
		</label>
		<select id="${idPrefix}-tween" class="scenes-look-transition__select" aria-label="Easing"></select>
	`
	const labelEl = transitionRow.querySelector('.scenes-look-transition__label')
	if (labelEl) labelEl.textContent = label
	if (hint) {
		const h = document.createElement('span')
		h.className = 'scenes-look-transition__hint'
		h.textContent = hint
		transitionRow.appendChild(h)
	}
	const typeSel = transitionRow.querySelector(`#${idPrefix}-type`)
	for (const t of TRANSITION_TYPES) {
		const o = document.createElement('option')
		o.value = t
		o.textContent = t
		typeSel.appendChild(o)
	}
	const d = dt || {}
	typeSel.value = d.type && TRANSITION_TYPES.includes(d.type) ? d.type : 'CUT'
	const durIn = transitionRow.querySelector(`#${idPrefix}-dur`)
	durIn.value = String(Math.max(0, Math.round(Number(d.duration) || 0)))
	const tweenSel = transitionRow.querySelector(`#${idPrefix}-tween`)
	for (const val of TRANSITION_TWEENS) {
		const o = document.createElement('option')
		o.value = val
		o.textContent = val
		tweenSel.appendChild(o)
	}
	const twRaw = String(d.tween || 'linear').toLowerCase().replace(/-/g, '_')
	const twNorm = twRaw === 'ease_in_out' || twRaw === 'easeinout' ? 'easeboth' : twRaw
	tweenSel.value = TRANSITION_TWEENS.includes(twNorm) ? twNorm : 'linear'

	function readAndSave() {
		const type = typeSel.value || 'CUT'
		const duration = Math.max(0, Math.round(parseNumberInput(durIn.value, 0)))
		const tween = tweenSel.value || 'linear'
		onChange({ type, duration, tween })
	}
	typeSel.addEventListener('change', readAndSave)
	durIn.addEventListener('change', readAndSave)
	tweenSel.addEventListener('change', readAndSave)
	mount.appendChild(transitionRow)
}

/**
 * @param {import('../lib/scene-state.js').Scene} scene
 */
export function buildIncomingScenePayload(scene) {
	return {
		id: scene.id,
		name: scene.name || 'Untitled look',
		defaultTransition: scene.defaultTransition
			? { ...scene.defaultTransition }
			: { type: 'CUT', duration: 0, tween: 'linear' },
		layers: (scene.layers || []).map((l) => ({
			layerNumber: l.layerNumber,
			source: l.source
				? {
						type: l.source.type,
						value: l.source.value,
						...(l.source.parameters != null ? { parameters: l.source.parameters } : {}),
					}
				: null,
			loop: !!l.loop,
			straightAlpha: !!l.straightAlpha,
			contentFit: l.contentFit || (l.fillNativeAspect === false ? 'stretch' : 'horizontal'),
			aspectLocked: l.aspectLocked !== false,
			fill: l.fill ? { ...l.fill } : undefined,
			opacity: l.opacity ?? 1,
			rotation: l.rotation ?? 0,
			transition: l.transition ? { ...l.transition } : null,
		})),
	}
}
