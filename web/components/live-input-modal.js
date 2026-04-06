/**
 * Modal: play Decklink or NDI on a Caspar channel/layer (AMCP).
 * NDI sources come from /api/streaming/ndi-sources (FFmpeg discovery on the server).
 */

import { api } from '../lib/api-client.js'

function suggestLiveInputChannel(cm) {
	if (!cm || typeof cm !== 'object') return 5
	if (cm.inputsCh != null) return cm.inputsCh
	const nums = [...(cm.programChannels || []), ...(cm.previewChannels || [])]
	if (cm.multiviewCh != null) nums.push(cm.multiviewCh)
	const max = nums.length ? Math.max(...nums) : 0
	return max + 1
}

/**
 * @param {import('../lib/state-store.js').default} stateStore
 */
export function showLiveInputModal(stateStore) {
	const existing = document.getElementById('live-input-modal')
	if (existing) {
		existing.remove()
		return
	}

	const channelMap = stateStore.getState()?.channelMap || {}
	const defaultCh = suggestLiveInputChannel(channelMap)
	const inputsCh = channelMap.inputsCh

	const modal = document.createElement('div')
	modal.id = 'live-input-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content live-input-modal" role="dialog" aria-labelledby="live-input-modal-title">
			<div class="modal-header">
				<h2 id="live-input-modal-title">Add live input</h2>
				<button type="button" class="modal-close" id="live-input-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body">
				<p class="settings-note live-input-modal__hint">
					Play a producer on a channel with <strong>PLAY channel-layer …</strong>, then use <code>route://…</code> elsewhere.
					${inputsCh != null ? ` Your configured <strong>inputs channel</strong> is <strong>${inputsCh}</strong> (Settings → Screens → Decklink input channels &gt; 0).` : ' Enable <strong>Decklink input channels</strong> in Settings → Screens so Caspar gets a dedicated inputs channel (no screen consumer — routing only).'}
				</p>
				<div class="settings-group">
					<label>Type</label>
					<select id="live-input-kind">
						<option value="decklink">Decklink</option>
						<option value="ndi">NDI</option>
					</select>
				</div>
				<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:flex-end">
					<div>
						<label>Channel</label>
						<input type="number" id="live-input-ch" min="1" max="999" value="${defaultCh}" style="width:5rem" />
					</div>
					<div>
						<label>Layer</label>
						<input type="number" id="live-input-layer" min="0" max="999" value="1" style="width:5rem" />
					</div>
				</div>
				<div class="settings-group" id="live-input-decklink-wrap">
					<label>Decklink device index</label>
					<input type="number" id="live-input-decklink-dev" min="0" max="32" value="0" style="width:5rem" />
				</div>
				<div class="settings-group" id="live-input-ndi-wrap" style="display:none">
					<label>NDI source</label>
					<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-bottom:0.35rem">
						<button type="button" class="btn btn--secondary" id="live-input-ndi-discover">Discover NDI sources</button>
						<span id="live-input-ndi-discover-status" class="settings-note"></span>
					</div>
					<select id="live-input-ndi-select" style="width:100%;max-width:100%;margin-bottom:0.35rem"></select>
					<label style="font-size:12px">Or type name manually</label>
					<input type="text" id="live-input-ndi-manual" placeholder="Exact NDI source name" style="width:100%" />
				</div>
				<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
					<button type="button" class="btn btn--primary" id="live-input-play">Play on channel</button>
					<span id="live-input-status" class="settings-note"></span>
				</div>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const kindSel = modal.querySelector('#live-input-kind')
	const dlWrap = modal.querySelector('#live-input-decklink-wrap')
	const ndiWrap = modal.querySelector('#live-input-ndi-wrap')

	function syncKind() {
		const k = kindSel?.value
		if (dlWrap) dlWrap.style.display = k === 'decklink' ? 'block' : 'none'
		if (ndiWrap) ndiWrap.style.display = k === 'ndi' ? 'block' : 'none'
	}
	kindSel?.addEventListener('change', syncKind)
	syncKind()

	modal.querySelector('#live-input-ndi-discover')?.addEventListener('click', async () => {
		const st = modal.querySelector('#live-input-ndi-discover-status')
		const sel = modal.querySelector('#live-input-ndi-select')
		if (st) st.textContent = 'Scanning…'
		try {
			const r = await api.get('/api/streaming/ndi-sources')
			if (!sel) return
			sel.innerHTML = ''
			const sources = Array.isArray(r.sources) ? r.sources : []
			if (sources.length === 0) {
				const o = document.createElement('option')
				o.value = ''
				o.textContent = r.error || 'No sources (install NDI-enabled FFmpeg on server)'
				sel.appendChild(o)
			} else {
				sources.forEach((name) => {
					const o = document.createElement('option')
					o.value = name
					o.textContent = name
					sel.appendChild(o)
				})
			}
			if (st) st.textContent = sources.length ? `${sources.length} source(s)` : ''
		} catch (e) {
			if (st) st.textContent = e?.message || String(e)
		}
	})

	function close() {
		document.removeEventListener('keydown', onKey)
		modal.remove()
	}
	function onKey(e) {
		if (e.key === 'Escape') close()
	}
	document.addEventListener('keydown', onKey)

	modal.querySelector('#live-input-close')?.addEventListener('click', close)
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})

	modal.querySelector('#live-input-play')?.addEventListener('click', async () => {
		const statusEl = modal.querySelector('#live-input-status')
		const setStatus = (t, err) => {
			if (statusEl) {
				statusEl.textContent = t
				statusEl.style.color = err ? '#e74c3c' : ''
			}
		}
		setStatus('')
		const k = kindSel?.value || 'decklink'
		const ch = parseInt(String(modal.querySelector('#live-input-ch')?.value || '1'), 10)
		const layer = parseInt(String(modal.querySelector('#live-input-layer')?.value || '1'), 10)
		if (!Number.isFinite(ch) || ch < 1 || !Number.isFinite(layer) || layer < 0) {
			setStatus('Invalid channel/layer', true)
			return
		}
		let cmd
		if (k === 'decklink') {
			const dev = parseInt(String(modal.querySelector('#live-input-decklink-dev')?.value || '0'), 10) || 0
			cmd = `PLAY ${ch}-${layer} DECKLINK ${dev}`
		} else {
			const sel = modal.querySelector('#live-input-ndi-select')
			const manual = (modal.querySelector('#live-input-ndi-manual')?.value || '').trim()
			let name = manual
			if (!name && sel && sel.value) name = sel.value.trim()
			if (!name) {
				setStatus('Pick a discovered source or enter a name', true)
				return
			}
			const esc = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
			cmd = `PLAY ${ch}-${layer} NDI "${esc}"`
		}
		try {
			await api.post('/api/raw', { cmd })
			setStatus('OK — ' + cmd, false)
		} catch (e) {
			setStatus(e?.message || String(e), true)
		}
	})
}
