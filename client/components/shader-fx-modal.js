/**
 * WO-266 — Shader FX manager modal.
 *
 * CRUD over `/api/shaders` (paste-code Shadertoy-style configs). Saving exports a Caspar HTML
 * template `shaders/<id>` (server side), so playout works through the normal Templates tab —
 * this modal only edits the library and previews the exported page. For real-FFT audio
 * reactivity play the exported URL via a browser_display source (WO-258/260); the CG/CEF path
 * falls back to coarse WS levels (see template/shaders/player.js).
 */

import { api } from '../lib/api-client.js'
import { resolveApiUrl } from '../lib/api-origin.js'
import { escapeHtml } from './sources-panel-helpers.js'
import { mountShaderParamsPanel } from './shader-fx-params.js'

const PASSES = [
	{ key: 'image', label: 'Image (required)' },
	{ key: 'bufferA', label: 'Buffer A' },
	{ key: 'bufferB', label: 'Buffer B' },
	{ key: 'bufferC', label: 'Buffer C' },
	{ key: 'bufferD', label: 'Buffer D' },
]
const CHANNEL_OPTIONS = ['', 'A', 'B', 'C', 'D', 'audio']

function channelSelects(passKey, channels) {
	return [0, 1, 2, 3]
		.map((i) => {
			const opts = CHANNEL_OPTIONS.map((c) => {
				const sel = (channels?.[i] || '') === c ? ' selected' : ''
				return `<option value="${c}"${sel}>${c || '—'}</option>`
			}).join('')
			return `<label class="shaderfx-ch">iCh${i}<select data-pass="${passKey}" data-ch="${i}">${opts}</select></label>`
		})
		.join('')
}

function passSection(pass, data) {
	const p = data?.passes?.[pass.key]
	const open = pass.key === 'image' || !!p
	return `
		<details class="shaderfx-pass" data-pass-section="${pass.key}"${open ? ' open' : ''}>
			<summary>${pass.label}</summary>
			<div class="shaderfx-pass__channels">${channelSelects(pass.key, p?.channels)}</div>
			<textarea data-pass-src="${pass.key}" rows="8" spellcheck="false"
				placeholder="// paste the Shadertoy ${pass.key === 'image' ? 'Image' : pass.key} tab GLSL here">${escapeHtml(p?.source || '')}</textarea>
		</details>`
}

/**
 * Open (or toggle closed) the Shader FX manager.
 * @param {{ editId?: string }} [opts]
 */
