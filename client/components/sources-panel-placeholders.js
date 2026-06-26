import { escapeHtml, truncate, formatDuration, makeDraggable } from './sources-panel-helpers.js'

/**
 * Placeholders tab — virtual media assets for simulation mode.
 * @param {HTMLElement} container
 * @param {Array<object>} placeholders
 * @param {string} filter
 */
export function renderPlaceholdersBrowser(container, placeholders, filter) {
	const filtered = filter
		? (placeholders || []).filter((i) =>
				(i.label || i.id || '').toLowerCase().includes(filter.toLowerCase()),
			)
		: placeholders || []
	
	const renderKey = JSON.stringify({
		ids: filtered.map(p => p.id),
		filter
	})
	if (container._lastRenderKey === renderKey) return
	container._lastRenderKey = renderKey

	container.innerHTML = ''
	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No placeholders. Click + to add one.</p>'
		return
	}

	for (const item of filtered) {
		const id = item.id
		const label = item.label || id
		const el = document.createElement('div')
		el.className = 'source-item source-item--placeholder'
		el.dataset.sourceValue = id
		
		const resolution = item.resolution || ''
		const duration = formatDuration(item.durationMs)
		const thumbStyle = item.template === 'solid' && item.value ? `background-color: ${item.value}` : ''
		
		el.innerHTML = `
			<div class="source-item__thumbnail source-item__thumbnail--placeholder" data-template="${item.template}" style="${thumbStyle}"></div>
			<div class="source-item__media-col">
				<div class="source-item__media-line1">
					<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 32))}</span>
					<span class="source-item__duration">${escapeHtml(duration)}</span>
				</div>
				<div class="source-item__meta-row">
					<span class="source-item__meta-tag">${escapeHtml(item.template.toUpperCase())}</span>
					<span class="source-item__meta-tag">${escapeHtml(resolution)}</span>
				</div>
			</div>
			<button type="button" class="source-item__remove" title="Remove Placeholder">&times;</button>
		`
		
		makeDraggable(el, 'media', id, label, {
			isPlaceholder: true,
			template: item.template,
			resolution: item.resolution,
			durationMs: item.durationMs,
			value: item.value,
		})
		
		const removeBtn = el.querySelector('.source-item__remove')
		if (removeBtn) {
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation()
				if (confirm(`Remove placeholder "${label}"?`)) {
					window.placeholderState.remove(id)
					renderPlaceholdersBrowser(container, window.placeholderState.getAll(), filter)
				}
			})
		}

		container.appendChild(el)
	}
}
