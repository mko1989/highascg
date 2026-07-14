/**
 * Timer control panel — collapsible bottom-right controller (WO-186).
 *
 * Fixed/docked bottom-right next to the program audio mixer. Provides:
 * - Collapsible header (persists collapsed state in localStorage)
 * - Dropdown to select which countdown timer to control
 * - Live time display (ticks locally from last-known config)
 * - Start/Pause/Reset buttons
 * - HH:MM:SS input boxes for duration/target time
 *
 * GET /api/countdown/list refreshed on scene changes or 5s poll when expanded.
 * Timer list is fetched from the API and cached locally. Hidden entirely when no timers.
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { createHmsInput, secondsToHms, hmsToSeconds } from '../lib/duration-hms-input.js'
import { escapeAttr } from '../lib/dom-escape.js'

const LS_COLLAPSED = 'highascg_timer_panel_collapsed'
const POLL_INTERVAL_MS = 5000

/**
 * Compute remaining/elapsed time for display.
 * Mirrors countdown-engine.js logic: uses absolute epoch milliseconds to avoid drift.
 * @param {object} config - countdown config object
 * @returns {number} seconds remaining (may be negative)
 */
function computeDisplayTime(config) {
	if (!config || typeof config !== 'object') return 0
	const mode = config.mode || 'duration'
	const now = Date.now()

	// Duration and clock modes store an end time in ms
	if (mode === 'duration' || mode === 'clock') {
		if (!Number.isFinite(config.endEpochMs)) return config.durationSec || 0
		const remaining = (config.endEpochMs - now) / 1000
		return remaining
	}

	// Countup mode stores a start time in ms
	if (mode === 'countup') {
		if (!Number.isFinite(config.startEpochMs)) return 0
		const elapsed = (now - config.startEpochMs) / 1000
		return elapsed
	}

	return 0
}

/**
 * Format seconds as HH:MM:SS for display.
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
			<div class="timer-control-panel__display" id="timer-display">00:00:00</div>
			<div class="timer-control-panel__buttons">
				<button type="button" class="timer-control-panel__btn" data-action="start" title="Start/Resume">▶</button>
				<button type="button" class="timer-control-panel__btn" data-action="pause" title="Pause">⏸</button>
				<button type="button" class="timer-control-panel__btn" data-action="reset" title="Reset">⟲</button>
			</div>
			<div class="timer-control-panel__hms-label">Duration/Target</div>
			<div class="timer-control-panel__hms" id="timer-hms"></div>
		</div>
	`
	mountEl.appendChild(root)

	const toggle = root.querySelector('.timer-control-panel__toggle')
	const chevron = root.querySelector('.timer-control-panel__chevron')
	const content = root.querySelector('.timer-control-panel__content')
	const select = root.querySelector('#timer-selector')
	const displayEl = root.querySelector('#timer-display')
	const hmsContainer = root.querySelector('#timer-hms')
	const buttons = root.querySelectorAll('[data-action]')

	let isCollapsed = true
	let timerList = []
	let selectedTimer = null
	let tickTimer = null
	let pollTimer = null
	let hmsInput = null

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
				updateSelectOptions()
				root.style.display = timerList.length > 0 ? '' : 'none'
				if (timerList.length === 0) {
					selectedTimer = null
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
			return
		}

		try {
			selectedTimer = JSON.parse(select.value)
			const timer = timerList.find(
				(t) => t.channel === selectedTimer.channel && t.layerNumber === selectedTimer.layerNumber,
			)
			if (timer) {
				updateDisplay(timer)
				updateHmsInput(timer)
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

		const remaining = computeDisplayTime(timer.config)
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

		const mode = timer.config?.mode || 'duration'
		let value = 0

		if (mode === 'duration') {
			value = timer.config?.durationSec || 300
		} else if (mode === 'clock') {
			// For clock mode, we'd show the target time, but that's a string
			// For now, just show durationSec as a fallback
			value = timer.config?.durationSec || 300
		}

		hmsContainer.innerHTML = ''
		hmsInput = createHmsInput({
			value,
			onChange: (seconds) => {
				onHmsChange(seconds, mode)
			},
		})
		hmsContainer.appendChild(hmsInput.wrap)
	}

	async function onHmsChange(seconds, mode) {
		if (!selectedTimer) return

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
		} catch (err) {
			console.warn('[timer-panel] HMS update failed:', err?.message || err)
		}
	}

	buttons.forEach((btn) => {
		btn.addEventListener('click', async () => {
			if (!selectedTimer) return

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
		}, 100)
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
