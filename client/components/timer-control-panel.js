/**
 * Timer control panel — collapsible bottom-right controller (WO-186, WO-192, WO-205, WO-210).
 *
 * Fixed/docked bottom-right next to the program audio mixer. Provides:
 * - Collapsible header (persists collapsed state in localStorage)
 * - List of all screen timers from /api/timers/list (polled ~1s while open)
 * - Per-timer row: name, remaining-time display (computed client-side from lastCmd/cmdAt/config),
 *   start/pause/reset buttons, and per-screen chips with visible toggles
 * - "Add to screen" dropdown per timer (assign to screen slot)
 * - Unassign button (×) per chip with confirmation
 * - "New timer" button (creates timer instance with default config, assigns to screen)
 * - Live time display that MIRRORS timer state (ticks 4×/s locally)
 *
 * WO-210 T210.6:
 * - Source of truth: GET /api/timers/list (poll ~1s while open)
 * - Per-timer display computed from {lastCmd, cmdAt, config} using computeDisplayTime
 * - Transport buttons: POST /api/timers/cmd {timerId, cmd: start|pause|reset}
 * - Per-screen chips with visible toggle: POST /api/timers/visible {timerId, screenIdx, visible}
 * - "Add to screen" control: POST /api/timers/assign {timerId, name?, config?, screenIdx}
 * - Unassign chip affordance (×) with confirm(): POST /api/timers/unassign {timerId, screenIdx}
 * - "New timer" creates instance (via crypto.randomUUID() or similar) with default config
 * - getScreenTimersSnapshot() exported for T210.8 (look-save integration)
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { createHmsInput, secondsToHms, hmsToSeconds } from '../lib/duration-hms-input.js'
import { escapeAttr } from '../lib/dom-escape.js'

const LS_COLLAPSED = 'highascg_timer_panel_collapsed'
const POLL_INTERVAL_MS = 1000 // ~1s (was 5s for old countdown polling)
const TICK_INTERVAL_MS = 250 // 4×/s

/**
 * Default timer config (mirrors scene-state-timers.js DEFAULT_TIMER_CONFIG).
 */
const DEFAULT_TIMER_CONFIG = {
	mode: 'duration',
	durationSec: 300,
	targetTime: '18:00:00',
	format: 'auto',
	amberThresholdSec: 60,
	redThresholdSec: 15,
	position: 'center',
	hideTimer: false,
	timerFontSize: 15,
	auxFontSize: 5,
	timerColor: '#ffffff',
	amberColor: '#ffb300',
	redColor: '#ff3b30',
	auxColor: '#ffffff',
	auxTop: '',
	auxMiddle: '',
	auxBottom: '',
}

/**
 * Compute remaining time for a timer.
 * Uses server-side runtime (lastCmd, cmdAt) from /api/timers/list, with fallback to config.
 * @param {object} timerRecord - { config, lastCmd, cmdAt, durationSec }
 * @returns {number} seconds remaining (may be negative)
 */
function computeDisplayTime(timerRecord) {
	if (!timerRecord) return 0
	const { config = {}, lastCmd, cmdAt, durationSec } = timerRecord
	const mode = config.mode || 'duration'
	const now = Date.now()

	if (mode === 'duration') {
		if (lastCmd === 'pause') {
			// Paused: show remaining from last computation (server may provide this)
			// For now, fall back to config
			return durationSec || config.durationSec || 0
		}
		if (lastCmd === 'start' && Number.isFinite(cmdAt)) {
			const elapsedSec = (now - cmdAt) / 1000
			const remaining = (durationSec || config.durationSec || 0) - elapsedSec
			return remaining
		}
		// Reset or never started
		return durationSec || config.durationSec || 0
	}

	// Clock mode: time until target
	if (mode === 'clock') {
		const targetStr = config.targetTime || '00:00:00'
		const [h, m, s] = targetStr.split(':').map((x) => parseInt(x, 10) || 0)
		const today = new Date()
		const target = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, s)
		const remaining = (target - now) / 1000
		return remaining
	}

	return 0
}

/**
 * Format seconds as HH:MM:SS for display, supporting negative values.
 */
