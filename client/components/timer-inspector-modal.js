/**
 * Timer inspector modal (WO-226 T226.4) — opened from the per-screen timer icon
 * (scene-list-column.js). Reuses buildTimerSettings (timer-control-panel-settings-form.js) for
 * duration/mode/target-time/size/position rather than duplicating that form, and adds
 * Fade In / Fade Out buttons wired to POST /api/timers/visible {fadeFrames}.
 *
 * Modal choice: follows the existing lightweight `.modal-overlay` / `.modal-content` /
 * `.modal-header` / `.modal-body` shell (see led-test-modal.js) whose base rules already live
 * in client/styles/07b-audio-mixer-modal-shell.css — cheap to reuse, no new base CSS needed.
 */

import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { buildTimerSettings } from './timer-control-panel-settings-form.js'

const FADE_FRAMES = 25

function dispatchTimersChanged() {
	window.dispatchEvent(new CustomEvent('screen-timers-changed'))
}

/**
 * @param {{ timerId: string, screenIdx: number, screenLabel?: string }} opts
 */
export function showTimerInspectorModal(opts) {
	const { timerId, screenIdx, screenLabel: screenLbl } = opts || {}
	if (!timerId || !Number.isFinite(screenIdx)) return

	document.getElementById('timer-inspector-modal')?.remove()

	const modal = document.createElement('div')
	modal.id = 'timer-inspector-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content timer-inspector-modal">
			<div class="modal-header">
				<h2>Timer — ${escapeHtml(screenLbl || `Screen ${screenIdx + 1}`)}</h2>
				<button type="button" class="modal-close" id="timer-inspector-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body timer-inspector-modal__body">
				<div class="timer-inspector-modal__settings-wrap">
					<div class="timer-inspector-modal__settings"></div>
				</div>
				<div class="timer-inspector-modal__fade-row">
					<button type="button" class="timer-control-panel__btn" data-fade="in">Fade In</button>
					<button type="button" class="timer-control-panel__btn" data-fade="out">Fade Out</button>
				</div>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	function close() {
		modal.remove()
	}
	modal.querySelector('#timer-inspector-close').addEventListener('click', close)
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})

	const settingsEl = modal.querySelector('.timer-inspector-modal__settings')

	async function reload() {
		try {
			const res = await api.get('/api/timers/list')
			const timer = res?.ok && Array.isArray(res.timers) ? res.timers.find((t) => t.timerId === timerId) : null
			settingsEl.innerHTML = ''
			if (!timer) {
				settingsEl.innerHTML = '<p>(timer no longer assigned)</p>'
				return
			}
			buildTimerSettings(settingsEl, timer, {
				refreshTimerList: () => {
					dispatchTimersChanged()
					void reload()
				},
			})
			// buildTimerSettings is written for the corner panel, where its container starts
			// hidden and a ⚙ button toggles it; here it's the whole point of the modal, so force
			// it visible (also undoes its own Cancel handler, which hides containerEl.parentElement —
			// that's `.timer-inspector-modal__settings-wrap`, not the whole modal body, so Fade
			// buttons and the header stay usable after Cancel).
			const wrap = modal.querySelector('.timer-inspector-modal__settings-wrap')
			if (wrap) wrap.style.display = 'flex'
		} catch (err) {
			settingsEl.innerHTML = `<p>Failed to load timer: ${escapeHtml(err?.message || String(err))}</p>`
		}
	}
	void reload()

	modal.querySelectorAll('[data-fade]').forEach((btn) => {
		btn.addEventListener('click', async () => {
			const visible = btn.dataset.fade === 'in'
			btn.disabled = true
			try {
				await api.post('/api/timers/visible', { timerId, screenIdx, visible, fadeFrames: FADE_FRAMES })
				dispatchTimersChanged()
			} catch (err) {
				console.warn('[timer-inspector] fade failed:', err?.message || err)
			} finally {
				btn.disabled = false
			}
		})
	})
}
