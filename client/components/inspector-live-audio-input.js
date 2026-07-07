import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { liveAudioInputForSlot } from '../lib/input-channels.js'
import { readLiveAudioCasparSettings, LIVE_AUDIO_MAX_SLOTS } from '../lib/live-audio-inputs.js'
import { removeLiveAudioInputSlot } from '../lib/live-audio-remove-input.js'
import { escapeHtml } from '../lib/dom-escape.js'

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
			<div class="inspector-field">
				<div class="inspector-field__label">Device</div>
				<div class="inspector-field__value">${device ? escapeHtml(device) : '— none —'}</div>
			</div>
			<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
				<button type="button" class="btn btn--secondary" data-live-audio-stop ${ch == null || ln == null ? 'disabled' : ''}>Stop</button>
				<button type="button" class="btn btn--danger" data-live-audio-remove>Remove</button>
			</div>
					<p class="settings-note" style="margin-top:10px">
				Remove clears the slot and stops PGM routes. Use the Audio Mixer + dialog to add inputs.
			</p>
		</div>
	`

	const stopBtn = root.querySelector('[data-live-audio-stop]')
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

	const rmBtn = root.querySelector('[data-live-audio-remove]')
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
