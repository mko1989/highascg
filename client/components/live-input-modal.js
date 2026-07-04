/**
 * Modal: add live inputs (DeckLink, NDI, webpage host, live audio, USB video).
 * DeckLink: dedicated channel per slot. NDI/browser/live audio/v4l2: host channel + route:// for on-air.
 */

import { api } from '../lib/api-client.js'
import { decklinkInputForSlot, liveAudioInputForSlot, v4l2InputForSlot, decklinkSlotFromConnector } from '../lib/input-channels.js'
import { normalizeDecklinkIoDirection } from '../lib/decklink-io-direction.js'
import { addLiveAudioInputSlot, pickLiveAudioSlotForDevice } from '../lib/live-audio-add-input.js'
import { addV4l2InputSlot, pickV4l2SlotForDevice } from '../lib/v4l2-add-input.js'
import { addDecklinkInputSlot } from '../lib/decklink-add-input.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'
import { alsaCaptureDeviceOptions, readLiveAudioCasparSettings } from '../lib/live-audio-inputs.js'
import { readV4l2CasparSettings, v4l2AlsaDeviceOptions, v4l2CaptureDeviceOptions } from '../lib/v4l2-inputs.js'
import { settingsState } from '../lib/settings-state.js'
import { effectiveChannelMap, casparHostChannelsPendingApply } from '../lib/planned-channel-map.js'
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
 * @param {{ onAdded?: () => void }} [options]
 */
