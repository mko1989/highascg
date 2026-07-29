/**
 * Timer control panel — the time input in each compact dock row (WO-381).
 *
 * Owner 2026-07-29: "there should be time inputs for the timer in the compact timers menu" — a
 * standing input box per timer, not a click-to-reveal editor. Type `90`, `5:00` or `01:30:00`;
 * Enter or blur commits, Escape restores. In clock mode the box sets the target wall-clock time
 * instead of a duration. The live readout beside it keeps ticking and is never typed into.
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

/** The value a timer's input shows: its configured duration, or its target time in clock mode. */
export function timeInputValue(timer) {
	const config = timer?.config || {}
	if ((config.mode || 'duration') === 'clock') return config.targetTime || '00:00:00'
	return secondsToClockText(config.durationSec || 0)
}

/**
 * Build the labelled time input for one timer row. Unassigned timers get a disabled box (the
 * assign API needs a screen), so the control is always present and never lies about being usable.
 * @param {object} timer — /api/timers/list record
 * @param {{ onSaved?: () => void }} [deps]
 * @returns {HTMLElement} the row to append (label + input)
 */
export function createTimerTimeInput(timer, deps = {}) {
	const { onSaved } = deps
	const isClock = (timer?.config?.mode || 'duration') === 'clock'
	const assigned = Object.keys(timer?.screens || {}).length > 0

	const wrap = document.createElement('label')
	wrap.className = 'timer-control-panel__time-row'

	const labelEl = document.createElement('span')
	labelEl.className = 'timer-control-panel__time-label'
	labelEl.textContent = isClock ? 'Target' : 'Time'
	wrap.appendChild(labelEl)

	const input = document.createElement('input')
	input.type = 'text'
	input.className = 'timer-control-panel__timer-input'
	input.inputMode = 'numeric'
	input.placeholder = 'HH:MM:SS'
	input.value = timeInputValue(timer)
	input.dataset.timerId = timer.timerId
	input.setAttribute('aria-label', isClock ? 'Target time (HH:MM:SS)' : 'Duration (HH:MM:SS)')
	input.title = isClock ? 'Target time — HH:MM:SS' : 'Duration — MM:SS or HH:MM:SS'
	if (!assigned) {
		input.disabled = true
		input.title = 'Assign this timer to a screen to set its time'
	}
	wrap.appendChild(input)

	async function commit() {
		const seconds = parseTimeText(input.value)
		if (seconds == null) {
			input.value = timeInputValue(timer) // unparseable — put the stored value back
			return
		}
		const patch = timeConfigPatch(timer, seconds)
		input.value = isClock ? patch.targetTime : secondsToClockText(patch.durationSec)
		if (input.value === timeInputValue(timer)) return // nothing changed — no CG UPDATE
		try {
			await saveTimerConfigPatch(timer, patch)
			onSaved?.()
		} catch (err) {
			console.warn('[timer-panel] set time failed:', err?.message || err)
		}
	}

	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			input.blur() // blur commits
		} else if (e.key === 'Escape') {
			e.preventDefault()
			input.value = timeInputValue(timer)
			input.blur()
		}
	})
	input.addEventListener('blur', () => void commit())

	return wrap
}