export function showShaderFxModal(opts = {}) {
	const existing = document.getElementById('shaderfx-modal')
	if (existing) {
		existing.remove()
		return
	}

	const modal = document.createElement('div')
	modal.id = 'shaderfx-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content shaderfx-modal" role="dialog" aria-labelledby="shaderfx-title">
			<div class="modal-header">
				<h2 id="shaderfx-title">Shader FX</h2>
				<button type="button" class="modal-close" id="shaderfx-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body shaderfx-modal__body">
				<aside class="shaderfx-list">
					<button type="button" class="btn btn--secondary" id="shaderfx-new">+ New shader</button>
					<ul id="shaderfx-list"></ul>
					<p class="settings-note">Saved shaders export to <code>template/shaders/</code> and appear in the Templates tab after a Caspar template refresh.</p>
				</aside>
				<section class="shaderfx-editor">
					<div class="shaderfx-row">
						<label>Name <input type="text" id="shaderfx-name" placeholder="My audio shader"></label>
						<label class="shaderfx-flag"><input type="checkbox" id="shaderfx-audio" checked> audio reactive</label>
						<label class="shaderfx-flag" title="Transparent background (overlay use)"><input type="checkbox" id="shaderfx-alpha"> alpha</label>
					</div>
					<details class="shaderfx-pass" data-pass-section="common">
						<summary>Common</summary>
						<textarea id="shaderfx-common" rows="6" spellcheck="false" placeholder="// optional: Shadertoy Common tab"></textarea>
					</details>
					<div id="shaderfx-passes"></div>
					<div class="shaderfx-row shaderfx-actions">
						<button type="button" class="btn" id="shaderfx-save">Save & export</button>
						<button type="button" class="btn btn--secondary" id="shaderfx-delete" disabled>Delete</button>
						<span class="shaderfx-status" id="shaderfx-status"></span>
					</div>
					<div class="shaderfx-preview-wrap">
						<iframe id="shaderfx-preview" title="Shader preview"></iframe>
					</div>
				</section>
			</div>
		</div>`
	document.body.appendChild(modal)

	const el = (id) => modal.querySelector(`#${id}`)
	const statusEl = el('shaderfx-status')
	let currentId = null

	function setStatus(msg, cls) {
		statusEl.textContent = msg || ''
		statusEl.className = `shaderfx-status${cls ? ` shaderfx-status--${cls}` : ''}`
	}

	function renderPasses(data) {
		el('shaderfx-passes').innerHTML = PASSES.map((p) => passSection(p, data)).join('')
	}

	function fillForm(data) {
		currentId = data?.id || null
		el('shaderfx-name').value = data?.name || ''
		el('shaderfx-audio').checked = data ? data.audio?.enabled !== false : true
		el('shaderfx-alpha').checked = data?.opts?.alpha === true
		el('shaderfx-common').value = data?.common || ''
		renderPasses(data)
		el('shaderfx-delete').disabled = !currentId
		el('shaderfx-preview').src = currentId ? resolveApiUrl(`/templates/shaders/${currentId}.html?_=${Date.now()}`) : 'about:blank'
		setStatus(currentId ? `Editing ${currentId}` : 'New shader')
		paramsPanel.rescan()
	}

	function collectForm() {
		/** @type {Record<string, any>} */
		const passes = {}
		for (const p of PASSES) {
			const source = modal.querySelector(`textarea[data-pass-src="${p.key}"]`)?.value || ''
			if (!source.trim()) continue
			const channels = [0, 1, 2, 3].map((i) => modal.querySelector(`select[data-pass="${p.key}"][data-ch="${i}"]`)?.value || null)
			passes[p.key] = { source, channels: channels.map((c) => c || null) }
		}
		return {
			id: currentId || undefined,
			name: el('shaderfx-name').value.trim(),
			common: el('shaderfx-common').value,
			passes,
			audio: { enabled: el('shaderfx-audio').checked },
			opts: { alpha: el('shaderfx-alpha').checked },
		}
	}

	async function refreshList(selectId) {
		try {
			const data = await api.get('/api/shaders')
			const listEl = el('shaderfx-list')
			listEl.innerHTML = ''
			for (const s of data?.shaders || []) {
				const li = document.createElement('li')
				li.innerHTML = `<button type="button" class="shaderfx-list__item${s.id === selectId ? ' active' : ''}" data-id="${s.id}">
					${escapeHtml(s.name)}${s.audio ? ' <span class="shaderfx-badge" title="audio reactive">♪</span>' : ''}</button>`
				li.querySelector('button').addEventListener('click', () => void openShader(s.id))
				listEl.appendChild(li)
			}
		} catch (e) {
			setStatus(`List failed: ${e?.message || e}`, 'err')
		}
	}

	async function openShader(id) {
		try {
			fillForm(await api.get(`/api/shaders/${encodeURIComponent(id)}`))
			await refreshList(id)
		} catch (e) {
			setStatus(`Load failed: ${e?.message || e}`, 'err')
		}
	}

	// WO-340: detected-parameters panel — color pickers/sliders that rewrite the GLSL literals
	// in the textareas and apply through the normal save path (preview reloads once per change).
	const sourceTextarea = (passKey) =>
		passKey === 'common' ? el('shaderfx-common') : modal.querySelector(`textarea[data-pass-src="${passKey}"]`)
	const paramsPanel = mountShaderParamsPanel(modal, {
		getSource: (passKey) => sourceTextarea(passKey)?.value || '',
		setSource: (passKey, src) => {
			const ta = sourceTextarea(passKey)
			if (ta) ta.value = src
		},
		applyChange: () => doSave(),
	})
	modal.addEventListener('input', (e) => {
		const t = e.target
		if (t instanceof HTMLTextAreaElement && (t.id === 'shaderfx-common' || t.dataset.passSrc != null)) {
			paramsPanel.scheduleRescan()
		}
	})

	async function doSave() {
		setStatus('Saving…')
		try {
			const r = await api.post('/api/shaders', collectForm())
			if (!r?.ok) throw new Error(r?.error || 'save failed')
			currentId = r.id
			setStatus(`Saved — Caspar template "${r.casparPath}" (refresh Templates to play)`, 'ok')
			await refreshList(r.id)
			el('shaderfx-delete').disabled = false
			el('shaderfx-preview').src = resolveApiUrl(`/templates/shaders/${r.id}.html?_=${Date.now()}`)
		} catch (e) {
			setStatus(String(e?.message || e), 'err')
		}
	}

	el('shaderfx-close').addEventListener('click', () => modal.remove())
	modal.addEventListener('click', (e) => {
		if (e.target === modal) modal.remove()
	})
	el('shaderfx-new').addEventListener('click', () => fillForm(null))
	el('shaderfx-save').addEventListener('click', () => void doSave())
	el('shaderfx-delete').addEventListener('click', async () => {
		if (!currentId) return
		try {
			await api.delete(`/api/shaders/${encodeURIComponent(currentId)}`)
			fillForm(null)
			await refreshList()
			setStatus('Deleted', 'ok')
		} catch (e) {
			setStatus(`Delete failed: ${e?.message || e}`, 'err')
		}
	})

	fillForm(null)
	void refreshList().then(() => {
		if (opts.editId) void openShader(opts.editId)
	})
}
