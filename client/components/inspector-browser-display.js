/**
 * Live browser_display inspector — URL + width/height/fps edit + Interact/Return toggle.
 * WO-260 T260.3: mirrors inspector-webpage-host.js and inspector-ndi-host.js patterns.
 */
import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { removeExtraLiveHostSource } from '../lib/extra-live-source-remove.js'

/**
 * @param {object[]} extras
 * @param {{ sourceId?: string, value?: string, hostChannel?: number }} query
 */
export function resolveBrowserDisplaySource(extras, query) {
	const list = Array.isArray(extras) ? extras : []
	const sourceId = String(query?.sourceId || '').trim()
	const value = String(query?.value || '').trim()
	const hostChannel = query?.hostChannel != null ? Number(query.hostChannel) : null
	return (
		list.find((s) => {
			if (s?.routeType !== 'browser_display') return false
			if (sourceId && String(s.sourceId || '') === sourceId) return true
			if (value && String(s.value || '') === value) return true
			if (hostChannel != null && Number(s.hostChannel) === hostChannel) return true
			return false
		}) || null
	)
}

function applyBrowserDisplayApiResult(r) {
	if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
		window.__highascgApplyExtraLiveSources(r.extraLiveSources)
	}
	window.dispatchEvent(new CustomEvent('browser-display-changed', { detail: { source: r?.source || null } }))
}

/**
 * @param {HTMLElement} container
 * @param {{ source: object, onApplied?: (r: object) => void, hostOperatorFullscreen?: object }} opts
 */
export function mountBrowserDisplayControls(container, { source, onApplied, _hostOperatorFullscreen }) {
	if (!source) return

	const section = document.createElement('div')
	section.className = 'inspector-section inspector-browser-display-controls'
	section.innerHTML = `
		<div class="inspector-section__title">Browser source</div>
		<div class="inspector-field" style="margin-bottom:8px">
			<div class="inspector-field__label">URL</div>
			<input type="text" class="inspector-math-input inspector-browser-display__url" style="width:100%;box-sizing:border-box" spellcheck="false" placeholder="https://example.com/" value="${escapeHtml(source.url || '')}" />
		</div>
		<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:8px">
			<div class="inspector-field" style="flex:1;min-width:120px">
				<div class="inspector-field__label">Width (px)</div>
				<input type="number" class="inspector-math-input inspector-browser-display__width" style="width:100%;box-sizing:border-box" min="160" max="3840" value="${source.width || 1152}" />
			</div>
			<div class="inspector-field" style="flex:1;min-width:120px">
				<div class="inspector-field__label">Height (px)</div>
				<input type="number" class="inspector-math-input inspector-browser-display__height" style="width:100%;box-sizing:border-box" min="120" max="2160" value="${source.height || 648}" />
			</div>
			<div class="inspector-field" style="flex:0 0 auto;min-width:80px">
				<div class="inspector-field__label">FPS</div>
				<input type="number" class="inspector-math-input inspector-browser-display__fps" style="width:100%;box-sizing:border-box" min="1" max="60" value="${source.fps || 25}" />
			</div>
		</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
			<button type="button" class="btn btn--secondary inspector-browser-display__apply">Apply</button>
		</div>
		<p class="settings-note" style="margin:8px 0 0">
			Updates the URL, width, height, and FPS on host ch ${escapeHtml(source.hostChannel ?? '?')}. Placed off-screen; max size = free desktop area (1920x648 on this box).
		</p>
	`

	const urlInput = section.querySelector('.inspector-browser-display__url')
	const widthInput = section.querySelector('.inspector-browser-display__width')
	const heightInput = section.querySelector('.inspector-browser-display__height')
	const fpsInput = section.querySelector('.inspector-browser-display__fps')
	const applyBtn = section.querySelector('.inspector-browser-display__apply')

	const runApply = async () => {
		const url = urlInput.value.trim()
		if (!url) {
			showAppToast('Enter a URL', 'warn')
			urlInput.focus()
			return
		}
		const width = Math.max(160, parseInt(String(widthInput.value || '1152'), 10) || 1152)
		const height = Math.max(120, parseInt(String(heightInput.value || '648'), 10) || 648)
		const fps = Math.max(1, Math.min(60, parseInt(String(fpsInput.value || '25'), 10) || 25))

		applyBtn.disabled = true
		try {
			const payload = {
				sourceId: source.sourceId,
				value: source.value,
				action: 'update',
				url,
				width,
				height,
				fps,
			}
			const r = await api.post('/api/host-live/browser', payload)
			applyBrowserDisplayApiResult(r)
			if (r?.source) {
				source.url = r.source.url
				source.width = r.source.width
				source.height = r.source.height
				source.fps = r.source.fps
			}
			onApplied?.(r)
			if (r?.hostLivePlay?.ok === false && r?.hostLivePlay?.error) {
				showAppToast(`Applied, but: ${r.hostLivePlay.error}`, 'warn')
			} else {
				showAppToast(r?.message || 'Browser source updated', 'info')
			}
		} catch (err) {
			showAppToast(err?.message || String(err), 'error')
		} finally {
			applyBtn.disabled = false
		}
	}

	applyBtn.addEventListener('click', () => void runApply())
	urlInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			void runApply()
		}
	})

	container.appendChild(section)
}

