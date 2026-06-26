import * as audioMixerState from '../lib/audio-mixer-state.js'
import {
	faderPercentToLinearGain,
	formatVolumeDb,
	linearGainToFaderPercent,
} from '../lib/audio-volume-scale.js'

export function syncFaderUI(key, percent) {
	const selectors = [
		`input[data-key="${key}"].audio-mixer__fader-horizontal`,
		`input[data-key="${key}"].audio-mixer__fader-vertical`,
		`input[data-key="${key}"].audio-mixer-view__fader`,
	]
	const pct = String(percent)
	const gain = faderPercentToLinearGain(percent)
	const label = formatVolumeDb(gain)
	const faders = document.querySelectorAll(selectors.join(', '))
	faders.forEach((f) => {
		if (f.value !== pct) {
			f.value = pct
			const parent = f.closest('.audio-mixer__bus-master, .audio-mixer__bus-layer, .audio-mixer-view__strip')
			if (parent) {
				const valEl = parent.querySelector('.audio-mixer__fader-val, .audio-mixer-view__fader-val')
				if (valEl) valEl.textContent = label
			}
		}
	})
}

/** @param {string} key @param {number} linearGain 0–1 */
export function syncFaderUIFromGain(key, linearGain) {
	syncFaderUI(key, linearGainToFaderPercent(linearGain))
}

export function syncMuteUI(key, muted) {
	const btnCompact = document.querySelector(`.audio-mixer__mute-btn[data-key="${key}"]`)
	const btnBig = document.querySelector(`.audio-mixer-view__mute-btn[data-key="${key}"]`)
	if (btnCompact) {
		if (muted) btnCompact.classList.add('audio-mixer__mute-btn--active')
		else btnCompact.classList.remove('audio-mixer__mute-btn--active')
	}
	if (btnBig) {
		if (muted) btnBig.classList.add('audio-mixer-view__mute-btn--active')
		else btnBig.classList.remove('audio-mixer-view__mute-btn--active')
	}
}

export function syncAllSolosUI() {
	const allBtns = document.querySelectorAll('.audio-mixer__solo-btn, .audio-mixer-view__solo-btn')
	allBtns.forEach((btn) => {
		const k = btn.dataset.key
		const activeClass = btn.classList.contains('audio-mixer__solo-btn')
			? 'audio-mixer__solo-btn--active'
			: 'audio-mixer-view__solo-btn--active'
		if (audioMixerState.isSoloed(k)) {
			btn.classList.add(activeClass)
		} else {
			btn.classList.remove(activeClass)
		}
	})
}
