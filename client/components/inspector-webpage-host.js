/**
 * Live webpage host inspector — URL input + reload (same host channel).
 * Includes optional Template checkbox to pick from local template catalog.
 * Used from the right Inspector panel and Device View host-channel destination.
 */

import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { removeExtraLiveHostSource } from '../lib/extra-live-source-remove.js'

/**
 * @param {object[]} extras
 * @param {{ sourceId?: string, value?: string, hostChannel?: number }} query
 */
export function resolveWebpageHostSource(extras, query) {
	const list = Array.isArray(extras) ? extras : []
	const sourceId = String(query?.sourceId || '').trim()
	const value = String(query?.value || '').trim()
	const hostChannel = query?.hostChannel != null ? Number(query.hostChannel) : null
	return (
		list.find((s) => {
			if (s?.routeType !== 'webpage_host') return false
			if (sourceId && String(s.sourceId || '') === sourceId) return true
			if (value && String(s.value || '') === value) return true
			if (hostChannel != null && Number(s.hostChannel) === hostChannel) return true
			return false
		}) || null
	)
}

function applyWebpageHostApiResult(r) {
	if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
		window.__highascgApplyExtraLiveSources(r.extraLiveSources)
	}
	if (typeof window.__highascgApplyHostOperatorFullscreen === 'function' && r?.cefFocusTarget) {
		window.__highascgApplyHostOperatorFullscreen(r.hostOperatorFullscreen ?? null, r.cefFocusTarget)
	}
	window.dispatchEvent(new CustomEvent('webpage-host-changed', { detail: { source: r?.source || null } }))
}

/**
 * @param {HTMLElement} container
 * @param {{ source: object, stateStore?: object, onApplied?: (r: object) => void }} opts
 */
export function mountWebpageHostPageControls(container, { source, stateStore, onApplied }) {
	if (!source) return

	// Detect if current value is a template URL
	const currentValue = source.playArg || source.templateOrUrl || ''
	const isTemplateUrl = currentValue.startsWith('http://127.0.0.1:4200/template/')
	const extractedTemplateName = isTemplateUrl
		? currentValue.replace('http://127.0.0.1:4200/template/', '').replace(/\.html$/, '')
		: ''

	const section = document.createElement('div')
	section.className = 'inspector-section inspector-webpage-host-controls'

	// Build HTML with template checkbox and conditional elements
	section.innerHTML = `
		<div class="inspector-section__title">Page</div>
		<div style="display:flex;align-items:center;gap:0.35rem;margin-bottom:0.5rem">
			<input type="checkbox" class="inspector-webpage-host__use-template" id="inspector-webpage-host-use-template" ${isTemplateUrl ? 'checked' : ''} />
			<label for="inspector-webpage-host-use-template" style="font-weight:normal;cursor:pointer">Template</label>
		</div>
		<div class="inspector-field" style="margin-bottom:8px;display:${isTemplateUrl ? 'none' : 'block'}">
			<input type="text" class="inspector-math-input inspector-webpage-host__url" style="width:100%;box-sizing:border-box" spellcheck="false" placeholder="https://example.com/" value="${escapeHtml(currentValue)}" />
		</div>
		<div class="inspector-field" style="margin-bottom:8px;display:${isTemplateUrl ? 'block' : 'none'}">
			<select class="inspector-webpage-host__template" style="width:100%;box-sizing:border-box">
				<option value="">— Select a template —</option>
			</select>
		</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
			<button type="button" class="btn btn--secondary inspector-webpage-host__reload">Reload</button>
		</div>
		<p class="settings-note" style="margin:8px 0 0">
			Updates the URL on host ch ${escapeHtml(source.hostChannel ?? '?')} and replays <code>LOOP</code>. Route and channel stay the same.
		</p>
	`

	const urlInput = section.querySelector('.inspector-webpage-host__url')
	const useTemplateCheckbox = section.querySelector('.inspector-webpage-host__use-template')
	const templateSelect = section.querySelector('.inspector-webpage-host__template')
	const reloadBtn = section.querySelector('.inspector-webpage-host__reload')

	// Populate template select if stateStore is provided
	if (stateStore && templateSelect) {
		const templates = stateStore.getState?.()?.templates || []
		for (const t of templates) {
			const id = t.id || t.label || ''
			if (!id) continue
			const label = t.label || String(id)
			const opt = document.createElement('option')
			opt.value = id
			opt.textContent = label
			if (id === extractedTemplateName) opt.selected = true
			templateSelect.appendChild(opt)
		}
	}

	// Sync checkbox and input/select visibility
	const syncUI = () => {
		const useTemplate = useTemplateCheckbox?.checked
		if (urlInput) urlInput.parentElement.style.display = useTemplate ? 'none' : 'block'
		if (templateSelect) templateSelect.parentElement.style.display = useTemplate ? 'block' : 'none'
	}

	useTemplateCheckbox?.addEventListener('change', syncUI)

	const runReload = async () => {
		let templateOrUrl
		if (useTemplateCheckbox?.checked) {
			const templateName = (templateSelect?.value || '').trim()
			if (!templateName) {
				showAppToast('Select a template', 'warn')
				templateSelect?.focus()
				return
			}
			// Construct template URL; handle .html suffix deduplication
			const withoutHtml = templateName.endsWith('.html') ? templateName.slice(0, -5) : templateName
			templateOrUrl = `http://127.0.0.1:4200/template/${withoutHtml}.html`
		} else {
			templateOrUrl = urlInput.value.trim()
			if (!templateOrUrl) {
				showAppToast('Enter a page URL or select a template', 'warn')
				urlInput.focus()
				return
			}
		}
		const saved = String(source.playArg || source.templateOrUrl || '').trim()
		reloadBtn.disabled = true
		try {
			const payload = {
				sourceId: source.sourceId,
				value: source.value,
			}
			const r =
				templateOrUrl !== saved
					? await api.post('/api/host-live/webpage', { ...payload, action: 'update', templateOrUrl })
					: await api.post('/api/host-live/webpage', { ...payload, action: 'reload' })
			applyWebpageHostApiResult(r)
			if (r?.source) {
				source.playArg = r.source.playArg
				source.templateOrUrl = r.source.templateOrUrl
				source.cefNeedle = r.source.cefNeedle
			}
			onApplied?.(r)
			showAppToast(r?.message || 'Webpage reloaded', 'info')
		} catch (err) {
			showAppToast(err?.message || String(err), 'error')
		} finally {
			reloadBtn.disabled = false
		}
	}

	reloadBtn.addEventListener('click', () => void runReload())
	urlInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			void runReload()
		}
	})
	templateSelect?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			void runReload()
		}
	})

	container.appendChild(section)
}