/**
 * @param {HTMLElement} container
 * @param {{ source: object, onApplied?: (r: object) => void }} opts
 */
export function mountBrowserDisplayInteractToggle(container, { source, onApplied }) {
	if (!source) return

	const section = document.createElement('div')
	section.className = 'inspector-section inspector-browser-display-interact'
	section.innerHTML = `
		<div class="inspector-section__title">Operator screen</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
			<button type="button" class="btn btn--secondary inspector-browser-display__interact-toggle">Move to operator monitor</button>
		</div>
		<p class="settings-note" style="margin:8px 0 0">
			Toggle between off-screen background and operator monitor. While interacting, the on-air feed keeps tracking the window.
		</p>
	`

	const toggleBtn = section.querySelector('.inspector-browser-display__interact-toggle')

	const runToggle = async () => {
		toggleBtn.disabled = true
		try {
			const r = await api.post('/api/host-live/browser/interact', {
				sourceId: source.sourceId,
				action: 'toggle',
			})
			onApplied?.(r)
			if (r?.ok) {
				const isNowInteracting = r.action === 'interact'
				toggleBtn.textContent = isNowInteracting ? 'Return to background' : 'Move to operator monitor'
				showAppToast(r?.message || (isNowInteracting ? 'Moved to operator monitor' : 'Returned to background'), 'info')
			} else if (r?.error) {
				showAppToast(r.error, 'error')
			}
		} catch (err) {
			showAppToast(err?.message || String(err), 'error')
		} finally {
			toggleBtn.disabled = false
		}
	}

	toggleBtn.addEventListener('click', () => void runToggle())

	container.appendChild(section)
}

/**
 * @param {HTMLElement} root
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ sourceId?: string, value?: string, hostChannel?: number }} selection
 */
export function renderBrowserDisplayInspector(root, stateStore, selection) {
	const extras = stateStore.getState()?.extraLiveSources || []
	const source = resolveBrowserDisplaySource(extras, selection)
	if (!source) {
		root.innerHTML = '<p class="inspector-empty">Browser source not found</p>'
		return
	}

	const hostOperatorFullscreen = stateStore.getState()?.hostOperatorFullscreen

	root.innerHTML = `
		<div class="inspector-section">
			<div class="inspector-section__title">Live browser source</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Label</div>
				<div class="inspector-field__value">${escapeHtml(source.label || source.sourceId || 'Browser')}</div>
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
				<button type="button" class="btn btn--danger inspector-browser-display__remove">Remove</button>
			</div>
		</div>
	`

	mountBrowserDisplayControls(root, {
		source,
		onApplied: () => {
			const next = resolveBrowserDisplaySource(stateStore.getState()?.extraLiveSources || [], selection)
			if (!next) return
			const urlInput = root.querySelector('.inspector-browser-display__url')
			if (urlInput && document.activeElement !== urlInput) {
				urlInput.value = String(next.url || '')
			}
		},
	})

	mountBrowserDisplayInteractToggle(root, { source })

	root.querySelector('.inspector-browser-display__remove')?.addEventListener('click', async () => {
		const label = String(source.label || source.url || 'Browser source')
		if (!confirm(`Remove "${label}" from Live sources?`)) return
		const btn = root.querySelector('.inspector-browser-display__remove')
		if (btn) btn.disabled = true
		try {
			await removeExtraLiveHostSource(source, hostOperatorFullscreen)
			showAppToast('Browser source removed.', 'info')
			window.dispatchEvent(new CustomEvent('browser-display-select', { detail: null }))
		} catch (err) {
			showAppToast(err?.message || String(err), 'error')
			if (btn) btn.disabled = false
		}
	})
}
