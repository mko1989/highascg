import { api } from '../lib/api-client.js'

/**
 * WO-226 T226.3: per-screen timer icon next to the FTB button. A module-level cache (shared
 * across every column) avoids one /api/timers/list fetch per column per render — the deck
 * tears down and rebuilds all columns on most sceneState changes, so per-column fetches would
 * multiply fast. The cache is populated once lazily and refreshed on the lightweight
 * 'screen-timers-changed' event that the drop-assign path (scenes-editor-deck-drop.js), the
 * timer inspector modal, and the compact transport (audio-mixer-panel.js) all dispatch after a
 * successful POST.
 */
let _timersCache = []
let _timersCacheLoaded = false
let _timersFetchPromise = null
let _timersListenerBound = false

function _timerStateForScreen(screenIdx) {
	// Multi-timer aware (up to 10 per screen, layer band 980-989): the icon is "on" when ANY
	// timer on this screen is on air.
	let found = null
	for (const t of _timersCache) {
		const entry = t?.screens?.[String(screenIdx)]
		if (!entry) continue
		if (!found) found = { count: 0, visible: false }
		found.count++
		if (entry.visible) found.visible = true
	}
	return found
}

export function applyTimerButtonState(btn, screenIdx) {
	const state = _timerStateForScreen(screenIdx)
	btn.hidden = false
	if (!state) {
		// Always visible: with no timer assigned the icon is dimmed — clicking selects this
		// screen's timers in the Inspector, where "+ Add timer" lives.
		btn.classList.remove('scenes-btn--timer-on')
		btn.classList.add('scenes-btn--timer-unassigned')
		btn.title = 'Timers for this screen (none yet) — click to add in Inspector'
		return
	}
	btn.classList.remove('scenes-btn--timer-unassigned')
	btn.classList.toggle('scenes-btn--timer-on', state.visible)
	const n = state.count > 1 ? `${state.count} timers` : 'Timer'
	btn.title = state.visible ? `${n} on air — click for settings` : `${n} assigned (hidden) — click for settings`
}

export function refreshAllTimerButtons() {
	document.querySelectorAll('.scenes-deck-col__timer-btn').forEach((btn) => {
		const idx = parseInt(btn.dataset.screenIdx, 10)
		if (Number.isFinite(idx)) applyTimerButtonState(btn, idx)
	})
}

export function fetchTimersCache() {
	if (_timersFetchPromise) return _timersFetchPromise
	_timersFetchPromise = api
		.get('/api/timers/list')
		.then((res) => {
			if (res?.ok && Array.isArray(res.timers)) _timersCache = res.timers
			_timersCacheLoaded = true
		})
		.catch(() => {
			/* leave cache as-is; a later event will retry */
		})
		.finally(() => {
			_timersFetchPromise = null
		})
	return _timersFetchPromise
}

export function isTimersCacheLoaded() {
	return _timersCacheLoaded
}

export function ensureTimersListener() {
	if (_timersListenerBound) return
	_timersListenerBound = true
	window.addEventListener('screen-timers-changed', () => {
		fetchTimersCache().then(refreshAllTimerButtons)
	})
}
