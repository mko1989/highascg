/**
 * Modular VU Meter component — visualizes audio levels from OSC data.
 * @see WO-08 T2.1
 */

'use strict'

function dbToPct(db) {
	if (!Number.isFinite(db)) return 0
	// -60dB to 0dB scale
	return Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
}

/**
 * @param {HTMLElement} parent - Container element
 * @param {object} options
 * @param {number} [options.channels=2] - Number of bars (1 or 2)
 * @param {string} [options.orientation='vertical'] - 'vertical' or 'horizontal'
 * @param {string} [options.label] - Optional label
 * @param {() => { l: number, r: number }} options.getLevels - Callback to get current dB levels
 */
export function createVuMeter(parent, options = {}) {
	const { channels = 2, orientation = 'vertical', label = '' } = options

	const root = document.createElement('div')
	root.className = `vu-meter vu-meter--${orientation} vu-meter--${channels}ch`
	
	let html = ''
	if (label) html += `<span class="vu-meter__label">${label}</span>`
	html += '<div class="vu-meter__bars">'
	for (let i = 0; i < channels; i++) {
		html += `<div class="vu-meter__bar"><i></i></div>`
	}
	html += '</div>'
	root.innerHTML = html
	parent.appendChild(root)

	const bars = root.querySelectorAll('.vu-meter__bar i')
	let rafId = null

	function update() {
		const { l, r } = options.getLevels()
		if (bars[0]) bars[0].style[orientation === 'vertical' ? 'height' : 'width'] = `${dbToPct(l)}%`
		if (bars[1]) bars[1].style[orientation === 'vertical' ? 'height' : 'width'] = `${dbToPct(r)}%`
		
		// Peak hold and other visual logic could go here
		
		rafId = requestAnimationFrame(update)
	}

	rafId = requestAnimationFrame(update)

	return {
		updateOptions(newOpts) {
			Object.assign(options, newOpts)
		},
		destroy() {
			if (rafId) cancelAnimationFrame(rafId)
			root.remove()
		}
	}
}
