/**
 * GUI surfacing for failed DeckLink input sources (2026-07-19 follow-up).
 *
 * The server retries failed input PLAYs every ~20s (routing-setup.js) and reports them in
 * `state.decklinkInputsStatus.failed`. This watcher toasts only on TRANSITIONS — a device
 * appearing in `failed` (warn, once) and a previously-failed device recovering (success) —
 * so the periodic retries never spam the operator.
 */

import { showAppToast } from './app-toast.js'

/** @type {Set<number>} devices currently known-failed (for transition detection) */
const known = new Set()
let primed = false

/**
 * @param {{ on: (key: string, cb: () => void) => void, getState: () => any }} stateStore
 */
export function initDecklinkInputToasts(stateStore) {
	// WS full-state pushes (the main feed, includes decklinkInputsStatus via getState) emit
	// only '*'; the sources panel's live-tab refresh emits the keyed change. Cover both —
	// the transition check below is cheap and no-ops when nothing changed.
	stateStore.on('*', check)
	stateStore.on('decklinkInputsStatus', check)

	function check() {
		const st = stateStore.getState?.()?.decklinkInputsStatus
		if (!st || st.enabled === false) return
		const failed = Array.isArray(st.failed) ? st.failed : []
		const now = new Set(failed.map((f) => Number(f.device)))
		if (!primed) {
			// First status after page load: report existing failures once, never "recoveries".
			primed = true
			for (const f of failed) {
				known.add(Number(f.device))
				showAppToast(`${f.message || `DeckLink ${f.device} input unavailable`} — retrying`, 'warn', 8000)
			}
			return
		}
		for (const f of failed) {
			const dev = Number(f.device)
			if (!known.has(dev)) {
				known.add(dev)
				showAppToast(`${f.message || `DeckLink ${dev} input unavailable`} — retrying`, 'warn', 8000)
			}
		}
		for (const dev of [...known]) {
			if (!now.has(dev)) {
				known.delete(dev)
				showAppToast(`DeckLink ${dev} input is back`, 'success')
			}
		}
	}
}

/* WO-360: same transition-toast contract for live-audio (ALSA) and V4L2 input bring-alive
 * failures — the statuses already ride getState (`liveAudioInputsStatus`/`v4l2InputsStatus`);
 * nothing surfaced them. Keyed per slot; failures toast once, recoveries toast success. */
const knownBySource = { audio: new Set(), v4l2: new Set() }
let livePrimed = false

export function initLiveInputFailureToasts(stateStore) {
	stateStore.on('*', checkLive)
	stateStore.on('liveAudioInputsStatus', checkLive)
	stateStore.on('v4l2InputsStatus', checkLive)

	function checkOne(kind, st, label) {
		if (!st || st.enabled === false) return
		const failed = Array.isArray(st.failed) ? st.failed : []
		const now = new Set(failed.map((f) => String(f.slot ?? f.device ?? f.channel)))
		const known = knownBySource[kind]
		for (const f of failed) {
			const key = String(f.slot ?? f.device ?? f.channel)
			if (!known.has(key)) {
				known.add(key)
				/* Failures toast even on the priming pass — an input that is ALREADY dead when
				 * the page opens is exactly what the operator must hear about. */
				showAppToast(`⚠ ${label} ${key} failed to start: ${f.message || 'unknown'} (${f.clip || ''})`, 'error', 10000)
			}
		}
		for (const key of [...known]) {
			if (!now.has(key)) {
				known.delete(key)
				if (livePrimed) showAppToast(`${label} ${key} recovered`, 'success', 5000)
			}
		}
	}

	function checkLive() {
		const st = stateStore.getState?.() || {}
		checkOne('audio', st.liveAudioInputsStatus, 'Live audio input')
		checkOne('v4l2', st.v4l2InputsStatus, 'V4L2 input')
		livePrimed = true
	}
}
