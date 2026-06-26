/**
 * Modal: play Decklink or NDI on a Caspar channel/layer (AMCP).
 * DeckLink: only on the configured inputs host channel (see Settings → Screens); elsewhere use route://.
 * NDI sources come from /api/streaming/ndi-sources (FFmpeg discovery on the server).
 */

import { api } from '../lib/api-client.js'
import { decklinkInputForSlot } from '../lib/input-channels.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'

function suggestLiveInputChannel(cm) {
	if (!cm || typeof cm !== 'object') return 5
	const first = cm.decklinkInputChannels?.[0] ?? cm.liveAudioInputChannels?.[0] ?? cm.inputsCh
	if (first != null) return first
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
						<option value="browser">Web Browser</option>
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
					<p class="settings-note" style="margin:0">DeckLink channel (locked): <strong id="live-input-ch-fixed-val"></strong> — drag the route tile from Sources → Live onto PGM, preview, or multiview.</p>
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
					<div style="margin-top:0.5rem">
						<label><input type="checkbox" id="live-input-ndi-direct" checked /> Use Direct Mode (Multiple places, higher traffic)</label>
					</div>
				</div>
				<div class="settings-group" id="live-input-browser-wrap" style="display:none">
					<label>URL</label>
					<input type="text" id="live-input-browser-url" placeholder="https://..." style="width:100%" />
					<label style="margin-top:0.5rem;display:flex;align-items:center;gap:0.35rem;font-weight:normal;cursor:pointer">
						<input type="checkbox" id="live-input-browser-as-cg" />
						Add as CG template (plays <code>highascg_browser_url</code> + passes URL via CG UPDATE)
					</label>
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
	const browserWrap = modal.querySelector('#live-input-browser-wrap')
	const chRow = modal.querySelector('#live-input-ch-row')
	const dlChFixed = modal.querySelector('#live-input-decklink-ch-fixed')
	const chFixedVal = modal.querySelector('#live-input-ch-fixed-val')

	function syncHint() {
		if (!hintEl) return
		const k = kindSel?.value || 'decklink'
		if (k === 'decklink') {
			const slot = parseInt(String(modal.querySelector('#live-input-layer-dl')?.value || '1'), 10) || 1
			const entry = decklinkInputForSlot(channelMap, slot)
			if (entry?.channel != null) {
				hintEl.innerHTML = `DeckLink slot <strong>${slot}</strong> plays on dedicated channel <strong>${entry.channel}</strong> (layer ${entry.layer ?? slot}). Drag <strong>${entry.label || 'DeckLink ' + slot}</strong> from Sources → Live — do not start a second <code>DECKLINK</code> producer for the same device.`
			} else {
				hintEl.innerHTML =
					'Set <strong>decklink_input_count</strong> in Settings, apply Caspar config, and restart. Each input slot gets its own Caspar channel.'
			}
		} else if (k === 'ndi') {
			hintEl.innerHTML =
				'NDI can use any channel/layer. For consistency you can still use the inputs channel if configured.'
		} else {
			const cg = modal.querySelector('#live-input-browser-as-cg')?.checked
			hintEl.innerHTML = cg
				? 'CG mode: program/preview use a short <strong>highascg_browser_url</strong> template on Caspar (synced from HighAsCG <code>template/</code>) with your URL in CG data — not plain <code>PLAY … https://</code>.'
				: 'Browser sources play a web page URL directly (<code>PLAY … [HTML] URL</code>).'
		}
	}

	function syncKind() {
		const k = kindSel?.value || 'decklink'
		if (dlWrap) dlWrap.style.display = k === 'decklink' ? 'block' : 'none'
		if (ndiWrap) ndiWrap.style.display = k === 'ndi' ? 'block' : 'none'
		if (browserWrap) browserWrap.style.display = k === 'browser' ? 'block' : 'none'
		const useFixed = k === 'decklink'
		if (chRow) chRow.style.display = (useFixed || k === 'browser') ? 'none' : 'flex'
		if (dlChFixed) dlChFixed.style.display = useFixed ? 'block' : 'none'
		if (useFixed) {
			const slot = parseInt(String(modal.querySelector('#live-input-layer-dl')?.value || '1'), 10) || 1
			const entry = decklinkInputForSlot(channelMap, slot)
			if (chFixedVal) chFixedVal.textContent = entry?.channel != null ? String(entry.channel) : '(not allocated)'
		}
		const layerDl = modal.querySelector('#live-input-layer-dl')
		if (layerDl && decklinkCount > 0) {
			layerDl.max = String(Math.min(99, decklinkCount))
		}
		syncHint()
	}
	kindSel?.addEventListener('change', syncKind)
	modal.querySelector('#live-input-layer-dl')?.addEventListener('input', syncKind)
	modal.querySelector('#live-input-browser-as-cg')?.addEventListener('change', syncHint)
	syncKind()

	modal.querySelector('#live-input-ndi-discover')?.addEventListener('click', async () => {
		const st = modal.querySelector('#live-input-ndi-discover-status')
		const sel = modal.querySelector('#live-input-ndi-select')
		if (st) st.textContent = 'Scanning…'
		try {
			const r = await api.get('/api/ndi/list')
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
					o.textContent = name.startsWith('ndi://') ? name.substring(6).replace(/\/"([^"]+)"/, ' $1') : name
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
			const slot = parseInt(String(modal.querySelector('#live-input-layer-dl')?.value || '1'), 10)
			if (!Number.isFinite(slot) || slot < 1) {
				setStatus('Invalid slot', true)
				return
			}
			if (decklinkCount > 0 && slot > decklinkCount) {
				setStatus(`Slot must be 1–${decklinkCount} for configured input slots`, true)
				return
			}
			const entry = decklinkInputForSlot(channelMap, slot)
			if (entry?.channel == null) {
				setStatus(`No dedicated channel for DeckLink slot ${slot}. Set decklink_input_count and restart Caspar.`, true)
				return
			}
			ch = entry.channel
			layer = entry.layer ?? slot
		} else {
			ch = parseInt(String(modal.querySelector('#live-input-ch')?.value || '1'), 10)
			layer = parseInt(String(modal.querySelector('#live-input-layer')?.value || '1'), 10)
			if (!Number.isFinite(ch) || ch < 1 || !Number.isFinite(layer) || layer < 0) {
				setStatus('Invalid channel/layer', true)
				return
			}
		}
		if (k === 'ndi') {
			const sel = modal.querySelector('#live-input-ndi-select')
			const manual = (modal.querySelector('#live-input-ndi-manual')?.value || '').trim()
			let name = manual
			if (!name && sel && sel.value) name = sel.value.trim()
			if (!name) {
				setStatus('Pick a discovered source or enter a name', true)
				return
			}
			const direct = modal.querySelector('#live-input-ndi-direct')?.checked ?? true
			let thumbCh = parseInt(String(modal.querySelector('#live-input-ch')?.value || ''), 10)
			if (!Number.isFinite(thumbCh) || thumbCh < 1) thumbCh = suggestLiveInputChannel(channelMap)

			const item = {
				type: 'ndi',
				value: name.startsWith('ndi://') ? name : `ndi://${name}`,
				label: name.startsWith('ndi://') ? name.substring(6).replace(/\/"([^"]+)"/, ' $1') : name,
				useDirect: direct,
				// Routed previews use PRINT on this channel; direct NDI is not keyed to a PGM still.
				...(direct ? {} : { thumbnailChannel: thumbCh }),
			}

			try {
				const r = await api.post('/api/device-view', { addExtraLiveSource: item })
				if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				markCasparRestartDirty()
				setStatus('Added to Live Sources', false)
				setTimeout(close, 1000)
			} catch (e) {
				setStatus(e?.message || String(e), true)
			}
			return
		}
		
		if (k === 'browser') {
			const url = (modal.querySelector('#live-input-browser-url')?.value || '').trim()
			if (!url) {
				setStatus('Enter a URL', true)
				return
			}
			const asCg = !!modal.querySelector('#live-input-browser-as-cg')?.checked
			const item = {
				type: 'browser',
				value: url,
				label: asCg ? `${url} (CG)` : url,
				thumbnailChannel: suggestLiveInputChannel(channelMap),
				...(asCg ? { browserAsCg: true } : {}),
			}
			try {
				const r = await api.post('/api/device-view', { addExtraLiveSource: item })
				if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				markCasparRestartDirty()
				setStatus('Added to Live Sources', false)
				setTimeout(close, 1000)
			} catch (e) {
				setStatus(e?.message || String(e), true)
			}
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