export function showLiveInputModal(stateStore, options = {}) {
	const existing = document.getElementById('live-input-modal')
	if (existing) existing.remove()

	const channelMap = effectiveChannelMap({
		settings: settingsState.getSettings(),
		liveChannelMap: stateStore.getState()?.channelMap,
	})
	const defaultCh = suggestLiveInputChannel(channelMap)

	function decklinkChannelMap() {
		return effectiveChannelMap({
			settings: settingsState.getSettings(),
			liveChannelMap: stateStore.getState()?.channelMap,
		})
	}

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
						<option value="usb_video">USB Video (V4L2)</option>
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
					<p class="settings-note" style="margin:0">Caspar host channel: <strong id="live-input-ch-fixed-val"></strong> <span id="live-input-ch-planned-note" class="settings-note"></span></p>
				</div>
				<div class="settings-group" id="live-input-decklink-wrap">
					<label>SDI port</label>
					<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
						<select id="live-input-decklink-slot" style="min-width:10rem;max-width:100%"></select>
						<span id="live-input-decklink-port-status" class="settings-note"></span>
					</div>
					<input type="hidden" id="live-input-layer-dl" value="1" />
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
				<div class="settings-group" id="live-input-v4l2-wrap" style="display:none">
					<label>USB / V4L2 capture device</label>
					<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-bottom:0.35rem">
						<button type="button" class="btn btn--secondary" id="live-input-v4l2-refresh">Refresh devices</button>
						<span id="live-input-v4l2-discover-status" class="settings-note"></span>
					</div>
					<select id="live-input-v4l2-select" style="width:100%;max-width:100%;margin-bottom:0.35rem"></select>
					<label style="font-size:12px">Or type device path manually</label>
					<input type="text" id="live-input-v4l2-manual" placeholder="/dev/video0" style="width:100%" />
					<label style="margin-top:0.5rem">Label (optional)</label>
					<input type="text" id="live-input-v4l2-label" placeholder="ATEM PGM" style="width:100%" />
					<div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:0.5rem">
						<div>
							<label>Format</label>
							<select id="live-input-v4l2-format">
								<option value="auto">auto</option>
								<option value="mjpeg">mjpeg</option>
								<option value="yuyv422">yuyv422</option>
							</select>
						</div>
						<div>
							<label>FPS (0=auto)</label>
							<input type="number" id="live-input-v4l2-fps" min="0" max="120" value="0" style="width:5rem" />
						</div>
					</div>
					<p class="settings-note" id="live-input-v4l2-slot-hint" style="margin:0.5rem 0 0"></p>
					<label style="margin-top:0.5rem">Audio (optional)</label>
					<select id="live-input-v4l2-audio-select" style="width:100%;max-width:100%"></select>
					<label style="font-size:12px;margin-top:0.35rem;display:block">Or type ALSA device manually</label>
					<input type="text" id="live-input-v4l2-audio-manual" placeholder="none or hw:3,0" style="width:100%" />
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
	const v4l2Wrap = modal.querySelector('#live-input-v4l2-wrap')
	const chRow = modal.querySelector('#live-input-ch-row')
	const dlChFixed = modal.querySelector('#live-input-decklink-ch-fixed')
	const chFixedVal = modal.querySelector('#live-input-ch-fixed-val')
	const chPlannedNote = modal.querySelector('#live-input-ch-planned-note')

	function syncDecklinkHostChannelHint() {
		const slot = selectedDecklinkSlot()
		const cm = decklinkChannelMap()
		const entry = decklinkInputForSlot(cm, slot)
		const pending = casparHostChannelsPendingApply(
			settingsState.getSettings()?.channelMap,
			stateStore.getState()?.channelMap,
		)
		if (chFixedVal) {
			chFixedVal.textContent = entry?.channel != null ? String(entry.channel) : '—'
		}
		if (chPlannedNote) {
			chPlannedNote.textContent =
				entry?.channel != null
					? pending
						? '(planned — Apply Caspar config to activate)'
						: '— drag the route tile from Sources → Live onto PGM, preview, or multiview.'
					: '(Apply Caspar config to allocate)'
		}
	}

	function selectedDecklinkSlot() {
		const sel = modal.querySelector('#live-input-decklink-slot')
		const n = parseInt(String(sel?.value || modal.querySelector('#live-input-layer-dl')?.value || '1'), 10)
		return Number.isFinite(n) && n >= 1 ? n : 1
	}

	function syncDecklinkFromPort() {
		const layerDl = modal.querySelector('#live-input-layer-dl')
		const slot = selectedDecklinkSlot()
		if (layerDl) layerDl.value = String(slot)
		syncDecklinkHostChannelHint()
		syncHint()
	}

	async function refreshDecklinkPorts() {
		const sel = modal.querySelector('#live-input-decklink-slot')
		const st = modal.querySelector('#live-input-decklink-port-status')
		if (!sel) return
		const prev = sel.value
		if (st) st.textContent = 'Loading ports…'
		try {
			const dv = await api.get('/api/device-view')
			const seen = new Set()
			const connectors = [
				...(Array.isArray(dv?.graph?.connectors) ? dv.graph.connectors : []),
				...(Array.isArray(dv?.suggested?.connectors) ? dv.suggested.connectors : []),
			]
				.filter((c) => c?.kind === 'decklink_io')
				.filter((c) => {
					const slot = decklinkSlotFromConnector(c)
					if (seen.has(slot)) return false
					seen.add(slot)
					return true
				})
				.sort((a, b) => decklinkSlotFromConnector(a) - decklinkSlotFromConnector(b))

			sel.replaceChildren()
			if (!connectors.length) {
				for (let i = 1; i <= 4; i++) {
					const opt = document.createElement('option')
					opt.value = String(i)
					opt.textContent = `SDI ${i}`
					sel.appendChild(opt)
				}
				if (st) st.textContent = 'No DeckLink detected — pick a port number.'
			} else {
				for (const c of connectors) {
					const slot = decklinkSlotFromConnector(c)
					const dir = normalizeDecklinkIoDirection(c?.caspar)
					const role =
						dir === 'in' ? ' · input' : dir === 'out' ? ' · output' : ''
					const opt = document.createElement('option')
					opt.value = String(slot)
					opt.textContent = `${c.label || `SDI ${slot}`}${role}`
					sel.appendChild(opt)
				}
				if (st) st.textContent = `${connectors.length} port(s) from Device View`
			}
			if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev
			syncDecklinkFromPort()
		} catch (e) {
			if (st) st.textContent = e?.message || String(e)
		}
	}

	function syncHint() {
		if (!hintEl) return
		const k = kindSel?.value || 'decklink'
		if (k === 'decklink') {
			const slot = selectedDecklinkSlot()
			const entry = decklinkInputForSlot(decklinkChannelMap(), slot)
			if (entry?.channel != null) {
				const deckLabel = entry.label || `DeckLink ${slot}`
				hintEl.innerHTML = `DeckLink slot <strong>${slot}</strong> plays on dedicated channel <strong>${entry.channel}</strong> (layer ${entry.layer ?? slot}). Drag <strong>${escapeHtml(deckLabel)}</strong> from Sources → Live — do not start a second <code>DECKLINK</code> producer for the same device.`
			} else {
				hintEl.innerHTML =
					'Registers a <strong>dedicated Caspar host channel</strong> for this SDI port and adds a Live source tile. HighAsCG updates DeckLink input count in config — use <strong>Apply Caspar config</strong> in Device View when you are ready to restart and start capture.'
			}
		} else if (k === 'ndi') {
			hintEl.innerHTML =
				'NDI plays on a <strong>dedicated host channel</strong> (allocated automatically). Drag the tile from Sources → Live onto PGM, preview, or multiview using <code>route://</code> — do not play NDI directly on program layers.'
		} else if (k === 'live_audio') {
			hintEl.innerHTML =
				'Live audio gets a <strong>dedicated Caspar host channel</strong> (cheapest video mode, audio-only — no video consumers). ALSA capture runs once on that channel; drag <code>route://</code> from Sources → Live onto PGM or multiview for on-air.'
		} else if (k === 'usb_video') {
			hintEl.innerHTML =
				'USB / V4L2 video gets a <strong>dedicated Caspar host channel</strong>. FFmpeg captures from the device and Caspar plays MPEG-TS via UDP; drag <code>route://</code> from Sources → Live onto PGM or multiview. Apply Caspar config when adding a new slot.'
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
		if (v4l2Wrap) v4l2Wrap.style.display = k === 'usb_video' ? 'block' : 'none'
		const useFixed = k === 'decklink'
		if (chRow) chRow.style.display = 'none'
		if (dlChFixed) dlChFixed.style.display = useFixed ? 'block' : 'none'
		if (useFixed) syncDecklinkHostChannelHint()
		syncHint()
		if (k === 'decklink') void refreshDecklinkPorts()
		if (k === 'live_audio') syncLiveAudioSlotHint()
		if (k === 'usb_video') syncV4l2SlotHint()
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

	function syncV4l2SlotHint() {
		const el = modal.querySelector('#live-input-v4l2-slot-hint')
		if (!el) return
		const ui = readV4l2CasparSettings(settingsState.getSettings()?.casparServer || {})
		const manual = (modal.querySelector('#live-input-v4l2-manual')?.value || '').trim()
		const sel = modal.querySelector('#live-input-v4l2-select')
		const device = manual || (sel?.value || '').trim()
		try {
			const { slot } = pickV4l2SlotForDevice(ui, device || '/dev/video0')
			const entry = v4l2InputForSlot(channelMap, slot)
			const ch = entry?.channel
			el.textContent = ch != null
				? `Will use slot ${slot} on host ch ${ch} (${entry?.route || 'route://…'}).`
				: `Will use slot ${slot}. Apply Caspar config if this is a new channel.`
		} catch (e) {
			el.textContent = e?.message || String(e)
		}
	}

	async function refreshV4l2Devices() {
		const st = modal.querySelector('#live-input-v4l2-discover-status')
		const sel = modal.querySelector('#live-input-v4l2-select')
		const audioSel = modal.querySelector('#live-input-v4l2-audio-select')
		if (st) st.textContent = 'Scanning…'
		try {
			const [v4l2r, audior] = await Promise.all([
				api.get('/api/system/v4l2-devices?refresh=1'),
				api.get('/api/audio/devices?refresh=1'),
			])
			const devices = Array.isArray(v4l2r?.devices) ? v4l2r.devices : []
			const alsa = Array.isArray(audior?.devices) ? audior.devices : []
			if (!sel) return
			sel.innerHTML = v4l2CaptureDeviceOptions(devices)
				.map((o) => `<option value="${escapeAttr(o.value)}"${o.disabled ? ' disabled' : ''}>${escapeHtml(o.label)}</option>`)
				.join('')
			if (audioSel) {
				audioSel.innerHTML = v4l2AlsaDeviceOptions(alsa)
					.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`)
					.join('')
			}
			if (st) st.textContent = devices.length ? `${devices.length} video, ${alsa.length} audio device(s)` : 'No V4L2 capture devices found'
			syncV4l2SlotHint()
		} catch (e) {
			if (st) st.textContent = e?.message || String(e)
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
		if (kindSel?.value === 'usb_video') void refreshV4l2Devices()
	})
	modal.querySelector('#live-input-decklink-slot')?.addEventListener('change', syncDecklinkFromPort)
	modal.querySelector('#live-input-browser-as-cg')?.addEventListener('change', syncHint)
	modal.querySelector('#live-input-audio-refresh')?.addEventListener('click', () => void refreshAudioDevices())
	modal.querySelector('#live-input-audio-select')?.addEventListener('change', syncLiveAudioSlotHint)
	modal.querySelector('#live-input-audio-manual')?.addEventListener('input', syncLiveAudioSlotHint)
	modal.querySelector('#live-input-v4l2-refresh')?.addEventListener('click', () => void refreshV4l2Devices())
	modal.querySelector('#live-input-v4l2-select')?.addEventListener('change', syncV4l2SlotHint)
	modal.querySelector('#live-input-v4l2-manual')?.addEventListener('input', syncV4l2SlotHint)
	syncKind()
	void settingsState.load().then(() => {
		syncDecklinkFromPort()
		syncKind()
	})
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

	function finishAdded() {
		if (typeof options.onAdded === 'function') {
			try {
				options.onAdded()
			} catch (e) {
				console.warn('[live-input-modal] onAdded failed', e)
			}
		}
		setTimeout(close, 1500)
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
		const playBtn = modal.querySelector('#live-input-play')
		if (playBtn?.dataset.submitting === '1') return
		const setStatus = (t, err) => {
			if (statusEl) {
				statusEl.textContent = t
				statusEl.style.color = err ? '#e74c3c' : ''
			}
		}
		setStatus('')
		const k = kindSel?.value || 'decklink'

		if (k === 'decklink') {
			const slot = selectedDecklinkSlot()
			if (!Number.isFinite(slot) || slot < 1) {
				setStatus('Pick an SDI port', true)
				return
			}
			if (playBtn) {
				playBtn.disabled = true
				playBtn.dataset.submitting = '1'
			}
			setStatus(`Registering DeckLink SDI port ${slot}…`, false)
			try {
				const r = await addDecklinkInputSlot(stateStore, { slot })
				if (!r.ok) {
					setStatus(r.error || 'Failed to add DeckLink input', true)
					return
				}
				if (Array.isArray(r.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				if (r.casparRestartNeeded || r.pendingApply) markCasparRestartDirty()
				const applyMsg = r.pendingApply || r.casparRestartNeeded
					? ' Apply Caspar config and restart in Device View to start capture.'
					: ''
				const againMsg = r.alreadyConfigured ? ' (capture refreshed on existing host channel.)' : ''
				const chMsg =
					r.hostChannel != null
						? `host channel ${r.hostChannel}`
						: 'host channel (after apply)'
				setStatus(`DeckLink input slot ${r.slot} · ${chMsg} · ${r.route || ''}.${applyMsg}${againMsg}`, false)
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			} finally {
				if (playBtn) {
					playBtn.disabled = false
					delete playBtn.dataset.submitting
				}
			}
			return
		}

		let ch
		let layer
		ch = parseInt(String(modal.querySelector('#live-input-ch')?.value || '1'), 10)
		layer = parseInt(String(modal.querySelector('#live-input-layer')?.value || '1'), 10)
		if (!Number.isFinite(ch) || ch < 1 || !Number.isFinite(layer) || layer < 0) {
			setStatus('Invalid channel/layer', true)
			return
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
				finishAdded()
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
				finishAdded()
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
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			} finally {
				if (playBtn) playBtn.disabled = false
			}
			return
		}

		if (k === 'usb_video') {
			const manual = (modal.querySelector('#live-input-v4l2-manual')?.value || '').trim()
			const sel = modal.querySelector('#live-input-v4l2-select')
			const device = manual || (sel?.value || '').trim()
			if (!device) {
				setStatus('Pick a capture device or enter a device path', true)
				return
			}
			const label = (modal.querySelector('#live-input-v4l2-label')?.value || '').trim()
			const format = (modal.querySelector('#live-input-v4l2-format')?.value || 'auto').trim()
			const fps = parseInt(String(modal.querySelector('#live-input-v4l2-fps')?.value || '0'), 10) || 0
			const audioManual = (modal.querySelector('#live-input-v4l2-audio-manual')?.value || '').trim()
			const audioSel = modal.querySelector('#live-input-v4l2-audio-select')
			const audio =
				audioManual ||
				(audioSel?.value && audioSel.value !== 'none' ? String(audioSel.value).trim() : '') ||
				'none'
			const playBtn = modal.querySelector('#live-input-play')
			if (playBtn) playBtn.disabled = true
			try {
				const r = await addV4l2InputSlot(stateStore, {
					device,
					...(label ? { label } : {}),
					...(format && format !== 'auto' ? { format } : {}),
					...(fps > 0 ? { fps } : {}),
					...(audio && audio !== 'none' ? { audio } : {}),
				})
				document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
				document.dispatchEvent(new CustomEvent('highascg-v4l2-configured', { detail: r.v4l2Configured }))
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
				setStatus(`USB video slot ${r.slot} added.${hostMsg}${applyMsg}`, false)
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			} finally {
				if (playBtn) playBtn.disabled = false
			}
			return
		}
	})
}
