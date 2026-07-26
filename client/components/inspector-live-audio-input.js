import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { liveAudioInputForSlot } from '../lib/input-channels.js'
import {
	readLiveAudioCasparSettings,
	LIVE_AUDIO_MAX_SLOTS,
	alsaCaptureDeviceOptions,
	liveAudioSlotStatusMessage,
} from '../lib/live-audio-inputs.js'
import { removeLiveAudioInputSlot } from '../lib/live-audio-remove-input.js'
import { runInputStart } from '../lib/live-input-start.js'
import { getMultiPlayTargets, inputTargetKey } from '../lib/live-audio-play-targets.js'
import { playRouteOnChannel } from '../lib/live-audio-routing.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { showAppToast } from '../lib/app-toast.js'

/**
 * WO-336: the full per-slot control block (status, capture device, shader-FFT source,
 * Refresh/Start/Stop), mountable from BOTH the audio-mixer slot inspector below and the
 * device-view host-channel inspector. Remove stays caller-side — each context has its own.
 *
 * @param {HTMLElement} host container to append into
 * @param {{ slot: number, channel?: number|null, layer?: number|null, route?: string|null,
 *           status?: object|null }} opts `status` = liveAudioInputsStatus snapshot if the
 *           caller has one; omitted → fetched from /api/audio/live-inputs.
 * @returns {{ wrap: HTMLElement, buttonsRow: HTMLElement }}
 */
