/**
 * Timer control panel — collapsible bottom-right controller (WO-186, WO-192, WO-205, WO-210).
 *
 * Fixed/docked bottom-right next to the program audio mixer. Provides:
 * - Collapsible header (persists collapsed state in localStorage)
 * - List of all screen timers from /api/timers/list (polled ~1s while open)
 * - Per-timer row: name, remaining-time display (computed client-side from lastCmd/cmdAt/config),
 *   start/pause/reset buttons, and per-screen chips with visible toggles
 * - Unassign button (×) per chip with confirmation
 * - Live time display that MIRRORS timer state (ticks 4×/s locally) and is click-to-edit
 *   (timer-control-panel-inline-time.js)
 *
 * WO-381 (owner 2026-07-29: "the adding of the timers shouldnt be there at all"): this dock is a
 * LIVE CONTROLLER only. Creating timers and assigning them to screens live in the screen-timer
 * Inspector (⏱ in the looks deck → inspector-screen-timer.js); the create button and the per-timer
 * screen-assignment dropdown were removed from here.
 *
 * WO-210 T210.6:
 * - Source of truth: GET /api/timers/list (poll ~1s while open)
 * - Per-timer display computed from {lastCmd, cmdAt, config} using computeDisplayTime
 * - Transport buttons: POST /api/timers/cmd {timerId, cmd: start|pause|reset}
 * - Per-screen chips with visible toggle: POST /api/timers/visible {timerId, screenIdx, visible}
 * - Unassign chip affordance (×) with confirm(): POST /api/timers/unassign {timerId, screenIdx}
 * - Setting the time: POST /api/timers/assign {timerId, screenIdx, config} per assigned screen
 * - getScreenTimersSnapshot() exported for T210.8 (look-save integration)
 */

import { api } from '../lib/api-client.js'
import { escapeAttr } from '../lib/dom-escape.js'
import { screenLabel } from '../lib/screen-label.js'
import { computeDisplayTime, formatDisplayTime } from './timer-control-panel-display.js'
import { attachInlineTimeEditor } from './timer-control-panel-inline-time.js'
import { buildTimerSettings } from './timer-control-panel-settings-form.js'

const LS_COLLAPSED = 'highascg_timer_panel_collapsed'
const POLL_INTERVAL_MS = 1000 // ~1s (was 5s for old countdown polling)
const TICK_INTERVAL_MS = 250 // 4×/s

/**
 * Module-level reference to the last fetched timers list and their visibility state.
 * Used by T210.8 (getScreenTimersSnapshot) for look-save integration.
 */
let lastTimersList = []
let screenTimersSnapshot = {}

/**
 * Get a snapshot of current timer visibility for a look.
 * T210.8: Called when saving a look to snapshot timersVisibility state.
 * Returns the FLAT `{ [timerId]: boolean }` shape that the server's
 * `linesForLookVisibility` (src/engine/screen-timers.js) consumes at take time —
 * a timer counts as visible for the look when it is visible on ANY target screen.
 * @param {object} [scene] — the look being saved (used by the app.js wrapper to derive screens)
 * @param {Array<number>} [screenIndices] — explicit target screen indices
 * @returns {object | null} { [timerId]: boolean } or null if no timers fetched/assigned
 */
export function getScreenTimersSnapshot(scene, screenIndices) {
	if (lastTimersList.length === 0) return null

	const targets =
		Array.isArray(screenIndices) && screenIndices.length > 0 ? new Set(screenIndices.map(Number)) : null

	const snapshot = {}
	for (const timer of lastTimersList) {
		if (!timer.timerId || !timer.screens) continue
		for (const [screenIdxStr, screenEntry] of Object.entries(timer.screens)) {
			const screenIdx = parseInt(screenIdxStr, 10)
			if (targets && !targets.has(screenIdx)) continue
			if (!(timer.timerId in snapshot)) snapshot[timer.timerId] = false
			if (screenEntry.visible) snapshot[timer.timerId] = true
		}
	}

	return Object.keys(snapshot).length > 0 ? snapshot : null
}

