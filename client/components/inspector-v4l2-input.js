/**
 * USB / V4L2 video input inspector — slot details + remove.
 */
import { escapeHtml } from '../lib/dom-escape.js'
import { settingsState } from '../lib/settings-state.js'
import { v4l2InputForSlot } from '../lib/input-channels.js'
import { readV4l2CasparSettings, V4L2_MAX_SLOTS } from '../lib/v4l2-inputs.js'
import { removeV4l2InputSlot } from '../lib/v4l2-remove-input.js'
import { showAppToast } from '../lib/app-toast.js'

/**
 * @param {HTMLElement} root
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ slot: number }} selection
 * @param {{ onClearSelection?: () => void }} [deps]
 */
export function renderV4l2InputInspector(root, stateStore, selection, deps = {}) {
	const slot = Math.max(1, Math.min(V4L2_MAX_SLOTS, parseInt(String(selection?.slot ?? 1), 10) || 1))
	const cm = stateStore.getState()?.channelMap || {}
	const entry = v4l2InputForSlot(cm, slot)
	const cs = settingsState.getSettings()?.casparServer || {}
	const ui = readV4l2CasparSettings(cs)
	const device = String(ui.slots?.[slot - 1] || '').trim()

	root.innerHTML = `
		<div class="inspector-section">
			<div class="inspector-section__title">USB video input</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Slot</div>
				<div class="inspector-field__value">${slot}</div>
			</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Dedicated channel</div>
				<div class="inspector-field__value">${entry?.channel != null ? `Ch ${escapeHtml(entry.channel)}` : '(after Apply Caspar config)'}</div>
			</div>
			<div class="inspector-field">
				<div class="inspector-field__label">Device</div>
				<div class="inspector-field__value">${device ? escapeHtml(device) : '— none —'}</div>
			</div>
			<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
				<button type="button" class="btn btn--danger" data-v4l2-remove>Remove</button>
			</div>
			<p class="settings-note" style="margin-top:10px">
				Clears this USB video slot. Apply Caspar config in Device View if slot count changed.
			</p>
		</div>
	`

	root.querySelector('[data-v4l2-remove]')?.addEventListener('click', async () => {
		if (!confirm(`Remove USB video slot ${slot}?`)) return
		const btn = root.querySelector('[data-v4l2-remove]')
		if (btn) btn.disabled = true
		try {
			await removeV4l2InputSlot(stateStore, slot)
			showAppToast(`USB video slot ${slot} removed.`, 'info')
			deps.onClearSelection?.()
		} catch (e) {
			showAppToast(e?.message || String(e), 'error')
			if (btn) btn.disabled = false
		}
	})
}