export function mountLiveAudioSlotControls(host, opts) {
	const slot = Math.max(1, Math.min(LIVE_AUDIO_MAX_SLOTS, parseInt(String(opts?.slot ?? 1), 10) || 1))
	const ch = opts?.channel ?? null
	const ln = opts?.layer ?? null
	const cs = settingsState.getSettings()?.casparServer || {}
	const ui = readLiveAudioCasparSettings(cs)
	const device = String(ui.slots?.[slot - 1] || '').trim()
	// WO-333b: which slot currently feeds the shader-FFT tee (0 = none, single-select).
	const fftSourceSlot = parseInt(String(cs.audio_fft_source_slot ?? 0), 10) || 0

	const wrap = document.createElement('div')
	wrap.innerHTML = `
		<div class="inspector-field" data-live-audio-status style="display:none">
			<div class="inspector-field__label">Status</div>
			<div class="inspector-field__value"><span></span></div>
		</div>
		<div class="inspector-field">
			<div class="inspector-field__label">Capture device</div>
			<select data-live-audio-device-select style="width:100%">
				<option value="${escapeHtml(device)}" selected>${device ? escapeHtml(device) : '— loading —'}</option>
			</select>
		</div>
		<div class="inspector-field">
			<div class="inspector-field__label">Shader FFT source</div>
			<div class="inspector-field__value">
				<label style="display:flex;align-items:center;gap:6px;cursor:pointer">
					<input type="checkbox" data-live-audio-fft-source ${fftSourceSlot === slot ? 'checked' : ''}>
					<span>Feed audio-reactive shaders${fftSourceSlot > 0 && fftSourceSlot !== slot ? ` (now: slot ${fftSourceSlot})` : ''}</span>
				</label>
			</div>
		</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" data-live-audio-buttons>
			<button type="button" class="btn btn--secondary" data-live-audio-refresh-devices>Refresh devices</button>
			<button type="button" class="btn btn--primary" data-live-audio-start ${ch == null || ln == null ? 'disabled' : ''}>Start</button>
			<button type="button" class="btn btn--secondary" data-live-audio-stop ${ch == null || ln == null ? 'disabled' : ''}>Stop</button>
		</div>
		<p class="settings-note" style="margin-top:10px">
			Change the device above and it is applied immediately. Start restarts this input's
			capture only (and puts its saved PGM routes back on air); Stop kills it. Remove clears
			the slot and stops PGM routes. Use the Audio Mixer + dialog to add inputs.
		</p>
	`
	host.append(wrap)

	const statusField = wrap.querySelector('[data-live-audio-status]')
	const deviceSelect = wrap.querySelector('[data-live-audio-device-select]')
	const refreshBtn = wrap.querySelector('[data-live-audio-refresh-devices]')
	const startBtn = wrap.querySelector('[data-live-audio-start]')
	const stopBtn = wrap.querySelector('[data-live-audio-stop]')
	const fftToggle = wrap.querySelector('[data-live-audio-fft-source]')
	const buttonsRow = wrap.querySelector('[data-live-audio-buttons]')

	function showStatus(status) {
		const msg = liveAudioSlotStatusMessage(status, slot, { channel: ch, layer: ln })
		if (!msg || !statusField) return
		const span = statusField.querySelector('span')
		span.className = msg.includes('PLAY failed') || msg.includes('offline') ? 'status-warn' : 'status-ok'
		span.textContent = msg
		statusField.style.display = ''
	}
	if (opts?.status) {
		showStatus(opts.status)
	} else {
		;(async () => {
			try {
				const r = await api.get('/api/audio/live-inputs')
				if (wrap.isConnected) showStatus(r?.status || null)
			} catch {
				/* status line stays hidden */
			}
		})()
	}

	function fillDeviceOptions(captureDevices) {
		const opts_ = alsaCaptureDeviceOptions(Array.isArray(captureDevices) ? captureDevices : [])
		let html = opts_
			.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === device ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
			.join('')
		if (device && !opts_.some((o) => o.value === device)) {
			html += `<option value="${escapeHtml(device)}" selected>${escapeHtml(device)} (saved)</option>`
		}
		if (deviceSelect && wrap.contains(deviceSelect)) deviceSelect.innerHTML = html
	}

	;(async () => {
		try {
			const hw = await api.get('/api/audio/devices')
			fillDeviceOptions(hw?.devices)
		} catch {
			/* device loading failed silently, the select keeps the initial state */
		}
	})()

	// WO-333b: route THIS slot's capture as the shader-FFT source (or clear it). The server
	// restarts the FFT listener and this slot's bridge (with the PCM tee) on apply — live
	// immediately, single-select across slots by design.
	fftToggle.addEventListener('change', async () => {
		const on = fftToggle.checked
		fftToggle.disabled = true
		try {
			await api.post('/api/audio/live-inputs/config', { audio_fft_source_slot: on ? slot : 0 })
			await api.post('/api/audio/live-inputs/apply', {})
			showAppToast(on ? `Shaders now react to slot ${slot} audio.` : 'Shader FFT source cleared.', 'success')
			await settingsState.load()
		} catch (e) {
			showAppToast(e?.message || String(e), 'error')
			fftToggle.checked = !on
		} finally {
			fftToggle.disabled = false
		}
	})

	deviceSelect.addEventListener('change', async () => {
		const newDevice = String(deviceSelect.value || '').trim()
		deviceSelect.disabled = true
		try {
			const configBody = {
				live_audio_input_count: ui.count,
				live_audio_pgm_always_on: ui.pgmAlwaysOn,
			}
			for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
				configBody[`live_audio_input_${i}_device`] = i === slot ? newDevice : (ui.slots[i - 1] || '')
			}
			await api.post('/api/audio/live-inputs/config', configBody)
			await api.post('/api/audio/live-inputs/apply', {})
			showAppToast('Capture re-applied on host channel.', 'success')
			await settingsState.load()
		} catch (e) {
			showAppToast(e?.message || String(e), 'error')
			deviceSelect.value = device
		} finally {
			deviceSelect.disabled = false
		}
	})

	refreshBtn.addEventListener('click', async () => {
		refreshBtn.disabled = true
		try {
			const hw = await api.get('/api/audio/devices?refresh=1')
			fillDeviceOptions(hw?.devices)
			showAppToast('Device list updated.', 'info')
		} catch (e) {
			showAppToast(e?.message || String(e), 'error')
		} finally {
			refreshBtn.disabled = false
		}
	})

	// The counterpart of Stop, in the same place: restart THIS slot's capture only, then put its
	// saved PGM routes back on air. Never re-applies the whole rig (that glitches inputs on air).
	startBtn.addEventListener('click', async () => {
		if (ch == null || ln == null) return
		if (startBtn.dataset.busy === '1') return
		startBtn.dataset.busy = '1'
		startBtn.disabled = true
		try {
			await runInputStart(
				{ inputKind: 'live_audio', slot },
				{
					post: (p, b) => api.post(p, b),
					targets: getMultiPlayTargets(inputTargetKey('live_audio', slot)),
					playRoute: playRouteOnChannel,
					route: opts?.route || null,
					audioOnly: ui.pgmAudioOnly !== false,
				},
			)
			showAppToast('Capture started on the dedicated channel.', 'success')
		} catch (e) {
			showAppToast(e?.message || String(e), 'error')
		} finally {
			startBtn.dataset.busy = '0'
			startBtn.disabled = false
		}
	})

	stopBtn.addEventListener('click', async () => {
		if (ch == null || ln == null) return
		stopBtn.disabled = true
		try {
			const cl = `${ch}-${ln}`
			await api.post('/api/raw', { cmd: `STOP ${cl}` }).catch(() => {})
			await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` }).catch(() => {})
		} finally {
			stopBtn.disabled = false
		}
	})

	return { wrap, buttonsRow }
}

/**
 * Audio-mixer slot inspector (reached via the mixer strips' `live-audio-input-select` event).
 * @param {HTMLElement} root
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ slot: number }} selection
 * @param {{ onClearSelection: () => void }} deps
 */
export function renderLiveAudioInputInspector(root, stateStore, selection, deps) {
	const slot = Math.max(1, Math.min(LIVE_AUDIO_MAX_SLOTS, parseInt(String(selection?.slot ?? 1), 10) || 1))
	const cm = stateStore.getState()?.channelMap || {}
	const entry = liveAudioInputForSlot(cm, slot)
	const ch = entry?.channel
	const ln = entry?.layer

	root.innerHTML = `
		<div class="inspector-section">
			<div class="inspector-section__title">Live audio input</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Slot</div>
				<div class="inspector-field__value">${slot}</div>
			</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Dedicated channel</div>
				<div class="inspector-field__value">${ch != null ? `Ch ${escapeHtml(ch)}` : '(not allocated — restart Caspar after Apply)'}</div>
			</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Layer</div>
				<div class="inspector-field__value">${ln != null ? `L${escapeHtml(ln)}` : '—'}</div>
			</div>
		</div>
	`
	const section = root.querySelector('.inspector-section')
	const { buttonsRow } = mountLiveAudioSlotControls(section, {
		slot,
		channel: ch ?? null,
		layer: ln ?? null,
		route: entry?.route || null,
		status: stateStore.getState()?.liveAudioInputsStatus || null,
	})

	const rmBtn = document.createElement('button')
	rmBtn.type = 'button'
	rmBtn.className = 'btn btn--danger'
	rmBtn.textContent = 'Remove'
	rmBtn.addEventListener('click', async () => {
		if (!confirm(`Remove live audio slot ${slot}?`)) return
		rmBtn.disabled = true
		try {
			await removeLiveAudioInputSlot(stateStore, slot)
			deps?.onClearSelection?.()
		} catch (e) {
			alert(e?.message || String(e))
		} finally {
			rmBtn.disabled = false
		}
	})
	buttonsRow.append(rmBtn)
}
