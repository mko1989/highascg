import { MIXER_EFFECTS, EFFECT_CATEGORIES } from '../lib/effect-registry.js'
import { escapeHtml, makeDraggable } from './sources-panel-helpers.js'

/**
 * Render the Effects tab: CasparCG mixer effects grouped by category, each draggable.
 * @param {HTMLElement} container
 * @param {string} filter
 */
export function renderEffectsTab(container, filter) {
	const lowerFilter = (filter || '').toLowerCase()
	const filtered = lowerFilter
		? MIXER_EFFECTS.filter((e) => e.label.toLowerCase().includes(lowerFilter) || e.category.toLowerCase().includes(lowerFilter))
		: MIXER_EFFECTS

	const renderKey = JSON.stringify({
		ids: filtered.map(e => e.type),
		filter
	})
	if (container._lastRenderKey === renderKey) return
	container._lastRenderKey = renderKey

	container.innerHTML = ''
	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No matching effects</p>'
		return
	}

	// Group by category
	for (const cat of EFFECT_CATEGORIES) {
		const inCat = filtered.filter((e) => e.category === cat.id)
		if (inCat.length === 0) continue

		const heading = document.createElement('div')
		heading.className = 'sources-effects-category'
		heading.textContent = cat.label
		container.appendChild(heading)

		for (const fx of inCat) {
			const el = document.createElement('div')
			el.className = 'source-item source-item--effect'
			el.dataset.sourceValue = fx.type
			el.innerHTML = `
				<span class="source-item__label">${escapeHtml(fx.label)}</span>
			`
			makeDraggable(el, 'effect', fx.type, fx.label)
			container.appendChild(el)
		}
	}
}
