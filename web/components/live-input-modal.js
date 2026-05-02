/**
 * Modal: play Decklink or NDI on a Caspar channel/layer (AMCP).
 * DeckLink: only on the configured inputs host channel (see Settings → Screens); elsewhere use route://.
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
	const decklinkCount = channelMap.decklinkCount ?? 0

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
				<p class="settings-note live-input-modal__hint" id="live-input-hint"></p>
				<div class="settings-group">
					<label>Type</label>
					<select id="live-input-kind">
						<option value="decklink">Decklink</option>
						<option value="ndi">NDI</option>
					</select>
				</div>
				<div class="settings-group" id="live-input-ch-row" style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:flex-end">
					<div>
						<label>Channel</label>
						<input type="number" id="live-input-ch" min="1" max="999" value="${defaultCh}" style="width:5rem" />
					</div>
					<div>
						<label>Layer</label>
						<input type="number" id="live-input-layer" min="0" max="999" value="1" style="width:5rem" />
					</div>
				</div>
				<div class="settings-group" id="live-input-decklink-ch-fixed" style="display:none">
					<p class="settings-note" style="margin:0">DeckLink channel (locked): <strong id="live-input-ch-fixed-val"></strong> — use <code>route://…</code> on PGM, other previews, and multiview.</p>
					<div style="margin-top:0.5rem">
						<label>Layer (input slot)</label>
						<input type="number" id="live-input-layer-dl" min="1" max="99" value="1" style="width:5rem" />
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

	const hintEl = modal.querySelector('#live-input-hint')
	const kindSel = modal.querySelector('#live-input-kind')
	const dlWrap = modal.querySelector('#live-input-decklink-wrap')
	const ndiWrap = modal.querySelector('#live-input-ndi-wrap')
	const chRow = modal.querySelector('#live-input-ch-row')
	const dlChFixed = modal.querySelector('#live-input-decklink-ch-fixed')
	const chFixedVal = modal.querySelector('#live-input-ch-fixed-val')

	function syncHint() {
		if (!hintEl) return
		const k = kindSel?.value || 'decklink'
		if (k === 'decklink') {
			if (inputsCh != null) {
				hintEl.innerHTML = `DeckLink is played <strong>only</strong> on the inputs host (channel <strong>${inputsCh}</strong>). On program, other channels, and multiview, drag a <code>route://${inputsCh}-N</code> tile from Sources → Live — do not run a second <code>DECKLINK</code> producer for the same device.`
			} else {
				hintEl.innerHTML =
					'Enable <strong>DeckLink inputs host</strong> in Settings → <strong>Inputs</strong> (and apply Caspar config), then pick the host channel.'
			}
		} else {
			hintEl.innerHTML =
				'NDI can use any channel/layer. For consistency you can still use the inputs channel if configured.'
		}
	}

	function syncKind() {
		const k = kindSel?.value || 'decklink'
		if (dlWrap) dlWrap.style.display = k === 'decklink' ? 'block' : 'none'
		if (ndiWrap) ndiWrap.style.display = k === 'ndi' ? 'block' : 'none'
		const useFixed = k === 'decklink' && inputsCh != null
		if (chRow) chRow.style.display = useFixed ? 'none' : 'flex'
		if (dlChFixed) dlChFixed.style.display = useFixed ? 'block' : 'none'
		if (chFixedVal && inputsCh != null) chFixedVal.textContent = String(inputsCh)
		const layerDl = modal.querySelector('#live-input-layer-dl')
		if (layerDl && decklinkCount > 0) {
			layerDl.max = String(Math.min(99, decklinkCount))
		}
		syncHint()
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
		let ch
		let layer
		if (k === 'decklink') {
			if (inputsCh == null) {
				setStatus('Configure DeckLink inputs in Settings → Inputs first.', true)
				return
			}
			ch = inputsCh
			layer = parseInt(String(modal.querySelector('#live-input-layer-dl')?.value || '1'), 10)
			if (!Number.isFinite(layer) || layer < 1) {
				setStatus('Invalid layer', true)
				return
			}
			if (decklinkCount > 0 && layer > decklinkCount) {
				setStatus(`Layer must be 1–${decklinkCount} for configured input slots`, true)
				return
			}
		} else {
			ch = parseInt(String(modal.querySelector('#live-input-ch')?.value || '1'), 10)
			layer = parseInt(String(modal.querySelector('#live-input-layer')?.value || '1'), 10)
			if (!Number.isFinite(ch) || ch < 1 || !Number.isFinite(layer) || layer < 0) {
				setStatus('Invalid channel/layer', true)
				return
			}
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
