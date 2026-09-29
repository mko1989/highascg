/**
 * Timer control panel — per-timer settings form (duration/mode/target-time/position + save/cancel).
 * Extracted from timer-control-panel.js (WO-221 Phase A mechanical split).
 *
 * WO-381 (owner 2026-07-29: "positioning of the timer doesnt work. inputing anything in x or y
 * doesnt do anything"): position — preset and the X/Y pixel override — now applies the moment you
 * leave the field, instead of waiting for Save. The whole pipeline underneath was verified sound
 * (config → CG UPDATE → template padding, probed on the running Caspar); what could lose the entry
 * was this form being re-created by the panel's 1s poll while it was being typed into.
 * Save also fans out to every assigned screen now — it used to write only the first.
 */

import { createHmsInput, hmsToSeconds } from '../lib/duration-hms-input.js'
import { DEFAULT_TIMER_CONFIG } from './timer-control-panel-display.js'
import { saveTimerConfigPatch } from './timer-control-panel-inline-time.js'

/**
 * Build settings section for a timer.
 * @param {HTMLElement} containerEl
 * @param {object} timer
 * @param {{ refreshTimerList: () => void, extended?: boolean }} deps - `extended: true` adds the
 *   Font/Color fields (screen-timer Inspector only — the compact dock deliberately omits them,
 *   per the owner: "only in the 'big' settings, the compact ones should stay as is")
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

	// Font + color — WO todos10.09.26: "add font and color settings so the timer can be
	// customized. only in the 'big' settings, the compact ones should stay as is." Gated on
	// deps.extended so the corner dock (timer-control-panel.js, the owner's own "compact timer")
	// keeps its current fields untouched; only the screen-timer Inspector ("full inspector",
	// WO-226) opts in.
	let fontSelect = null
	let timerColorInput = null
	let amberColorInput = null
	let redColorInput = null
	let borderWidthInput = null
	let borderColorInput = null
	if (deps?.extended) {
		const fontLabel = document.createElement('div')
		fontLabel.className = 'timer-control-panel__settings-label'
		fontLabel.style.marginTop = '4px'
		fontLabel.textContent = 'Font'
		containerEl.appendChild(fontLabel)

		fontSelect = document.createElement('select')
		fontSelect.className = 'timer-control-panel__settings-select'
		fontSelect.style.cssText = 'width:100%;padding:2px 4px'
		const FONT_OPTIONS = [
			['', 'Default (Arial)'],
			["'Arial', 'Helvetica Neue', sans-serif", 'Arial'],
			["'Helvetica Neue', Helvetica, sans-serif", 'Helvetica Neue'],
			["'Verdana', sans-serif", 'Verdana'],
			["'Trebuchet MS', sans-serif", 'Trebuchet MS'],
			["'Georgia', serif", 'Georgia'],
			["'Times New Roman', serif", 'Times New Roman'],
			["'Courier New', monospace", 'Courier New'],
			["'Impact', sans-serif", 'Impact'],
		]
		for (const [value, label] of FONT_OPTIONS) {
			const opt = document.createElement('option')
			opt.value = value
			opt.textContent = label
			fontSelect.appendChild(opt)
		}
		fontSelect.value = config.timerFontFamily || ''
		containerEl.appendChild(fontSelect)

		const colorField = (rowEl, labelText, value) => {
			const wrap = document.createElement('div')
			wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px'
			const lab = document.createElement('span')
			lab.className = 'timer-control-panel__settings-label'
			lab.textContent = labelText
			const inp = document.createElement('input')
			inp.type = 'color'
			inp.style.cssText = 'width:100%;padding:0;height:22px'
			inp.value = value
			wrap.append(lab, inp)
			rowEl.appendChild(wrap)
			return inp
		}

		const colorRow = document.createElement('div')
		colorRow.style.cssText = 'display:flex;gap:4px;margin-top:4px'
		timerColorInput = colorField(colorRow, 'Color', config.timerColor || DEFAULT_TIMER_CONFIG.timerColor)
		amberColorInput = colorField(colorRow, 'Amber', config.amberColor || DEFAULT_TIMER_CONFIG.amberColor)
		redColorInput = colorField(colorRow, 'Red', config.redColor || DEFAULT_TIMER_CONFIG.redColor)
		containerEl.appendChild(colorRow)

		// Border — WO todos10.09.26 follow-up: "timer font with border around characters"
		// (-webkit-text-stroke; 0 = off, matches the pre-existing look exactly).
		const borderRow = document.createElement('div')
		borderRow.style.cssText = 'display:flex;gap:4px;margin-top:4px'
		const borderWidthWrap = document.createElement('div')
		borderWidthWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px'
		const borderWidthLab = document.createElement('span')
		borderWidthLab.className = 'timer-control-panel__settings-label'
		borderWidthLab.textContent = 'Border (px)'
		borderWidthInput = document.createElement('input')
		borderWidthInput.type = 'number'
		borderWidthInput.min = '0'
		borderWidthInput.max = '20'
		borderWidthInput.step = '1'
		borderWidthInput.className = 'timer-control-panel__settings-input'
		borderWidthInput.style.cssText = 'width:100%;padding:2px 4px'
		borderWidthInput.value = String(config.timerBorderWidth ?? DEFAULT_TIMER_CONFIG.timerBorderWidth ?? 0)
		borderWidthWrap.append(borderWidthLab, borderWidthInput)
		borderRow.appendChild(borderWidthWrap)
		borderColorInput = colorField(borderRow, 'Border color', config.timerBorderColor || DEFAULT_TIMER_CONFIG.timerBorderColor)
		containerEl.appendChild(borderRow)
	}

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

	// WO-320A: pixel-precise override — both set → anchors content top-left at (X, Y); empty = preset.
	const pxRow = document.createElement('div')
	pxRow.style.cssText = 'display:flex;gap:4px;margin-top:4px'
	const posXInput = document.createElement('input')
	posXInput.type = 'number'
	posXInput.className = 'timer-control-panel__settings-input'
	posXInput.placeholder = 'X px'
	posXInput.title = 'Pixel X (empty = use preset)'
	posXInput.style.cssText = 'width:50%;padding:2px 4px'
	posXInput.value = config.posX ?? ''
	const posYInput = document.createElement('input')
	posYInput.type = 'number'
	posYInput.className = 'timer-control-panel__settings-input'
	posYInput.placeholder = 'Y px'
	posYInput.title = 'Pixel Y (empty = use preset)'
	posYInput.style.cssText = 'width:50%;padding:2px 4px'
	posYInput.value = config.posY ?? ''
	pxRow.append(posXInput, posYInput)
	containerEl.appendChild(pxRow)

	const pxNote = document.createElement('div')
	pxNote.className = 'timer-control-panel__settings-note'
	pxNote.textContent = 'X and Y together override the preset — clear both to go back to it.'
	containerEl.appendChild(pxNote)

	// WO-381: position applies on change, so it lands whether or not Save is pressed. Both px
	// fields go together — the template only anchors when BOTH are numbers.
	const readPx = (el) => (String(el.value).trim() === '' ? '' : Math.round(Number(el.value)))
	async function applyPositionNow(patch) {
		try {
			await saveTimerConfigPatch(timer, patch)
			Object.assign(config, patch)
			refreshTimerList?.()
		} catch (err) {
			console.warn('[timer-panel] position apply failed:', err?.message || err)
		}
	}
	for (const el of [posXInput, posYInput]) {
		el.addEventListener('change', () => void applyPositionNow({ posX: readPx(posXInput), posY: readPx(posYInput) }))
	}
	positionSelect.addEventListener('change', () => void applyPositionNow({ position: positionSelect.value }))

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
			posX: posXInput.value.trim() === '' ? '' : Math.round(Number(posXInput.value)),
			posY: posYInput.value.trim() === '' ? '' : Math.round(Number(posYInput.value)),
			timerFontSize: Math.max(1, Math.min(100, parseInt(sizeInput.value, 10) || DEFAULT_TIMER_CONFIG.timerFontSize)),
			...(fontSelect ? { timerFontFamily: fontSelect.value } : null),
			...(timerColorInput ? { timerColor: timerColorInput.value } : null),
			...(amberColorInput ? { amberColor: amberColorInput.value } : null),
			...(redColorInput ? { redColor: redColorInput.value } : null),
			...(borderWidthInput ? { timerBorderWidth: Math.max(0, Math.min(20, parseInt(borderWidthInput.value, 10) || 0)) } : null),
			...(borderColorInput ? { timerBorderColor: borderColorInput.value } : null),
		}

		try {
			// WO-381: every assigned screen, not just the first — each one needs its own CG UPDATE.
			await saveTimerConfigPatch(timer, newConfig)
			Object.assign(config, newConfig)
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
