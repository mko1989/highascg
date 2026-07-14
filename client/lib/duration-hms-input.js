/**
 * duration-hms-input.js — Convert between seconds and HH/MM/SS input boxes (WO-186).
 *
 * Pure helpers: secondsToHms / hmsToSeconds (exported for testing).
 * createHmsInput: Factory for a 3-box control (hours 0-99, minutes 0-59, seconds 0-59)
 * that integrates with attachMathInput and onChange callbacks.
 */

import { attachMathInput } from './math-input.js'
import { escapeAttr } from './dom-escape.js'

/**
 * Convert seconds to { hours, minutes, seconds } object.
 * @param {number} totalSeconds
 * @returns {{ hours: number, minutes: number, seconds: number }}
 */
export function secondsToHms(totalSeconds) {
	const n = Math.max(0, Math.floor(totalSeconds || 0))
	const hours = Math.floor(n / 3600)
	const minutes = Math.floor((n % 3600) / 60)
	const seconds = n % 60
	return { hours, minutes, seconds }
}

/**
 * Convert { hours, minutes, seconds } to total seconds.
 * @param {number} hours
 * @param {number} minutes
 * @param {number} seconds
 * @returns {number} - clamped to 0-359999 (99:59:59)
 */
export function hmsToSeconds(hours, minutes, seconds) {
	const h = Math.max(0, Math.min(99, Math.floor(hours || 0)))
	const m = Math.max(0, Math.min(59, Math.floor(minutes || 0)))
	const s = Math.max(0, Math.min(59, Math.floor(seconds || 0)))
	return h * 3600 + m * 60 + s
}

/**
 * Create a 3-input HMS control for duration entry.
 * @param {object} opts
 * @param {number} [opts.value=0] - total seconds to initialize with
 * @param {(seconds: number) => void} [opts.onChange] - called on any input change
 * @returns {{ wrap: HTMLElement, setValue: (seconds: number) => void }}
 */
export function createHmsInput(opts = {}) {
	const { value = 0, onChange } = opts

	const wrap = document.createElement('div')
	wrap.className = 'hms-input'
	wrap.style.display = 'flex'
	wrap.style.gap = '8px'
	wrap.style.alignItems = 'flex-end'

	const { hours: h, minutes: m, seconds: s } = secondsToHms(value)

	// Hours field (0-99)
	const hField = document.createElement('div')
	hField.className = 'inspector-field'
	hField.style.flex = '1'
	hField.innerHTML = `
		<label class="inspector-field__label">HH
			<input type="text" class="inspector-field__input" id="hms-hours" value="${escapeAttr(String(h))}" />
		</label>
	`
	const hInput = hField.querySelector('#hms-hours')
	attachMathInput(hInput, { decimals: 0, min: 0, max: 99 })

	// Minutes field (0-59)
	const mField = document.createElement('div')
	mField.className = 'inspector-field'
	mField.style.flex = '1'
	mField.innerHTML = `
		<label class="inspector-field__label">MM
			<input type="text" class="inspector-field__input" id="hms-minutes" value="${escapeAttr(String(m))}" />
		</label>
	`
	const mInput = mField.querySelector('#hms-minutes')
	attachMathInput(mInput, { decimals: 0, min: 0, max: 59 })

	// Seconds field (0-59)
	const sField = document.createElement('div')
	sField.className = 'inspector-field'
	sField.style.flex = '1'
	sField.innerHTML = `
		<label class="inspector-field__label">SS
			<input type="text" class="inspector-field__input" id="hms-seconds" value="${escapeAttr(String(s))}" />
		</label>
	`
	const sInput = sField.querySelector('#hms-seconds')
	attachMathInput(sInput, { decimals: 0, min: 0, max: 59 })

	wrap.appendChild(hField)
	wrap.appendChild(mField)
	wrap.appendChild(sField)

	function readNum(val, fallback) {
		const n = parseFloat(String(val || ''))
		return Number.isFinite(n) ? n : fallback
	}

	function notifyChange() {
		const hours = readNum(hInput.value, 0)
		const minutes = readNum(mInput.value, 0)
		const seconds = readNum(sInput.value, 0)
		const totalSeconds = hmsToSeconds(hours, minutes, seconds)
		onChange?.(totalSeconds)
	}

	hInput.addEventListener('input', notifyChange)
	mInput.addEventListener('input', notifyChange)
	sInput.addEventListener('input', notifyChange)
	hInput.addEventListener('change', notifyChange)
	mInput.addEventListener('change', notifyChange)
	sInput.addEventListener('change', notifyChange)

	return {
		wrap,
		setValue: (seconds) => {
			const { hours, minutes, seconds: s } = secondsToHms(seconds)
			hInput.value = String(hours)
			mInput.value = String(minutes)
			sInput.value = String(s)
		},
	}
}
