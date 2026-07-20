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
 * @param {HTMLElement} root
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ slot: number }} selection
 * @param {{ onClearSelection: () => void }} deps
 */
export function renderLiveAudioInputInspector(root, stateStore, selection, deps) {
	const slot = Math.max(1, Math.min(LIVE_AUDIO_MAX_SLOTS, parseInt(String(selection?.slot ?? 1), 10) || 1))
	const cm = stateStore.getState()?.channelMap || {}
	const entry = liveAudioInputForSlot(cm, slot)
	const cs = settingsState.getSettings()?.casparServer || {}
	const ui = readLiveAudioCasparSettings(cs)
	const device = String(ui.slots?.[slot - 1] || '').trim()
	const ch = entry?.channel
	const ln = entry?.layer
	const status = stateStore.getState()?.liveAudioInputsStatus
	const statusMsg = liveAudioSlotStatusMessage(status, slot, { channel: ch, layer: ln })
	const statusClass = statusMsg
		? statusMsg.includes('PLAY failed') || statusMsg.includes('offline')
			? 'status-warn'
			: 'status-ok'
		: ''
	const statusHtml = statusMsg
		? `<div class="inspector-field">
				<div class="inspector-field__label">Status</div>
				<div class="inspector-field__value"><span class="${statusClass}">${escapeHtml(statusMsg)}</span></div>
			</div>`
		: ''

	// Initially show with current device; devices will be loaded in background
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
			${statusHtml}
			<div class="inspector-field">
				<div class="inspector-field__label">Capture device</div>
				<select id="inspector-live-audio-device-select" style="width:100%">
					<option value="${escapeHtml(device)}" selected>${device ? escapeHtml(device) : '— loading —'}</option>
				</select>
			</div>
			<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
				<button type="button" class="btn btn--secondary" data-live-audio-refresh-devices>Refresh devices</button>
				<button type="button" class="btn btn--primary" data-live-audio-start ${ch == null || ln == null ? 'disabled' : ''}>Start</button>
				<button type="button" class="btn btn--secondary" data-live-audio-stop ${ch == null || ln == null ? 'disabled' : ''}>Stop</button>
				<button type="button" class="btn btn--danger" data-live-audio-remove>Remove</button>
			</div>
					<p class="settings-note" style="margin-top:10px">
				Change the device above and it will be applied immediately. Start restarts this input's
				capture (and puts its saved PGM routes back on air); Stop kills it. Remove clears the slot
				and stops PGM routes. Use the Audio Mixer + dialog to add inputs.
			</p>
		</div>
	`

	const deviceSelect = root.querySelector('#inspector-live-audio-device-select')
	const refreshBtn = root.querySelector('[data-live-audio-refresh-devices]')
	const startBtn = root.querySelector('[data-live-audio-start]')
	const stopBtn = root.querySelector('[data-live-audio-stop]')
	const rmBtn = root.querySelector('[data-live-audio-remove]')

	// Load devices asynchronously and populate the select
	;(async () => {
		try {
			const hw = await api.get('/api/audio/devices')
			const captureDevices = Array.isArray(hw?.devices) ? hw.devices : []
			const opts = alsaCaptureDeviceOptions(captureDevices)
			let html = opts
				.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === device ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
				.join('')
			if (device && !opts.some((o) => o.value === device)) {
				html += `<option value="${escapeHtml(device)}" selected>${escapeHtml(device)} (saved)</option>`
			}
			if (deviceSelect && root.contains(deviceSelect)) {
				deviceSelect.innerHTML = html
			}
		} catch {
			// Device loading failed silently, the select will keep the initial state
		}
	})()

	if (deviceSelect) {
		deviceSelect.addEventListener('change', async () => {
			const newDevice = String(deviceSelect.value || '').trim()
			deviceSelect.disabled = true
			try {
				// Build config body with just this slot's device
				const configBody = {
					live_audio_input_count: ui.count,
					live_audio_pgm_always_on: ui.pgmAlwaysOn,
				}
				// Set all slot devices from current UI state
				for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
					configBody[`live_audio_input_${i}_device`] = i === slot ? newDevice : (ui.slots[i - 1] || '')
				}

				// POST config
				await api.post('/api/audio/live-inputs/config', configBody)

				// Apply the changes (device-only, so no restart needed)
				await api.post('/api/audio/live-inputs/apply', {})

				showAppToast('Capture re-applied on host channel.', 'success')

				// Reload settings to reflect the change
				await settingsState.load()
			} catch (e) {
				showAppToast(e?.message || String(e), 'error')
				// Revert select to old value
				deviceSelect.value = device
			} finally {
				deviceSelect.disabled = false
			}
		})
	}

	if (refreshBtn) {
		refreshBtn.addEventListener('click', async () => {
			refreshBtn.disabled = true
			try {
				const hw = await api.get('/api/audio/devices?refresh=1')
				const captureDevices = Array.isArray(hw?.devices) ? hw.devices : []
				const opts = alsaCaptureDeviceOptions(captureDevices)
				let html = opts
					.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === device ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
					.join('')
				if (device && !opts.some((o) => o.value === device)) {
					html += `<option value="${escapeHtml(device)}" selected>${escapeHtml(device)} (saved)</option>`
				}
				if (deviceSelect && root.contains(deviceSelect)) {
					deviceSelect.innerHTML = html
				}
				showAppToast('Device list updated.', 'info')
			} catch (e) {
				showAppToast(e?.message || String(e), 'error')
			} finally {
				refreshBtn.disabled = false
			}
		})
	}

	// The counterpart of Stop, in the same place: restart THIS slot's capture only, then put its
	// saved PGM routes back on air. Never re-applies the whole rig (that glitches inputs on air).
	if (startBtn) {
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
						route: entry?.route || null,
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
	}

	if (stopBtn) {
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
	}

	if (rmBtn) {
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
	}
}
