import { linearGainToFaderPercent } from './audio-volume-scale.js'

/** Linear gain at 0 dB (unity) on the mixer fader scale. */
export const UNITY_LINEAR_GAIN = 1

export function unityFaderPercent() {
	return linearGainToFaderPercent(UNITY_LINEAR_GAIN)
}

/**
 * Double-click or Ctrl/Cmd+click resets fader to 0 dB.
 * The dblclick must not bubble on: app-range-dblclick.js resets every range on the page to its HTML `value` attribute
 * (the gain at render time) and re-posts that — the fader landed back where it was rendered (WO-604).
 * @param {HTMLInputElement} fader
 * @param {() => void} onReset
 */
export function bindFaderResetGestures(fader, onReset) {
	if (!fader || typeof onReset !== 'function') return
	fader.addEventListener('dblclick', (e) => {
		e.preventDefault()
		e.stopPropagation()
		onReset()
	})
	fader.addEventListener('pointerdown', (e) => {
		if (!e.metaKey && !e.ctrlKey) return
		e.preventDefault()
		onReset()
	})
}
