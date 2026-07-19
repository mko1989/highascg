import { escapeHtml, truncate, makeDraggable } from './sources-panel-helpers.js'
import { sceneState } from '../lib/scene-state.js'
import { showShaderFxModal } from './shader-fx-modal.js'

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

	const renderKey = JSON.stringify({
		ids: filtered.map(t => t.id || t.label),
		filter
	})
	if (container._lastRenderKey === renderKey) return
	container._lastRenderKey = renderKey

	container.innerHTML = ''
	// WO-266: Shader FX library manager — saved shaders export into template/shaders/ and show
	// up in this list (via Caspar TLS) like any other template.
	const toolbar = document.createElement('div')
	toolbar.className = 'sources-templates-toolbar'
	toolbar.innerHTML = '<button type="button" class="btn btn--secondary" id="sources-shaderfx-btn" title="Create / edit audio-reactive shader templates">Shader FX…</button>'
	toolbar.querySelector('#sources-shaderfx-btn').addEventListener('click', () => showShaderFxModal())
	container.appendChild(toolbar)
	if (filtered.length === 0) {
		container.appendChild(Object.assign(document.createElement('p'), { className: 'sources-empty', textContent: 'No templates (run Refresh — Caspar TLS)' }))
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
		const shaderMatch = id.toLowerCase().replace(/\\/g, '/').match(/shaders\/(sh-[a-z0-9-]+)$/)

		if (isCgStudioTemplate) {
			el.innerHTML = `
				<span class="source-item__kind-pill" title="HTML / Flash template">FT</span>
				<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 36))}</span>
				<button type="button" class="source-item__edit-template-btn" title="Edit in CG Studio">Edit</button>
			`
			el.querySelector('.source-item__edit-template-btn').addEventListener('click', (e) => {
				e.preventDefault()
				e.stopPropagation()
				// WO-265: prefer the in-app CG Studio workspace tab (playout-mounted studio);
				// fall back to the Electron-launcher-hosted studio on :4300 when the tab is absent.
				if (document.querySelector('.workspace__tabs .tab[data-tab="cg-studio"]') && typeof window.highascgActivateWorkspaceTab === 'function') {
					window.highascgActivateWorkspaceTab('cg-studio')
				} else {
					window.open('http://127.0.0.1:4300/', '_blank', 'noopener,noreferrer')
				}
			})
		} else if (shaderMatch) {
			el.innerHTML = `
				<span class="source-item__kind-pill source-item__kind-pill--shader" title="Shader FX template">FX</span>
				<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 36))}</span>
				<button type="button" class="source-item__edit-template-btn" title="Edit in Shader FX">Edit</button>
			`
			el.querySelector('.source-item__edit-template-btn').addEventListener('click', (e) => {
				e.preventDefault()
				e.stopPropagation()
				showShaderFxModal({ editId: shaderMatch[1] })
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