/**
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {HTMLElement} mountEl
 * @param {object} [opts]
 * @param {object} [opts.getChannelMap] - function to get channel map for screen count
 */
export function initTimerControlPanel(stateStore, mountEl, opts = {}) {
	if (!mountEl) return
	const { getChannelMap } = opts

	const root = document.createElement('div')
	root.className = 'timer-control-panel timer-control-panel--collapsed'
	const helpText = 'Screen timers (WO-210): panel-owned, never destroyed, assigned to screens via visible toggle'
	const displayTooltip = 'Live timer display. Ticks from server; start/pause/reset commands fan out to all assigned screens'
	root.innerHTML = `
		<button type="button" class="timer-control-panel__toggle" aria-expanded="false" title="${escapeAttr(helpText)}">
			<span class="timer-control-panel__chevron" aria-hidden="true">▶</span>
			<span class="timer-control-panel__label">Timers</span>
		</button>
		<div class="timer-control-panel__content" hidden>
			<div class="timer-control-panel__list" id="timer-list"></div>
		</div>
	`
	mountEl.appendChild(root)

	const toggle = root.querySelector('.timer-control-panel__toggle')
	const chevron = root.querySelector('.timer-control-panel__chevron')
	const content = root.querySelector('.timer-control-panel__content')
	const listContainer = root.querySelector('#timer-list')

	let isCollapsed = true
	let tickTimer = null
	let pollTimer = null

	// Load collapsed state from localStorage
	try {
		const v = localStorage.getItem(LS_COLLAPSED)
		if (v === '0') isCollapsed = false
		else if (v === '1') isCollapsed = true
	} catch {
		/* ignore */
	}

	function applyCollapsed(collapsed) {
		isCollapsed = !!collapsed
		content.hidden = isCollapsed
		toggle.setAttribute('aria-expanded', !isCollapsed ? 'true' : 'false')
		if (chevron) chevron.textContent = isCollapsed ? '▶' : '▼'
		root.classList.toggle('timer-control-panel--collapsed', isCollapsed)

		if (!isCollapsed) {
			startTick()
			startPoll()
			refreshTimerList()
		} else {
			stopTick()
			stopPoll()
		}

		try {
			localStorage.setItem(LS_COLLAPSED, isCollapsed ? '1' : '0')
		} catch {
			/* ignore */
		}
	}

	applyCollapsed(isCollapsed)

	toggle.addEventListener('click', () => applyCollapsed(!isCollapsed))

	async function refreshTimerList() {
		try {
			const res = await api.get('/api/timers/list')
			if (res?.ok && Array.isArray(res.timers)) {
				lastTimersList = res.timers
				screenTimersSnapshot = {}
				// Build visibility snapshot for T210.8
				for (const timer of lastTimersList) {
					if (timer.timerId && timer.screens) {
						for (const [screenIdxStr, entry] of Object.entries(timer.screens)) {
							if (!screenTimersSnapshot[timer.timerId]) screenTimersSnapshot[timer.timerId] = {}
							screenTimersSnapshot[timer.timerId][parseInt(screenIdxStr, 10)] = entry.visible ? 1 : 0
						}
					}
				}
				updateTimerRows()
				root.style.display = lastTimersList.length > 0 ? '' : 'none'
			}
		} catch (err) {
			console.warn('[timer-panel] refresh failed:', err?.message || err)
		}
	}

	function updateTimerRows() {
		listContainer.innerHTML = ''
		if (lastTimersList.length === 0) {
			listContainer.innerHTML = '<p style="padding:8px;color:var(--color-text-muted);font-size:0.9em;">(no timers assigned)</p>'
			return
		}

		for (const timer of lastTimersList) {
			const timerEl = document.createElement('div')
			timerEl.className = 'timer-control-panel__timer-row'
			timerEl.dataset.timerId = timer.timerId
			timerEl.style.cssText = 'border:1px solid var(--color-border);border-radius:4px;padding:8px;margin-bottom:8px;background:var(--color-bg-secondary)'

			const headerEl = document.createElement('div')
			headerEl.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px'

			// Timer name
			const nameEl = document.createElement('div')
			nameEl.style.cssText = 'font-weight:500;flex:1;min-width:100px'
			nameEl.textContent = timer.name || `Timer ${timer.timerId.slice(0, 8)}`
			headerEl.appendChild(nameEl)

			// Remaining time display
			const remaining = computeDisplayTime(timer)
			const displayEl = document.createElement('div')
			displayEl.className = 'timer-control-panel__timer-display'
			displayEl.style.cssText = 'font-family:monospace;font-size:1.1em;font-weight:600;min-width:70px;text-align:right'
			displayEl.textContent = formatDisplayTime(remaining)
			displayEl.dataset.timerId = timer.timerId
			headerEl.appendChild(displayEl)
			// WO-381: the readout IS the time control — click it, type, Enter.
			attachInlineTimeEditor(displayEl, timer, { onSaved: () => setTimeout(() => refreshTimerList(), 100) })

			// Settings button
			const settingsBtn = document.createElement('button')
			settingsBtn.type = 'button'
			settingsBtn.className = 'timer-control-panel__btn'
			settingsBtn.style.cssText = 'padding:4px 6px;font-size:0.85em;width:28px;flex:0'
			settingsBtn.title = 'Settings'
			settingsBtn.textContent = '⚙'
			headerEl.appendChild(settingsBtn)

			timerEl.appendChild(headerEl)

			// Control buttons (start/pause/reset)
			const controlsEl = document.createElement('div')
			controlsEl.style.cssText = 'display:flex;gap:4px;margin-bottom:6px'

			for (const action of ['start', 'pause', 'reset']) {
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'timer-control-panel__btn'
				btn.style.cssText = 'padding:4px 8px;font-size:0.85em;flex:1'
				btn.dataset.action = action
				btn.dataset.timerId = timer.timerId
				const icons = { start: '▶', pause: '⏸', reset: '⟲' }
				const titles = { start: 'Start', pause: 'Pause', reset: 'Reset' }
				btn.textContent = icons[action]
				btn.title = titles[action]
				btn.addEventListener('click', () => onTimerAction(timer.timerId, action))
				controlsEl.appendChild(btn)
			}

			timerEl.appendChild(controlsEl)

			// Per-screen chips
			if (timer.screens && Object.keys(timer.screens).length > 0) {
				const chipsEl = document.createElement('div')
				chipsEl.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px'

				for (const [screenIdxStr, screenEntry] of Object.entries(timer.screens)) {
					const screenIdx = parseInt(screenIdxStr, 10)
					const chipEl = document.createElement('div')
					chipEl.className = 'timer-control-panel__screen-chip'
					chipEl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--color-bg-tertiary);border-radius:3px;font-size:0.85em'

					const labelEl = document.createElement('span')
					const cm = typeof getChannelMap === 'function' ? getChannelMap() : {}
					labelEl.textContent = screenLabel(cm, screenIdx)
					chipEl.appendChild(labelEl)

					// Visible toggle
					const toggleEl = document.createElement('button')
					toggleEl.type = 'button'
					toggleEl.className = 'timer-control-panel__chip-toggle'
					toggleEl.style.cssText = 'background:none;border:none;cursor:pointer;padding:0;width:20px;height:20px;display:flex;align-items:center;justify-content:center'
					toggleEl.title = screenEntry.visible ? 'Hide' : 'Show'
					toggleEl.textContent = screenEntry.visible ? '👁' : '⊘'
					toggleEl.dataset.timerId = timer.timerId
					toggleEl.dataset.screenIdx = screenIdx
					toggleEl.addEventListener('click', () => onToggleVisible(timer.timerId, screenIdx, !screenEntry.visible))
					chipEl.appendChild(toggleEl)

					// Unassign button
					const unassignEl = document.createElement('button')
					unassignEl.type = 'button'
					unassignEl.className = 'timer-control-panel__chip-unassign'
					unassignEl.style.cssText = 'background:none;border:none;cursor:pointer;padding:0;width:16px;height:16px;display:flex;align-items:center;justify-content:center;opacity:0.6;font-size:0.9em'
					unassignEl.title = 'Remove from screen'
					unassignEl.textContent = '×'
					unassignEl.dataset.timerId = timer.timerId
					unassignEl.dataset.screenIdx = screenIdx
					unassignEl.addEventListener('click', () => onUnassign(timer.timerId, screenIdx))
					chipEl.appendChild(unassignEl)

					chipsEl.appendChild(chipEl)
				}

				timerEl.appendChild(chipsEl)
			}

			// Settings section (hidden by default, toggled by button)
			const settingsEl = document.createElement('div')
			settingsEl.className = 'timer-control-panel__settings'
			settingsEl.style.display = 'none'
			buildTimerSettings(settingsEl, timer, { refreshTimerList })
			timerEl.appendChild(settingsEl)

			// Toggle settings visibility
			settingsBtn.addEventListener('click', () => {
				const isHidden = settingsEl.style.display === 'none'
				settingsEl.style.display = isHidden ? 'flex' : 'none'
			})

			listContainer.appendChild(timerEl)
		}
	}


	async function onTimerAction(timerId, action) {
		try {
			await api.post('/api/timers/cmd', { timerId, cmd: action })
		} catch (err) {
			console.warn(`[timer-panel] cmd ${action} failed:`, err?.message || err)
		}
	}

	async function onToggleVisible(timerId, screenIdx, visible) {
		try {
			await api.post('/api/timers/visible', { timerId, screenIdx, visible })
			// Refresh to update UI
			setTimeout(() => refreshTimerList(), 100)
		} catch (err) {
			console.warn('[timer-panel] visible toggle failed:', err?.message || err)
		}
	}

	async function onUnassign(timerId, screenIdx) {
		if (!confirm(`Remove timer from Screen ${screenIdx + 1}?`)) return
		try {
			await api.post('/api/timers/unassign', { timerId, screenIdx })
			// Refresh to update UI
			setTimeout(() => refreshTimerList(), 100)
		} catch (err) {
			console.warn('[timer-panel] unassign failed:', err?.message || err)
		}
	}


	function startTick() {
		if (tickTimer) return
		tickTimer = setInterval(() => {
			// Update all timer display elements
			const displays = listContainer.querySelectorAll('[data-timer-id]')
			for (const el of displays) {
				const timerId = el.dataset.timerId
				const timer = lastTimersList.find(t => t.timerId === timerId)
				if (timer) {
					const remaining = computeDisplayTime(timer)
					const displayEl = el.querySelector('.timer-control-panel__timer-display')
					// WO-381: never type over the owner — the inline editor marks the readout
					// data-editing="1" while it is open.
					if (displayEl && displayEl.dataset.editing !== '1') {
						displayEl.textContent = formatDisplayTime(remaining)
					}
				}
			}
		}, TICK_INTERVAL_MS)
	}

	function stopTick() {
		if (tickTimer) {
			clearInterval(tickTimer)
			tickTimer = null
		}
	}

	function startPoll() {
		if (pollTimer) return
		pollTimer = setInterval(() => {
			if (!isCollapsed) refreshTimerList()
		}, POLL_INTERVAL_MS)
	}

	function stopPoll() {
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	}

	// Cleanup on unmount
	const obs = new MutationObserver(() => {
		if (!root.isConnected) {
			stopTick()
			stopPoll()
			obs.disconnect()
		}
	})
	obs.observe(mountEl, { childList: true })
}
