import { escapeHtml, truncate, makeDraggable } from './sources-panel-helpers.js'

/**
 * Templates tab — Caspar `TLS` list entries, draggable as `template` sources for looks.
 * @param {HTMLElement} container
 * @param {Array<{ id?: string, label?: string }>} templates
 * @param {string} filter
 */
export function renderTemplatesBrowser(container, templates, filter) {
	const filtered = filter
		? (templates || []).filter((i) =>
				(i.label || i.id || '').toLowerCase().includes(filter.toLowerCase()),
			)
		: templates || []
	
	const renderKey = JSON.stringify({
		ids: filtered.map(t => t.id || t.label),
		filter
	})
	if (container._lastRenderKey === renderKey) return
	container._lastRenderKey = renderKey

	container.innerHTML = ''
	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No templates (run Refresh — Caspar TLS)</p>'
		return
	}
	for (const item of filtered) {
		const id = item.id ?? item.label ?? ''
		if (!id) continue
		const label = item.label ?? String(id)
		const el = document.createElement('div')
		el.className = 'source-item source-item--template'
		el.dataset.sourceValue = id

		const isCgStudioTemplate = id.toLowerCase().replace(/\\/g, '/').includes('lower-thirds/lt-') || id.toLowerCase().replace(/\\/g, '/').includes('lower_thirds/lt-')

		if (isCgStudioTemplate) {
			el.innerHTML = `
				<span class="source-item__kind-pill" title="HTML / Flash template">FT</span>
				<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 36))}</span>
				<button type="button" class="source-item__edit-template-btn" title="Edit in CG Studio">Edit</button>
			`
			el.querySelector('.source-item__edit-template-btn').addEventListener('click', (e) => {
				e.preventDefault()
				e.stopPropagation()
				const derivedId = id.match(/lt-[\w-]+/i)?.[0]?.toLowerCase() || ''
				if (derivedId) {
					window.dispatchEvent(new CustomEvent('highascg-cg-studio-edit-template', { detail: { id: derivedId } }))
				}
			})
		} else {
			el.innerHTML = `
				<span class="source-item__kind-pill" title="HTML / Flash template">FT</span>
				<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 48))}</span>
			`
		}

		makeDraggable(el, 'template', id, label)
		container.appendChild(el)
	}
}
