/**
 * Shared create/assign flow for screen countdown timers — single home for the
 * "new timer" POST /api/timers/assign path previously duplicated across
 * audio-mixer-panel.js, inspector-screen-timer.js, timer-control-panel.js and
 * scenes-editor-deck-drop.js.
 */

import { api } from './api-client.js'
import { DEFAULT_TIMER_CONFIG } from '../components/timer-control-panel-display.js'

/** Fallback covers non-secure contexts where crypto.randomUUID is unavailable. */
export function newTimerId() {
	return typeof crypto?.randomUUID === 'function'
		? crypto.randomUUID()
		: `timer-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export function dispatchTimersChanged() {
	window.dispatchEvent(new CustomEvent('screen-timers-changed'))
}

/**
 * Create (or re-assign) a timer on a screen. Throws when the API reports failure; on
 * success dispatches 'screen-timers-changed' unless `notify` is false (timer-control-panel
 * refreshes via its own list reload instead of the event).
 * @param {{ timerId?: string, name?: string, config?: object, screenIdx: number, notify?: boolean }} opts
 */
export async function createTimerForScreen({
	timerId = newTimerId(),
	name,
	config = { ...DEFAULT_TIMER_CONFIG },
	screenIdx,
	notify = true,
}) {
	const res = await api.post('/api/timers/assign', { timerId, name, config, screenIdx })
	if (!res?.ok) throw new Error(res?.error || 'assign failed')
	if (notify) dispatchTimersChanged()
	return res
}
