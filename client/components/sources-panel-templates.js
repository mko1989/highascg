import { escapeHtml, truncate, makeDraggable } from './sources-panel-helpers.js'
import { sceneState } from '../lib/scene-state.js'

/**
 * Templates tab — Caspar `TLS` list entries, draggable as `template` sources for looks.
 * WO-208: Renders timer instances as draggable child rows under the countdown template.
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

	const timers = sceneState.listTimers()
	const renderKey = JSON.stringify({
		ids: filtered.map(t => t.id || t.label),
		timerIds: timers.map(t => t.id),
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
		const isCountdownTemplate = id.toLowerCase().replace(/\\/g, '/').includes('countdown/countdown')

		if (isCgStudioTemplate) {
			el.innerHTML = `
				<span class="source-item__kind-pill" title="HTML / Flash template">FT</span>
				<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 36))}</span>
				<button type="button" class="source-item__edit-template-btn" title="Edit in CG Studio (Electron launcher → Open CG Studio)">Edit</button>
			`
			el.querySelector('.source-item__edit-template-btn').addEventListener('click', (e) => {
				e.preventDefault()
				e.stopPropagation()
				window.open('http://127.0.0.1:4300/', '_blank', 'noopener,noreferrer')
			})
		} else {
			el.innerHTML = `
				<span class="source-item__kind-pill" title="HTML / Flash template">FT</span>
				<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 48))}</span>
			`
		}

		makeDraggable(el, 'template', id, label)
		container.appendChild(el)

		// WO-208 T208.3: Render timer instances as child rows under countdown template
		if (isCountdownTemplate && timers.length > 0) {
			const timerContainer = document.createElement('div')
			timerContainer.className = 'source-items-children'
			timerContainer.style.paddingLeft = '20px'
			timerContainer.style.marginTop = '4px'
			timerContainer.style.borderLeft = '2px solid rgba(255,255,255,0.2)'
			timerContainer.style.marginLeft = '10px'

			for (const timer of timers) {
				const timerEl = document.createElement('div')
				timerEl.className = 'source-item source-item--timer'
				timerEl.dataset.sourceValue = id
				timerEl.dataset.countdownTimerId = timer.id

				// Summary: show config duration or target time
				let summary = ''
				if (timer.config?.mode === 'duration') {
					const sec = timer.config.durationSec || 0
					const h = Math.floor(sec / 3600)
					const m = Math.floor((sec % 3600) / 60)
					const s = sec % 60
					summary = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
				} else if (timer.config?.mode === 'clock') {
					summary = timer.config.targetTime || '→time'
				} else {
					summary = 'countup'
				}

				timerEl.innerHTML = `
					<span class="source-item__kind-pill" title="Countdown timer instance" style="font-size:0.9em">⏱</span>
					<span class="source-item__label" title="${escapeHtml(timer.name)}">${escapeHtml(truncate(timer.name, 32))} — ${escapeHtml(summary)}</span>
				`

				makeDraggable(timerEl, 'template', id, label, { countdownTimerId: timer.id })
				timerContainer.appendChild(timerEl)
			}

			container.appendChild(timerContainer)
		}
	}
}
