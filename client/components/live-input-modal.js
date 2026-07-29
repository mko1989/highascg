/**
 * Modal: add live inputs (DeckLink, NDI, webpage host, live audio, USB video).
 * DeckLink: dedicated channel per slot. NDI/browser/live audio/v4l2: host channel + route:// for on-air.
 */

import { api } from '../lib/api-client.js'
import { decklinkInputForSlot, liveAudioInputForSlot, v4l2InputForSlot, decklinkSlotFromConnector } from '../lib/input-channels.js'
import { normalizeDecklinkIoDirection } from '../lib/decklink-io-direction.js'
import { pickLiveAudioSlotForDevice } from '../lib/live-audio-add-input.js'
import { pickV4l2SlotForDevice } from '../lib/v4l2-add-input.js'
import { alsaCaptureDeviceOptions, readLiveAudioCasparSettings } from '../lib/live-audio-inputs.js'
import { readV4l2CasparSettings, v4l2AlsaDeviceOptions, v4l2CaptureDeviceOptions } from '../lib/v4l2-inputs.js'
import { settingsState } from '../lib/settings-state.js'
import { effectiveChannelMap, hostChannelPendingApply } from '../lib/planned-channel-map.js'
import { createNdiAttributionElement } from '../lib/ndi-attribution.js'
import { escapeHtml, escapeAttr } from '../lib/dom-escape.js'
import { createLiveInputModalShell } from './live-input-modal-shell.js'
import { attachLiveInputModalSubmit } from './live-input-modal-submit.js'

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

	const { modal, elements } = createLiveInputModalShell(defaultCh)
	const hintEl = elements.hintEl
	const kindSel = elements.kindSel
	const dlWrap = elements.dlWrap
	const ndiWrap = elements.ndiWrap
	const browserDisplayWrap = elements.browserDisplayWrap
	const browserWrap = elements.browserWrap
	const liveAudioWrap = elements.liveAudioWrap
	const v4l2Wrap = elements.v4l2Wrap
	const chRow = elements.chRow
	const dlChFixed = elements.dlChFixed
	const chFixedVal = elements.chFixedVal
	const chPlannedNote = elements.chPlannedNote

	function syncDecklinkHostChannelHint() {
		const slot = selectedDecklinkSlot()
		const cm = decklinkChannelMap()
		const entry = decklinkInputForSlot(cm, slot)
		// WO-381: "planned" means the running Caspar has no such channel yet — see
		// hostChannelPendingApply. The old settings-vs-state comparison compared two builds of the
		// same saved config and stuck on "planned" whenever the state store held no channel map.
		const pending = hostChannelPendingApply(entry?.channel, stateStore.getState()?.configComparison)
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
		const sel = elements.decklinkSlotSel
		const n = parseInt(String(sel?.value || elements.decklinkLayerInput?.value || '1'), 10)
		return Number.isFinite(n) && n >= 1 ? n : 1
	}

	function syncDecklinkFromPort() {
		const layerDl = elements.decklinkLayerInput
		const slot = selectedDecklinkSlot()
		if (layerDl) layerDl.value = String(slot)
		syncDecklinkHostChannelHint()
		syncHint()
	}

	async function refreshDecklinkPorts() {
		const sel = elements.decklinkSlotSel
		const st = elements.decklinkPortStatus
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
			const text = entry?.channel != null
				? `DeckLink slot <strong>${slot}</strong> plays on dedicated channel <strong>${entry.channel}</strong> (layer ${entry.layer ?? slot}). Drag <strong>${escapeHtml(entry.label || `DeckLink ${slot}`)}</strong> from Sources → Live — do not start a second <code>DECKLINK</code> producer for the same device.`
				: 'Registers a <strong>dedicated Caspar host channel</strong> for this SDI port and adds a Live source tile. HighAsCG updates DeckLink input count in config — use <strong>Apply Caspar config</strong> in Device View when you are ready to restart and start capture.'
			hintEl.textContent = ''
			hintEl.innerHTML = text
		} else if (k === 'ndi') {
			hintEl.textContent = ''
			hintEl.innerHTML =
				'NDI plays on a <strong>dedicated host channel</strong> (allocated automatically). Drag the tile from Sources → Live onto PGM, preview, or multiview using <code>route://</code> — do not play NDI directly on program layers.'
		} else if (k === 'live_audio') {
			hintEl.textContent = ''
			hintEl.innerHTML =
				'Live audio gets a <strong>dedicated Caspar host channel</strong> (cheapest video mode, audio-only — no video consumers). ALSA capture runs once on that channel; drag <code>route://</code> from Sources → Live onto PGM or multiview for on-air.'
		} else if (k === 'usb_video') {
			hintEl.textContent = ''
			hintEl.innerHTML =
				'USB / V4L2 video gets a <strong>dedicated Caspar host channel</strong>. FFmpeg captures from the device and Caspar plays MPEG-TS via UDP; drag <code>route://</code> from Sources → Live onto PGM or multiview. Apply Caspar config when adding a new slot.'
		} else if (k === 'browser_display') {
			hintEl.textContent = ''
			hintEl.innerHTML =
				'Browser runs on a <strong>dedicated host channel</strong> (real Firefox + x11grab capture, not CEF). Drag <code>route://</code> from Sources → Live onto PGM or multiview for on-air. Use the Inspector to toggle between background and operator monitor, and to change URL/dimensions. Apply Caspar config after adding.'
		} else {
			const cg = elements.browserAsCg?.checked
			hintEl.textContent = ''
			hintEl.innerHTML = cg
				? 'CG mode: program/preview use a short <strong>highascg_browser_url</strong> template on Caspar (synced from HighAsCG <code>template/</code>) with your URL in CG data — not a persistent host channel.'
				: 'Webpage plays on a <strong>dedicated host channel</strong> with <code>LOOP</code> so state survives when taken off air. Apply Caspar config after adding, then drag <code>route://</code> onto PGM or multiview.'
		}
	}

	function syncTemplateUI() {
		const useTemplate = elements.browserUseTemplate?.checked
		if (elements.browserUrl) elements.browserUrl.style.display = useTemplate ? 'none' : 'block'
		if (elements.browserTemplate) elements.browserTemplate.style.display = useTemplate ? 'block' : 'none'
		if (elements.templateSelectLabel) elements.templateSelectLabel.style.display = useTemplate ? 'block' : 'none'
		if (useTemplate) {
			// Populate template select if not already done
			const sel = elements.browserTemplate
			if (sel && sel.children.length <= 1) {
				const templates = stateStore.getState()?.templates || []
				for (const t of templates) {
					const id = t.id || t.label || ''
					if (!id) continue
					const label = t.label || String(id)
					const opt = document.createElement('option')
					opt.value = id
					opt.textContent = label
					sel.appendChild(opt)
				}
			}
		}
	}

	function syncKind() {
		const k = kindSel?.value || 'decklink'
		if (dlWrap) dlWrap.style.display = k === 'decklink' ? 'block' : 'none'
		if (ndiWrap) ndiWrap.style.display = k === 'ndi' ? 'block' : 'none'
		if (browserDisplayWrap) browserDisplayWrap.style.display = k === 'browser_display' ? 'block' : 'none'
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
		if (k === 'browser') syncTemplateUI()
	}

	function syncLiveAudioSlotHint() {
		const el = elements.audioSlotHint
		if (!el) return
		const ui = readLiveAudioCasparSettings(settingsState.getSettings()?.casparServer || {})
		const manual = (elements.audioManual?.value || '').trim()
		const sel = elements.audioSelect
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
		const el = elements.v4l2SlotHint
		if (!el) return
		const ui = readV4l2CasparSettings(settingsState.getSettings()?.casparServer || {})
		const manual = (elements.v4l2Manual?.value || '').trim()
		const sel = elements.v4l2Select
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
		const st = elements.v4l2DiscoverStatus
		const sel = elements.v4l2Select
		const audioSel = elements.v4l2AudioSelect
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
		const st = elements.audioDiscoverStatus
		const sel = elements.audioSelect
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
	elements.decklinkSlotSel?.addEventListener('change', syncDecklinkFromPort)
	elements.browserAsCg?.addEventListener('change', syncHint)
	elements.browserUseTemplate?.addEventListener('change', syncTemplateUI)
	elements.audioRefreshBtn?.addEventListener('click', () => void refreshAudioDevices())
	elements.audioSelect?.addEventListener('change', syncLiveAudioSlotHint)
	elements.audioManual?.addEventListener('input', syncLiveAudioSlotHint)
	elements.v4l2RefreshBtn?.addEventListener('click', () => void refreshV4l2Devices())
	elements.v4l2Select?.addEventListener('change', syncV4l2SlotHint)
	elements.v4l2Manual?.addEventListener('input', syncV4l2SlotHint)
	syncKind()
	void settingsState.load().then(() => {
		syncDecklinkFromPort()
		syncKind()
	})
	if (elements.ndiAttrHost) elements.ndiAttrHost.appendChild(createNdiAttributionElement())

	elements.ndiDiscoverBtn?.addEventListener('click', async () => {
		const st = elements.ndiDiscoverStatus
		const sel = elements.ndiSelect
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

	elements.closeBtn?.addEventListener('click', close)
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})

	attachLiveInputModalSubmit({
		elements,
		getKind: () => kindSel?.value || 'decklink',
		stateStore,
		selectedDecklinkSlot,
		finishAdded,
	})
}