/**
 * @param {HTMLElement} root
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ sourceId?: string, value?: string, hostChannel?: number }} selection
 */
export function renderWebpageHostInspector(root, stateStore, selection) {
	const extras = stateStore.getState()?.extraLiveSources || []
	const source = resolveWebpageHostSource(extras, selection)
	if (!source) {
		root.innerHTML = '<p class="inspector-empty">Webpage host source not found</p>'
		return
	}

	root.innerHTML = `
		<div class="inspector-section">
			<div class="inspector-section__title">Live webpage source</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Label</div>
				<div class="inspector-field__value">${escapeHtml(source.label || source.sourceId || 'Webpage')}</div>
			</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Host channel</div>
				<div class="inspector-field__value">Ch ${escapeHtml(source.hostChannel ?? '?')} · L${escapeHtml(source.hostLayer ?? 1)}</div>
			</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Route</div>
				<div class="inspector-field__value"><code>${escapeHtml(source.value || '')}</code></div>
			</div>
			${source.sourceId ? `<div class="inspector-field"><div class="inspector-field__label">Source ID</div><div class="inspector-field__value">${escapeHtml(source.sourceId)}</div></div>` : ''}
			<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
				<button type="button" class="btn btn--danger inspector-webpage-host__remove">Remove</button>
			</div>
		</div>
	`

	mountWebpageHostPageControls(root, {
		source,
		stateStore,
		onApplied: () => {
			const next = resolveWebpageHostSource(stateStore.getState()?.extraLiveSources || [], selection)
			if (!next) return
			const urlInput = root.querySelector('.inspector-webpage-host__url')
			if (urlInput && document.activeElement !== urlInput) {
				urlInput.value = String(next.playArg || next.templateOrUrl || '')
			}
		},
	})

	root.querySelector('.inspector-webpage-host__remove')?.addEventListener('click', async () => {
		const label = String(source.label || source.playArg || 'Webpage host')
		if (!confirm(`Remove "${label}" from Live sources?`)) return
		const btn = root.querySelector('.inspector-webpage-host__remove')
		if (btn) btn.disabled = true
		try {
			const hostOperatorFullscreen = stateStore.getState()?.hostOperatorFullscreen
			await removeExtraLiveHostSource(source, hostOperatorFullscreen)
			showAppToast('Webpage host removed.', 'info')
			window.dispatchEvent(new CustomEvent('webpage-host-select', { detail: null }))
		} catch (err) {
			showAppToast(err?.message || String(err), 'error')
			if (btn) btn.disabled = false
		}
	})
}
