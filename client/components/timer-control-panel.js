/**
 * Timer control panel — collapsible bottom-right controller (WO-186, WO-192).
 *
 * Fixed/docked bottom-right next to the program audio mixer. Provides:
 * - Collapsible header (persists collapsed state in localStorage)
 * - Dropdown to select which countdown timer to control
 * - Live time display that MIRRORS countdown state (ticks 4×/s locally)
 * - Start/Pause/Reset buttons
 * - HH:MM:SS input boxes for duration/target time (populated from timer config, persist on refresh)
 * - Preset buttons for quick duration setting (5m, 10m, 15m, 20m, 25m, 30m, 45m, 60m)
 *
 * GET /api/countdown/list refreshed on scene changes or 5s poll when expanded.
 * Timer list is fetched from the API and cached locally. Hidden entirely when no timers.
 *
 * WO-192 notes:
 * - Per-timer state tracks {config, lastCmd, cmdAt, remainingWhenPaused} to mirror the countdown.
 * - Live display ticks every 250ms (4×/s).
 * - Duration mode: remainingTime = durationSec - (now - startedAt), frozen while paused.
 * - Clock mode: remainingTime = targetTime - now.
 * - Negative values display as -MM:SS (overflow format).
 * - HMS boxes are populated from the selected timer's countdownConfig on selection/refresh,
 *   but skip repopulating while any input has focus to avoid mid-edit interruption.
 * - External control (inspector/companion) may drift the mirror until the next panel command.
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { createHmsInput, secondsToHms, hmsToSeconds } from '../lib/duration-hms-input.js'
import { escapeAttr } from '../lib/dom-escape.js'

const LS_COLLAPSED = 'highascg_timer_panel_collapsed'
const POLL_INTERVAL_MS = 5000
const TICK_INTERVAL_MS = 250 // 4×/s

// Preset durations (in seconds)
const PRESETS = [
	{ label: '5m', seconds: 5 * 60 },
	{ label: '10m', seconds: 10 * 60 },
	{ label: '15m', seconds: 15 * 60 },
	{ label: '20m', seconds: 20 * 60 },
	{ label: '25m', seconds: 25 * 60 },
	{ label: '30m', seconds: 30 * 60 },
	{ label: '45m', seconds: 45 * 60 },
	{ label: '60m', seconds: 60 * 60 },
]

/**
 * Compute remaining time for the selected timer based on panel state mirror.
 * This implements a local approximation of the countdown template's state.
 *
 * @param {object} timerState - { config, lastCmd, cmdAt, remainingWhenPaused }
 * @returns {number} seconds remaining (may be negative)
 */
