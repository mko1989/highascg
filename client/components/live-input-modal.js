/**
 * Modal: add live inputs (DeckLink, NDI, webpage host, live audio).
 * DeckLink: dedicated channel per slot. NDI/browser/live audio: host channel + route:// for on-air.
 */

import { api } from '../lib/api-client.js'
import { decklinkInputForSlot, liveAudioInputForSlot } from '../lib/input-channels.js'
import { addLiveAudioInputSlot, pickLiveAudioSlotForDevice } from '../lib/live-audio-add-input.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'
import { alsaCaptureDeviceOptions, readLiveAudioCasparSettings } from '../lib/live-audio-inputs.js'
import { settingsState } from '../lib/settings-state.js'
import { createNdiAttributionElement } from '../lib/ndi-attribution.js'
import { escapeHtml, escapeAttr } from '../lib/dom-escape.js'

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
						<option value="live_audio">Live Audio</option>
					</select>
				</div>
				<div class="settings-group" id="live-input-ch-row" style="display:none;flex-wrap:wrap;gap:0.75rem;align-items:flex-end">
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
					<div id="live-input-ndi-attribution"></div>
				</div>
				<div class="settings-group" id="live-input-browser-wrap" style="display:none">
					<label>URL</label>
					<input type="text" id="live-input-browser-url" placeholder="https://..." style="width:100%" />
					<label style="margin-top:0.5rem;display:flex;align-items:center;gap:0.35rem;font-weight:normal;cursor:pointer">
						<input type="checkbox" id="live-input-browser-as-cg" />
						Add as CG template (plays <code>highascg_browser_url</code> + passes URL via CG UPDATE)
					</label>
				</div>
				<div class="settings-group" id="live-input-live-audio-wrap" style="display:none">
					<label>ALSA / USB capture device</label>
					<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-bottom:0.35rem">
						<button type="button" class="btn btn--secondary" id="live-input-audio-refresh">Refresh devices</button>
						<span id="live-input-audio-discover-status" class="settings-note"></span>
					</div>
					<select id="live-input-audio-select" style="width:100%;max-width:100%;margin-bottom:0.35rem"></select>
					<label style="font-size:12px">Or type ALSA URI manually</label>
					<input type="text" id="live-input-audio-manual" placeholder="alsa://hw:1,0" style="width:100%" />
					<p class="settings-note" id="live-input-audio-slot-hint" style="margin:0.5rem 0 0"></p>
				</div>
				<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
					<button type="button" class="btn btn--primary" id="live-input-play">Add live source</button>
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
	const liveAudioWrap = modal.querySelector('#live-input-live-audio-wrap')
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
				const deckLabel = entry.label || `DeckLink ${slot}`
				hintEl.innerHTML = `DeckLink slot <strong>${slot}</strong> plays on dedicated channel <strong>${entry.channel}</strong> (layer ${entry.layer ?? slot}). Drag <strong>${escapeHtml(deckLabel)}</strong> from Sources → Live — do not start a second <code>DECKLINK</code> producer for the same device.`
			} else {
				hintEl.innerHTML =
					'Set <strong>decklink_input_count</strong> in Settings, apply Caspar config, and restart. Each input slot gets its own Caspar channel.'
			}
		} else if (k === 'ndi') {
			hintEl.innerHTML =
				'NDI plays on a <strong>dedicated host channel</strong> (allocated automatically). Drag the tile from Sources → Live onto PGM, preview, or multiview using <code>route://</code> — do not play NDI directly on program layers.'
		} else if (k === 'live_audio') {
			hintEl.innerHTML =
				'Live audio gets a <strong>dedicated Caspar host channel</strong> (cheapest video mode, audio-only — no video consumers). ALSA capture runs once on that channel; drag <code>route://</code> from Sources → Live onto PGM or multiview for on-air.'
		} else {
			const cg = modal.querySelector('#live-input-browser-as-cg')?.checked
			hintEl.innerHTML = cg
				? 'CG mode: program/preview use a short <strong>highascg_browser_url</strong> template on Caspar (synced from HighAsCG <code>template/</code>) with your URL in CG data — not a persistent host channel.'
				: 'Webpage plays on a <strong>dedicated host channel</strong> with <code>LOOP</code> so state survives when taken off air. Apply Caspar config after adding, then drag <code>route://</code> onto PGM or multiview.'
		}
	}

	function syncKind() {
		const k = kindSel?.value || 'decklink'
		if (dlWrap) dlWrap.style.display = k === 'decklink' ? 'block' : 'none'
		if (ndiWrap) ndiWrap.style.display = k === 'ndi' ? 'block' : 'none'
		if (browserWrap) browserWrap.style.display = k === 'browser' ? 'block' : 'none'
		if (liveAudioWrap) liveAudioWrap.style.display = k === 'live_audio' ? 'block' : 'none'
		const useFixed = k === 'decklink'
		if (chRow) chRow.style.display = 'none'
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
		if (k === 'live_audio') syncLiveAudioSlotHint()
	}

	function syncLiveAudioSlotHint() {
		const el = modal.querySelector('#live-input-audio-slot-hint')
		if (!el) return
		const ui = readLiveAudioCasparSettings(settingsState.getSettings()?.casparServer || {})
		const manual = (modal.querySelector('#live-input-audio-manual')?.value || '').trim()
		const sel = modal.querySelector('#live-input-audio-select')
		const device = manual || (sel?.value || '').trim()
		try {
			const { slot } = pickLiveAudioSlotForDevice(ui, device || 'alsa://placeholder')
			const entry = liveAudioInputForSlot(channelMap, slot)
			const ch = entry?.channel
			el.textContent = ch != null
				? `Will use slot ${slot} on host ch ${ch} (${entry?.route || 'route://…'}).`
				: `Will use slot ${slot}. Apply Caspar config if this is a new channel.`
		} catch (e) {
			el.textContent = e?.message || String(e)
		}
	}

	async function refreshAudioDevices() {
		const st = modal.querySelector('#live-input-audio-discover-status')
		const sel = modal.querySelector('#live-input-audio-select')
		if (st) st.textContent = 'Scanning…'
		try {
			const r = await api.get('/api/audio/devices?refresh=1')
			const devices = Array.isArray(r?.devices) ? r.devices : []
			if (!sel) return
			sel.innerHTML = alsaCaptureDeviceOptions(devices)
				.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`)
				.join('')
			if (st) st.textContent = devices.length ? `${devices.length} device(s)` : 'No ALSA capture devices found'
			syncLiveAudioSlotHint()
		} catch (e) {
			if (st) st.textContent = e?.message || String(e)
		}
	}
	kindSel?.addEventListener('change', () => {
		syncKind()
		if (kindSel?.value === 'live_audio') void refreshAudioDevices()
	})
	modal.querySelector('#live-input-layer-dl')?.addEventListener('input', syncKind)
	modal.querySelector('#live-input-browser-as-cg')?.addEventListener('change', syncHint)
	modal.querySelector('#live-input-audio-refresh')?.addEventListener('click', () => void refreshAudioDevices())
	modal.querySelector('#live-input-audio-select')?.addEventListener('change', syncLiveAudioSlotHint)
	modal.querySelector('#live-input-audio-manual')?.addEventListener('input', syncLiveAudioSlotHint)
	syncKind()
	const ndiAttrHost = modal.querySelector('#live-input-ndi-attribution')
	if (ndiAttrHost) ndiAttrHost.appendChild(createNdiAttributionElement())

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
			const display = name.startsWith('ndi://') ? name.substring(6).replace(/\/"([^"]+)"/, ' $1') : name

			const item = {
				type: 'ndi',
				ndiName: name,
				label: display,
			}

			try {
				const r = await api.post('/api/device-view', { addExtraLiveSource: item })
				if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				markCasparRestartDirty()
				const hostMsg = r?.hostLivePlay?.ok
					? ' Host producer started.'
					: r?.hostLivePlay?.error
						? ` Host PLAY: ${r.hostLivePlay.error}`
						: ''
				const applyMsg = r?.hostLiveCasparApply?.applied
					? ' Caspar config updated and restarted.'
					: r?.casparRestartRecommended
						? ' Apply Caspar config and restart for new host channel.'
						: ''
				setStatus(`Added to Live Sources.${hostMsg}${applyMsg}`, false)
				setTimeout(close, 1500)
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
				templateOrUrl: url,
				...(asCg ? { browserAsCg: true } : {}),
			}
			try {
				const r = await api.post('/api/device-view', { addExtraLiveSource: item })
				if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				markCasparRestartDirty()
				const hostMsg = r?.hostLivePlay?.ok
					? ' Host producer started.'
					: r?.hostLivePlay?.error
						? ` Host PLAY: ${r.hostLivePlay.error}`
						: ''
				const applyMsg =
					!asCg && r?.hostLiveCasparApply?.applied
						? ' Caspar config updated and restarted.'
						: !asCg && r?.casparRestartRecommended
							? ' Apply Caspar config and restart for new host channel.'
							: ''
				setStatus(`Added to Live Sources.${hostMsg}${applyMsg}`, false)
				setTimeout(close, 1500)
			} catch (e) {
				setStatus(e?.message || String(e), true)
			}
			return
		}

		if (k === 'live_audio') {
			const manual = (modal.querySelector('#live-input-audio-manual')?.value || '').trim()
			const sel = modal.querySelector('#live-input-audio-select')
			const device = manual || (sel?.value || '').trim()
			if (!device) {
				setStatus('Pick a capture device or enter an ALSA URI', true)
				return
			}
			const playBtn = modal.querySelector('#live-input-play')
			if (playBtn) playBtn.disabled = true
			try {
				const r = await addLiveAudioInputSlot(stateStore, { device })
				document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
				document.dispatchEvent(new CustomEvent('highascg-live-audio-configured', { detail: r.liveAudioConfigured }))
				const hostMsg = r?.hostLivePlay?.ok
					? ` Capture started on ch ${r.hostChannel ?? '?'}.`
					: r?.hostLivePlay?.error
						? ` Capture: ${r.hostLivePlay.error}`
						: ''
				const applyMsg = r?.casparApply?.ok
					? ' Caspar config updated and restarted.'
					: r?.casparRestartNeeded
						? ' Apply Caspar config and restart for the new host channel.'
						: ''
				setStatus(`Live audio slot ${r.slot} added.${hostMsg}${applyMsg}`, false)
				setTimeout(close, 1800)
			} catch (e) {
				setStatus(e?.message || String(e), true)
			} finally {
				if (playBtn) playBtn.disabled = false
			}
			return
		}

		if (k !== 'decklink') return

		let cmd
		if (k === 'decklink') {
			const dev = parseInt(String(modal.querySelector('#live-input-decklink-dev')?.value || '0'), 10) || 0
			cmd = `PLAY ${ch}-${layer} DECKLINK ${dev}`
			try {
				await api.post('/api/raw', { cmd })
				setStatus('OK — ' + cmd, false)
			} catch (e) {
				setStatus(e?.message || String(e), true)
			}
		}
	})
}
