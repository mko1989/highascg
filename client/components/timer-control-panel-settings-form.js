/**
 * Timer control panel — per-timer settings form (duration/mode/target-time/position + save/cancel).
 * Extracted from timer-control-panel.js (WO-221 Phase A mechanical split).
 */

import { api } from '../lib/api-client.js'
import { createHmsInput, hmsToSeconds } from '../lib/duration-hms-input.js'
import { DEFAULT_TIMER_CONFIG } from './timer-control-panel-display.js'

/**
 * Build settings section for a timer.
 * @param {HTMLElement} containerEl
 * @param {object} timer
 * @param {{ refreshTimerList: () => void }} deps
 */
export function buildTimerSettings(containerEl, timer, deps) {
	const { refreshTimerList } = deps
	const config = timer.config || {}
	const assignedScreenIdxStr = timer.screens ? Object.keys(timer.screens)[0] : null

	// Duration label and HMS boxes
	const durationLabel = document.createElement('div')
	durationLabel.className = 'timer-control-panel__settings-label'
	durationLabel.textContent = 'Duration'
	containerEl.appendChild(durationLabel)

	const durationSec = config.durationSec || DEFAULT_TIMER_CONFIG.durationSec
	const hmsControl = createHmsInput({ value: durationSec })
	hmsControl.wrap.style.marginBottom = '4px'
	containerEl.appendChild(hmsControl.wrap)

	// Mode select
	const modeLabel = document.createElement('div')
	modeLabel.className = 'timer-control-panel__settings-label'
	modeLabel.style.marginTop = '4px'
	modeLabel.textContent = 'Mode'
	containerEl.appendChild(modeLabel)

	const modeSelect = document.createElement('select')
	modeSelect.className = 'timer-control-panel__settings-select'
	modeSelect.style.cssText = 'width:100%;padding:2px 4px'
	const modeOpt1 = document.createElement('option')
	modeOpt1.value = 'duration'
	modeOpt1.textContent = 'Duration'
	const modeOpt2 = document.createElement('option')
	modeOpt2.value = 'clock'
	modeOpt2.textContent = 'Clock'
	modeSelect.appendChild(modeOpt1)
	modeSelect.appendChild(modeOpt2)
	modeSelect.value = config.mode || 'duration'
	containerEl.appendChild(modeSelect)

	// Target time input (shown only when mode=clock)
	const targetTimeLabel = document.createElement('div')
	targetTimeLabel.className = 'timer-control-panel__settings-label'
	targetTimeLabel.style.marginTop = '4px'
	targetTimeLabel.textContent = 'Target Time (HH:MM:SS)'
	targetTimeLabel.style.display = config.mode === 'clock' ? 'block' : 'none'
	containerEl.appendChild(targetTimeLabel)

	const targetTimeInput = document.createElement('input')
	targetTimeInput.type = 'text'
	targetTimeInput.className = 'timer-control-panel__settings-input'
	targetTimeInput.style.cssText = 'width:100%;padding:2px 4px'
	targetTimeInput.placeholder = 'HH:MM:SS'
	targetTimeInput.value = config.targetTime || DEFAULT_TIMER_CONFIG.targetTime
	targetTimeInput.style.display = config.mode === 'clock' ? 'block' : 'none'
	targetTimeInput.style.marginBottom = '4px'
	containerEl.appendChild(targetTimeInput)

	// Size (timerFontSize, vw units — template/countdown/countdown-engine.js DEFAULT_CONFIG.timerFontSize)
	// WO-226 T226.4: exposed here (not just Position) so the inspector modal and the corner
	// panel share one settings form instead of duplicating fields.
	const sizeLabel = document.createElement('div')
	sizeLabel.className = 'timer-control-panel__settings-label'
	sizeLabel.style.marginTop = '4px'
	sizeLabel.textContent = 'Size (vw)'
	containerEl.appendChild(sizeLabel)

	const sizeInput = document.createElement('input')
	sizeInput.type = 'number'
	sizeInput.min = '1'
	sizeInput.max = '100'
	sizeInput.step = '1'
	sizeInput.className = 'timer-control-panel__settings-input'
	sizeInput.style.cssText = 'width:100%;padding:2px 4px'
	sizeInput.value = String(config.timerFontSize || DEFAULT_TIMER_CONFIG.timerFontSize)
	containerEl.appendChild(sizeInput)

	// Position select
	const positionLabel = document.createElement('div')
	positionLabel.className = 'timer-control-panel__settings-label'
	positionLabel.style.marginTop = '4px'
	positionLabel.textContent = 'Position'
	containerEl.appendChild(positionLabel)

	const positionSelect = document.createElement('select')
	positionSelect.className = 'timer-control-panel__settings-select'
	positionSelect.style.cssText = 'width:100%;padding:2px 4px'
	const positions = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
	for (const pos of positions) {
		const opt = document.createElement('option')
		opt.value = pos
		opt.textContent = pos
		positionSelect.appendChild(opt)
	}
	positionSelect.value = config.position || 'center'
	containerEl.appendChild(positionSelect)

	// Mode change handler to show/hide targetTime
	modeSelect.addEventListener('change', () => {
		const isClock = modeSelect.value === 'clock'
		targetTimeLabel.style.display = isClock ? 'block' : 'none'
		targetTimeInput.style.display = isClock ? 'block' : 'none'
	})

	// Save/Cancel buttons
	const buttonsRow = document.createElement('div')
	buttonsRow.style.cssText = 'display:flex;gap:4px;margin-top:6px'

	const saveBtn = document.createElement('button')
	saveBtn.type = 'button'
	saveBtn.className = 'timer-control-panel__settings-btn'
	saveBtn.textContent = 'Save'
	saveBtn.addEventListener('click', async () => {
		if (!assignedScreenIdxStr) {
			console.warn('[timer-panel] Cannot save settings: timer not assigned to any screen')
			return
		}

		const screenIdx = parseInt(assignedScreenIdxStr, 10)
		const newDurationSec = hmsControl.wrap.querySelector('[id="hms-hours"]')
			? hmsToSeconds(
				parseInt(hmsControl.wrap.querySelector('[id="hms-hours"]').value, 10) || 0,
				parseInt(hmsControl.wrap.querySelector('[id="hms-minutes"]').value, 10) || 0,
				parseInt(hmsControl.wrap.querySelector('[id="hms-seconds"]').value, 10) || 0
			)
			: durationSec

		const newConfig = {
			...config,
			durationSec: newDurationSec,
			mode: modeSelect.value,
			targetTime: targetTimeInput.value,
			position: positionSelect.value,
			timerFontSize: Math.max(1, Math.min(100, parseInt(sizeInput.value, 10) || DEFAULT_TIMER_CONFIG.timerFontSize)),
		}

		try {
			await api.post('/api/timers/assign', {
				timerId: timer.timerId,
				screenIdx,
				config: newConfig,
			})
			// Refresh to update UI
			setTimeout(() => refreshTimerList(), 100)
		} catch (err) {
			console.warn('[timer-panel] settings save failed:', err?.message || err)
		}
	})
	buttonsRow.appendChild(saveBtn)

	const cancelBtn = document.createElement('button')
	cancelBtn.type = 'button'
	cancelBtn.className = 'timer-control-panel__settings-btn'
	cancelBtn.textContent = 'Cancel'
	cancelBtn.addEventListener('click', () => {
		// Hide settings section
		containerEl.parentElement.style.display = 'none'
	})
	buttonsRow.appendChild(cancelBtn)

	containerEl.appendChild(buttonsRow)
}
