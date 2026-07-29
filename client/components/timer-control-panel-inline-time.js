/**
 * Timer control panel — click-to-set time on the compact dock's live display (WO-381).
 *
 * Owner 2026-07-29: "in the small compact timers at the bottom right there should be a way to set
 * time". The dock is a live controller, so the time itself is the control: click the readout, type
 * a duration (`90`, `5:00`, `01:30:00`), Enter to commit. In clock mode the same box edits the
 * target wall-clock time instead of a duration.
 *
 * Saving goes through POST /api/timers/assign (screen-timers.js merges `config` and emits the CG
 * UPDATE) once per assigned screen — every screen showing the timer needs its own UPDATE, and the
 * settings form's "first screen only" write left the others on the old value.
 */

import { api } from '../lib/api-client.js'

/**
 * Parse an entered time. Accepts `SS`, `MM:SS` and `HH:MM:SS` (minutes/seconds are not clamped to
 * 59 — `90:00` is a legitimate 90-minute duration).
 * @param {string} text
 * @returns {number | null} total seconds, or null when unparseable
 */
export function parseTimeText(text) {
	const raw = String(text ?? '').trim()
	if (!raw || !/^\d{1,3}(:\d{1,2}){0,2}$/.test(raw)) return null
	const parts = raw.split(':').map((p) => parseInt(p, 10) || 0)
	const [h, m, s] = parts.length === 3 ? parts : parts.length === 2 ? [0, parts[0], parts[1]] : [0, 0, parts[0]]
	const total = h * 3600 + m * 60 + s
	return Number.isFinite(total) && total >= 0 ? total : null
}

/** Seconds → `HH:MM:SS`, the shape the countdown template's `targetTime` expects. */
export function secondsToClockText(totalSeconds) {
	const n = Math.max(0, Math.floor(totalSeconds || 0)) % 86400
	const pad = (x) => String(x).padStart(2, '0')
	return `${pad(Math.floor(n / 3600))}:${pad(Math.floor((n % 3600) / 60))}:${pad(n % 60)}`
}

/**
 * The config patch an entered time means for this timer's mode.
 * @param {object} timer — /api/timers/list record
 * @param {number} seconds
 */
export function timeConfigPatch(timer, seconds) {
	const mode = timer?.config?.mode || 'duration'
	return mode === 'clock' ? { targetTime: secondsToClockText(seconds) } : { durationSec: Math.max(0, Math.floor(seconds)) }
}

/**
 * Push a config patch to every screen the timer is assigned to.
 * @param {object} timer
 * @param {object} patch
 */
export async function saveTimerConfigPatch(timer, patch) {
	const screenIndices = Object.keys(timer?.screens || {})
		.map((k) => parseInt(k, 10))
		.filter((n) => Number.isFinite(n))
	if (!screenIndices.length) throw new Error('timer is not assigned to a screen')
	const config = { ...(timer.config || {}), ...patch }
	for (const screenIdx of screenIndices) {
		await api.post('/api/timers/assign', { timerId: timer.timerId, screenIdx, config })
	}
}

/**
 * Make a timer readout click-to-edit in place. The tick loop skips elements marked
 * `data-editing="1"`, so a running timer does not overwrite what is being typed.
 * @param {HTMLElement} displayEl — the monospace readout
 * @param {object} timer
 * @param {{ onSaved?: () => void }} [deps]
 * @returns {HTMLInputElement} the (hidden) editor input, already inserted after `displayEl`
 */
export function attachInlineTimeEditor(displayEl, timer, deps = {}) {
	const { onSaved } = deps
	const assigned = Object.keys(timer?.screens || {}).length > 0
	const isClock = (timer?.config?.mode || 'duration') === 'clock'

	const input = document.createElement('input')
	input.type = 'text'
	input.className = 'timer-control-panel__timer-input'
	input.inputMode = 'numeric'
	input.hidden = true
	input.setAttribute('aria-label', isClock ? 'Target time (HH:MM:SS)' : 'Duration (HH:MM:SS)')
	displayEl.insertAdjacentElement('afterend', input)

	if (!assigned) {
		displayEl.title = 'Assign this timer to a screen to set its time'
		return input
	}

	displayEl.classList.add('timer-control-panel__timer-display--editable')
	displayEl.title = isClock ? 'Click to set the target time (HH:MM:SS)' : 'Click to set the duration (MM:SS or HH:MM:SS)'

	function stopEditing() {
		input.hidden = true
		displayEl.hidden = false
		delete displayEl.dataset.editing
	}

	displayEl.addEventListener('click', () => {
		displayEl.dataset.editing = '1'
		input.value = isClock ? timer.config?.targetTime || displayEl.textContent : displayEl.textContent
		displayEl.hidden = true
		input.hidden = false
		input.focus()
		input.select()
	})

	async function commit() {
		const seconds = parseTimeText(input.value)
		if (seconds == null) {
			stopEditing()
			return
		}
		stopEditing()
		try {
			await saveTimerConfigPatch(timer, timeConfigPatch(timer, seconds))
			onSaved?.()
		} catch (err) {
			console.warn('[timer-panel] set time failed:', err?.message || err)
		}
	}

	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			void commit()
		} else if (e.key === 'Escape') {
			e.preventDefault()
			stopEditing()
		}
	})
	input.addEventListener('blur', () => {
		if (!input.hidden) void commit()
	})

	return input
}