function formatDisplayTime(seconds) {
	const sign = seconds < 0 ? '-' : ''
	const abs = Math.abs(Math.trunc(seconds))
	const h = Math.floor(abs / 3600)
	const m = Math.floor((abs % 3600) / 60)
	const s = abs % 60
	const pad = (n) => String(n).padStart(2, '0')
	return sign + pad(h) + ':' + pad(m) + ':' + pad(s)
}

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
			<button type="button" class="timer-control-panel__new-timer-btn" id="new-timer-btn" title="Create and assign a new timer">+ New Timer</button>
		</div>
	`
	mountEl.appendChild(root)

	const toggle = root.querySelector('.timer-control-panel__toggle')
	const chevron = root.querySelector('.timer-control-panel__chevron')
	const content = root.querySelector('.timer-control-panel__content')
	const listContainer = root.querySelector('#timer-list')
	const newTimerBtn = root.querySelector('#new-timer-btn')

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
					labelEl.textContent = `S${screenIdx + 1}`
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

			// "Add to screen" dropdown
			const addEl = document.createElement('div')
			addEl.style.cssText = 'display:flex;gap:4px;font-size:0.85em'

			const addLabelEl = document.createElement('span')
			addLabelEl.textContent = 'Add to screen:'
			addLabelEl.style.cssText = 'display:flex;align-items:center'
			addEl.appendChild(addLabelEl)

			const selectEl = document.createElement('select')
			selectEl.className = 'timer-control-panel__screen-select'
			selectEl.style.cssText = 'padding:2px 4px;border-radius:2px'
			selectEl.dataset.timerId = timer.timerId
			selectEl.addEventListener('change', (e) => {
				const screenIdx = parseInt(e.target.value, 10)
				if (Number.isFinite(screenIdx)) {
					onAssignToScreen(timer.timerId, screenIdx)
					e.target.value = ''
				}
			})

			const defaultOpt = document.createElement('option')
			defaultOpt.value = ''
			defaultOpt.textContent = 'Select screen...'
			selectEl.appendChild(defaultOpt)

			// Build screen list from channelMap
			const getScreens = typeof getChannelMap === 'function' ? getChannelMap() : {}
			const screenCount = getScreens.programChannels ? getScreens.programChannels.length : 4
			const assignedScreens = new Set(Object.keys(timer.screens || {}).map(s => parseInt(s, 10)))

			for (let i = 0; i < screenCount; i++) {
				if (assignedScreens.has(i)) continue // Skip already assigned
				const opt = document.createElement('option')
				opt.value = String(i)
				opt.textContent = `S${i + 1}`
				selectEl.appendChild(opt)
			}

			addEl.appendChild(selectEl)
			timerEl.appendChild(addEl)

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

	async function onAssignToScreen(timerId, screenIdx) {
		try {
			await api.post('/api/timers/assign', { timerId, screenIdx })
			// Refresh to update UI
			setTimeout(() => refreshTimerList(), 100)
		} catch (err) {
			console.warn('[timer-panel] assign failed:', err?.message || err)
		}
	}

	newTimerBtn.addEventListener('click', async () => {
		const name = prompt('Timer name (default: Timer N):', '')?.trim() || `Timer ${lastTimersList.length + 1}`

		// Show HMS input for duration
		const defaultDuration = 300 // 5 minutes
		const h = Math.floor(defaultDuration / 3600)
		const m = Math.floor((defaultDuration % 3600) / 60)
		const s = defaultDuration % 60
		const durationStr = prompt('Duration (HH:MM:SS)', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)?.trim()

		let durationSec = defaultDuration
		if (durationStr) {
			const parts = durationStr.split(':').map(x => parseInt(x, 10) || 0)
			durationSec = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)
		}

		// Generate timer ID
		const timerId = typeof crypto !== 'undefined' && crypto.randomUUID
			? crypto.randomUUID()
			: `timer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

		const config = {
			...DEFAULT_TIMER_CONFIG,
			durationSec,
		}

		// Get first available screen (or prompt user)
		const getScreens = typeof getChannelMap === 'function' ? getChannelMap() : {}
		const screenCount = getScreens.programChannels ? getScreens.programChannels.length : 1
		const screenIdx = 0 // Assign to first screen by default

		try {
			await api.post('/api/timers/assign', {
				timerId,
				name,
				config,
				screenIdx,
			})
			// Refresh to show new timer
			setTimeout(() => refreshTimerList(), 100)
		} catch (err) {
			console.warn('[timer-panel] new timer failed:', err?.message || err)
		}
	})

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
					if (displayEl) {
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
