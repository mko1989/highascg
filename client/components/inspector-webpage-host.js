/**
 * Live webpage host inspector — URL input + reload (same host channel).
 * Used from the right Inspector panel and Device View host-channel destination.
 */

import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

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
 * @param {{ source: object, onApplied?: (r: object) => void }} opts
 */
export function mountWebpageHostPageControls(container, { source, onApplied }) {
	if (!source) return

	const section = document.createElement('div')
	section.className = 'inspector-section inspector-webpage-host-controls'
	section.innerHTML = `
		<div class="inspector-section__title">Page</div>
		<div class="inspector-field" style="margin-bottom:8px">
			<input type="text" class="inspector-math-input inspector-webpage-host__url" style="width:100%;box-sizing:border-box" spellcheck="false" placeholder="https://example.com/" value="${esc(source.playArg || source.templateOrUrl || '')}" />
		</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
			<button type="button" class="btn btn--secondary inspector-webpage-host__reload">Reload</button>
		</div>
		<p class="settings-note" style="margin:8px 0 0">
			Updates the URL on host ch ${esc(source.hostChannel ?? '?')} and replays <code>LOOP</code>. Route and channel stay the same.
		</p>
	`

	const urlInput = section.querySelector('.inspector-webpage-host__url')
	const reloadBtn = section.querySelector('.inspector-webpage-host__reload')

	const runReload = async () => {
		const templateOrUrl = urlInput.value.trim()
		if (!templateOrUrl) {
			showAppToast('Enter a page URL or template name', 'warn')
			urlInput.focus()
			return
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
				<div class="inspector-field__value">${esc(source.label || source.sourceId || 'Webpage')}</div>
			</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Host channel</div>
				<div class="inspector-field__value">Ch ${esc(source.hostChannel ?? '?')} · L${esc(source.hostLayer ?? 1)}</div>
			</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Route</div>
				<div class="inspector-field__value"><code>${esc(source.value || '')}</code></div>
			</div>
			${source.sourceId ? `<div class="inspector-field"><div class="inspector-field__label">Source ID</div><div class="inspector-field__value">${esc(source.sourceId)}</div></div>` : ''}
		</div>
	`

	mountWebpageHostPageControls(root, {
		source,
		onApplied: () => {
			const next = resolveWebpageHostSource(stateStore.getState()?.extraLiveSources || [], selection)
			if (!next) return
			const urlInput = root.querySelector('.inspector-webpage-host__url')
			if (urlInput && document.activeElement !== urlInput) {
				urlInput.value = String(next.playArg || next.templateOrUrl || '')
			}
		},
	})
}