function computeDisplayTime(timerState) {
	if (!timerState || !timerState.config) return 0
	const { config, lastCmd, cmdAt, remainingWhenPaused } = timerState
	const mode = config.mode || 'duration'
	const now = Date.now()

	// Duration mode: compute elapsed time since start
	if (mode === 'duration') {
		// If paused, show the frozen remaining time
		if (lastCmd === 'pause' && Number.isFinite(remainingWhenPaused)) {
			return remainingWhenPaused
		}
		// If reset or never started, show configured duration
		if (lastCmd === 'reset' || !lastCmd) {
			return config.durationSec || 0
		}
		// If running, compute elapsed from start time
		if (lastCmd === 'start' && Number.isFinite(cmdAt)) {
			const elapsedSec = (now - cmdAt) / 1000
			const remaining = (config.durationSec || 0) - elapsedSec
			return remaining
		}
		return config.durationSec || 0
	}

	// Clock mode: compute time until target
	if (mode === 'clock') {
		// Parse targetTime as HH:MM:SS on today's local date
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
 * Check if any of the HMS input elements currently has focus.
 * @param {HTMLElement} hmsContainer
 * @returns {boolean}
 */
function isHmsFocused(hmsContainer) {
	if (!hmsContainer) return false
	const activeEl = document.activeElement
	return hmsContainer.contains(activeEl)
}

/**
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {HTMLElement} mountEl
 */
export function initTimerControlPanel(stateStore, mountEl) {
	if (!mountEl) return

	const root = document.createElement('div')
	root.className = 'timer-control-panel timer-control-panel--collapsed'
	root.innerHTML = `
		<button type="button" class="timer-control-panel__toggle" aria-expanded="false" title="Timer controls">
			<span class="timer-control-panel__chevron" aria-hidden="true">▶</span>
			<span class="timer-control-panel__label">Timer</span>
		</button>
		<div class="timer-control-panel__content" hidden>
			<div class="timer-control-panel__selector">
				<select class="timer-control-panel__select" id="timer-selector" title="Select a timer"></select>
			</div>
			<div class="timer-control-panel__display" id="timer-display" title="Live countdown mirror (approximation; external control may drift until next panel command)">00:00:00</div>
			<div class="timer-control-panel__buttons">
				<button type="button" class="timer-control-panel__btn" data-action="start" title="Start/Resume">▶</button>
				<button type="button" class="timer-control-panel__btn" data-action="pause" title="Pause">⏸</button>
				<button type="button" class="timer-control-panel__btn" data-action="reset" title="Reset">⟲</button>
			</div>
			<div class="timer-control-panel__hms-label">Duration/Target</div>
			<div class="timer-control-panel__hms" id="timer-hms"></div>
			<div class="timer-control-panel__presets" id="timer-presets"></div>
		</div>
	`
	mountEl.appendChild(root)

	const toggle = root.querySelector('.timer-control-panel__toggle')
	const chevron = root.querySelector('.timer-control-panel__chevron')
	const content = root.querySelector('.timer-control-panel__content')
	const select = root.querySelector('#timer-selector')
	const displayEl = root.querySelector('#timer-display')
	const hmsContainer = root.querySelector('#timer-hms')
	const presetsContainer = root.querySelector('#timer-presets')
	const buttons = root.querySelectorAll('[data-action]')

	let isCollapsed = true
	let timerList = []
	let selectedTimer = null
	let tickTimer = null
	let pollTimer = null
	let hmsInput = null

	// Per-timer state: { config, lastCmd, cmdAt, remainingWhenPaused }
	const timerStateMap = new Map()

	/**
	 * Get the state key for a timer (channel:layer).
	 */
	function getStateKey(timer) {
		if (!timer) return null
		return `${timer.channel}:${timer.layerNumber}`
	}

	/**
	 * Get or initialize timer state.
	 */
	function getTimerState(timer) {
		if (!timer) return null
		const key = getStateKey(timer)
		if (!timerStateMap.has(key)) {
			timerStateMap.set(key, {
				config: timer.config || null,
				lastCmd: null,
				cmdAt: null,
				remainingWhenPaused: null,
			})
		}
		return timerStateMap.get(key)
	}

	/**
	 * Update timer state (on command or config change).
	 */
	function updateTimerState(timer, update) {
		if (!timer) return
		const state = getTimerState(timer)
		Object.assign(state, update)
	}

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
			const res = await api.get('/api/countdown/list')
			if (res?.items && Array.isArray(res.items)) {
				timerList = res.items
				// Update timer states with fresh config from list
				for (const timer of timerList) {
					const key = getStateKey(timer)
					const existing = timerStateMap.get(key)
					if (existing) {
						existing.config = timer.config || null
					} else {
						getTimerState(timer)
					}
				}
				updateSelectOptions()
				root.style.display = timerList.length > 0 ? '' : 'none'
				if (timerList.length === 0) {
					selectedTimer = null
				}
				// Refresh HMS display if a timer is selected and not focused
				if (selectedTimer && !isHmsFocused(hmsContainer)) {
					const timer = timerList.find(
						(t) => t.channel === selectedTimer.channel && t.layerNumber === selectedTimer.layerNumber,
					)
					if (timer) {
						updateHmsInput(timer)
					}
				}
			}
		} catch (err) {
			console.warn('[timer-panel] refresh failed:', err?.message || err)
		}
	}

	function updateSelectOptions() {
		const prevSelected = select.value
		select.innerHTML = ''

		if (timerList.length === 0) {
			const opt = document.createElement('option')
			opt.value = ''
			opt.textContent = '(no timers)'
			select.appendChild(opt)
			return
		}

		timerList.forEach((item, idx) => {
			const opt = document.createElement('option')
			const label = item.label || `Timer #${idx + 1}`
			opt.value = JSON.stringify({ channel: item.channel, layerNumber: item.layerNumber })
			opt.textContent = `${label}`
			select.appendChild(opt)
		})

		// Restore previous selection if it still exists
		if (prevSelected && Array.from(select.options).some((o) => o.value === prevSelected)) {
			select.value = prevSelected
		} else if (timerList.length > 0) {
			select.value = timerList[0] ? JSON.stringify({ channel: timerList[0].channel, layerNumber: timerList[0].layerNumber }) : ''
		}

		onSelectChange()
	}

	function onSelectChange() {
		if (!select.value) {
			selectedTimer = null
			updateDisplay()
			updateHmsInput(null)
			updatePresets(null)
			return
		}

		try {
			selectedTimer = JSON.parse(select.value)
			const timer = timerList.find(
				(t) => t.channel === selectedTimer.channel && t.layerNumber === selectedTimer.layerNumber,
			)
			if (timer) {
				// Ensure timer state exists
				getTimerState(timer)
				updateDisplay(timer)
				updateHmsInput(timer)
				updatePresets(timer)
			}
		} catch {
			selectedTimer = null
		}
	}

	select.addEventListener('change', onSelectChange)

	function updateDisplay(timer) {
		if (!timer || !selectedTimer) {
			displayEl.textContent = '00:00:00'
			return
		}

		const timerState = getTimerState(timer)
		const remaining = computeDisplayTime(timerState)
		displayEl.textContent = formatDisplayTime(remaining)
	}

	function updateHmsInput(timer) {
		if (!timer || !selectedTimer) {
			if (hmsInput) {
				hmsContainer.innerHTML = ''
				hmsInput = null
			}
			return
		}

		const timerState = getTimerState(timer)
		const mode = timerState.config?.mode || 'duration'
		let value = 0

		if (mode === 'duration') {
			value = timerState.config?.durationSec || 300
		} else if (mode === 'clock') {
			// For clock mode, show durationSec as fallback
			value = timerState.config?.durationSec || 300
		}

		hmsContainer.innerHTML = ''
		hmsInput = createHmsInput({
			value,
			onChange: (seconds) => {
				onHmsChange(seconds, timer, mode)
			},
		})
		hmsContainer.appendChild(hmsInput.wrap)
	}

	async function onHmsChange(seconds, timer, mode) {
		if (!selectedTimer || !timer) return

		try {
			const payload = {
				channel: selectedTimer.channel,
				layer: selectedTimer.layerNumber,
				templateHostLayer: 0,
			}

			if (mode === 'duration') {
				payload.durationSec = seconds
			} else if (mode === 'clock') {
				payload.durationSec = seconds
			}

			await api.post('/api/countdown/set', payload)

			// Update local state so the change sticks
			const timerState = getTimerState(timer)
			if (timerState.config) {
				timerState.config.durationSec = seconds
			}
		} catch (err) {
			console.warn('[timer-panel] HMS update failed:', err?.message || err)
		}
	}

	function updatePresets(timer) {
		presetsContainer.innerHTML = ''

		if (!timer || !selectedTimer) {
			return
		}

		const presetRow = document.createElement('div')
		presetRow.className = 'timer-control-panel__preset-row'
		presetRow.style.display = 'flex'
		presetRow.style.flexWrap = 'wrap'
		presetRow.style.gap = '4px'
		presetRow.style.marginTop = '8px'

		for (const preset of PRESETS) {
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'timer-control-panel__preset-btn'
			btn.textContent = preset.label
			btn.title = `Set to ${preset.label}`
			btn.addEventListener('click', async () => {
				await onPresetClick(preset.seconds, timer)
			})
			presetRow.appendChild(btn)
		}

		presetsContainer.appendChild(presetRow)
	}

	async function onPresetClick(seconds, timer) {
		if (!selectedTimer || !timer) return

		try {
			// Update HMS boxes
			if (hmsInput && hmsInput.setValue) {
				hmsInput.setValue(seconds)
			}

			// Send the set command
			const payload = {
				channel: selectedTimer.channel,
				layer: selectedTimer.layerNumber,
				templateHostLayer: 0,
				durationSec: seconds,
			}

			await api.post('/api/countdown/set', payload)

			// Update local state
			const timerState = getTimerState(timer)
			if (timerState.config) {
				timerState.config.durationSec = seconds
			}
		} catch (err) {
			console.warn('[timer-panel] preset click failed:', err?.message || err)
		}
	}

	buttons.forEach((btn) => {
		btn.addEventListener('click', async () => {
			if (!selectedTimer) return

			const timer = timerList.find(
				(t) => t.channel === selectedTimer.channel && t.layerNumber === selectedTimer.layerNumber,
			)
			if (!timer) return

			const action = btn.getAttribute('data-action')
			const prevDisabled = Array.from(buttons).map((b) => b.disabled)

			buttons.forEach((b) => {
				b.disabled = true
			})

			try {
				await api.post(`/api/countdown/${action}`, {
					channel: selectedTimer.channel,
					layer: selectedTimer.layerNumber,
					templateHostLayer: 0,
				})

				// Update timer state based on action
				const now = Date.now()
				const timerState = getTimerState(timer)

				if (action === 'start') {
					timerState.lastCmd = 'start'
					timerState.cmdAt = now
					timerState.remainingWhenPaused = null
				} else if (action === 'pause') {
					timerState.lastCmd = 'pause'
					// Compute and freeze the remaining time
					const remaining = computeDisplayTime(timerState)
					timerState.remainingWhenPaused = remaining
					timerState.cmdAt = null
				} else if (action === 'reset') {
					timerState.lastCmd = 'reset'
					timerState.cmdAt = null
					timerState.remainingWhenPaused = null
				}
			} catch (err) {
				console.warn(`[timer-panel] ${action} failed:`, err?.message || err)
			} finally {
				buttons.forEach((b, i) => {
					b.disabled = prevDisabled[i]
				})
			}
		})
	})

	function startTick() {
		if (tickTimer) return
		tickTimer = setInterval(() => {
			const timer = timerList.find(
				(t) => selectedTimer && t.channel === selectedTimer.channel && t.layerNumber === selectedTimer.layerNumber,
			)
			if (timer) updateDisplay(timer)
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

	// Listen for scene changes to refresh timer list
	const onSceneChange = () => {
		if (!isCollapsed) refreshTimerList()
	}
	sceneState.on('change', onSceneChange)
	sceneState.on('softChange', onSceneChange)

	// Cleanup on unmount
	const obs = new MutationObserver(() => {
		if (!root.isConnected) {
			stopTick()
			stopPoll()
			sceneState.off('change', onSceneChange)
			sceneState.off('softChange', onSceneChange)
			obs.disconnect()
		}
	})
	obs.observe(mountEl, { childList: true })
}
