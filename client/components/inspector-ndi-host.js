/**
 * Live NDI host inspector — change NDI source on an existing host channel (no Caspar restart).
 */
import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { removeExtraLiveHostSource, resolveExtraLiveHostSource } from '../lib/extra-live-source-remove.js'
import { showAppToast } from '../lib/app-toast.js'

function applyNdiHostApiResult(r) {
	if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
		window.__highascgApplyExtraLiveSources(r.extraLiveSources)
	}
}

/**
 * @param {HTMLElement} container
 * @param {{ source: object, onApplied?: (r: object) => void }} opts
 */
export function mountNdiHostSourceControls(container, { source, onApplied }) {
	if (!source) return

	const section = document.createElement('div')
	section.className = 'inspector-section inspector-ndi-host-controls'
	section.innerHTML = `
		<div class="inspector-section__title">NDI source</div>
		<div class="inspector-field" style="margin-bottom:8px">
			<input type="text" class="inspector-math-input inspector-ndi-host__name" style="width:100%;box-sizing:border-box" spellcheck="false" placeholder="NDI source name" value="${escapeHtml(source.ndiName || '')}" />
		</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
			<button type="button" class="btn btn--secondary inspector-ndi-host__discover">Discover</button>
			<select class="inspector-ndi-host__pick" style="flex:1;min-width:140px;display:none"></select>
		</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
			<button type="button" class="btn btn--secondary inspector-ndi-host__apply">Apply source</button>
			<button type="button" class="btn btn--secondary inspector-ndi-host__reload">Reload</button>
		</div>
	`

	const nameInput = section.querySelector('.inspector-ndi-host__name')
	const discoverBtn = section.querySelector('.inspector-ndi-host__discover')
	const pickSel = section.querySelector('.inspector-ndi-host__pick')
	const applyBtn = section.querySelector('.inspector-ndi-host__apply')
	const reloadBtn = section.querySelector('.inspector-ndi-host__reload')

	const runUpdate = async (action = 'update') => {
		const ndiName = nameInput.value.trim()
		if (!ndiName && action === 'update') {
			showAppToast('Enter or pick an NDI source name', 'warn')
			nameInput.focus()
			return
		}
		applyBtn.disabled = true
		reloadBtn.disabled = true
		try {
			const payload = {
				sourceId: source.sourceId,
				value: source.value,
				...(action === 'update' ? { ndiName, action: 'update' } : { action: 'reload' }),
			}
			const r = await api.post('/api/host-live/ndi', payload)
			applyNdiHostApiResult(r)
			if (r?.source) {
				source.ndiName = r.source.ndiName
				source.label = r.source.label
			}
			onApplied?.(r)
			showAppToast(r?.message || (action === 'reload' ? 'NDI reloaded' : 'NDI source updated'), 'info')
		} catch (err) {
			showAppToast(err?.message || String(err), 'error')
		} finally {
			applyBtn.disabled = false
			reloadBtn.disabled = false
		}
	}

	discoverBtn?.addEventListener('click', async () => {
		discoverBtn.disabled = true
		try {
			const r = await api.get('/api/ndi/list')
			const names = Array.isArray(r?.sources) ? r.sources : Array.isArray(r?.list) ? r.list : []
			if (!names.length) {
				showAppToast('No NDI sources found', 'warn')
				return
			}
			pickSel.innerHTML = names.map((n) => `<option value="${escapeHtml(String(n))}">${escapeHtml(String(n))}</option>`).join('')
			pickSel.style.display = ''
			pickSel.onchange = () => {
				if (pickSel.value) nameInput.value = pickSel.value
			}
		} catch (e) {
			showAppToast(e?.message || String(e), 'error')
		} finally {
			discoverBtn.disabled = false
		}
	})

	applyBtn?.addEventListener('click', () => void runUpdate('update'))
	reloadBtn?.addEventListener('click', () => void runUpdate('reload'))
	nameInput?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			void runUpdate('update')
		}
	})

	container.appendChild(section)
}

/**
 * @param {HTMLElement} root
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ sourceId?: string, value?: string, hostChannel?: number }} selection
 * @param {{ onClearSelection?: () => void }} [deps]
 */
export function renderNdiHostInspector(root, stateStore, selection, deps = {}) {
	const extras = stateStore.getState()?.extraLiveSources || []
	const source = resolveExtraLiveHostSource(extras, { ...selection, routeType: 'ndi_host' })
	if (!source) {
		root.innerHTML = '<p class="inspector-empty">NDI host source not found</p>'
		return
	}

	root.innerHTML = `
		<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
			<button type="button" class="btn btn--danger" data-ndi-host-remove>Remove</button>
		</div>
	`

	mountNdiHostSourceControls(root, {
		source,
		onApplied: () => {
			const next = resolveExtraLiveHostSource(stateStore.getState()?.extraLiveSources || [], selection)
			if (!next) return
			const nameInput = root.querySelector('.inspector-ndi-host__name')
			if (nameInput && document.activeElement !== nameInput) {
				nameInput.value = String(next.ndiName || '')
			}
		},
	})

	root.querySelector('[data-ndi-host-remove]')?.addEventListener('click', async () => {
		const label = String(source.label || source.ndiName || 'NDI source')
		if (!confirm(`Remove "${label}" from Live sources?`)) return
		const btn = root.querySelector('[data-ndi-host-remove]')
		if (btn) btn.disabled = true
		try {
			await removeExtraLiveHostSource(source)
			showAppToast('NDI source removed.', 'info')
			deps.onClearSelection?.()
		} catch (e) {
			showAppToast(e?.message || String(e), 'error')
			if (btn) btn.disabled = false
		}
	})
}
