import { linearGainToFaderPercent } from './audio-volume-scale.js'

/** Linear gain at 0 dB (unity) on the mixer fader scale. */
export const UNITY_LINEAR_GAIN = 1

export function unityFaderPercent() {
	return linearGainToFaderPercent(UNITY_LINEAR_GAIN)
}

/**
 * Double-click or Ctrl/Cmd+click resets fader to 0 dB.
 * @param {HTMLInputElement} fader
 * @param {() => void} onReset
 */
export function bindFaderResetGestures(fader, onReset) {
	if (!fader || typeof onReset !== 'function') return
	fader.addEventListener('dblclick', (e) => {
		e.preventDefault()
		onReset()
	})
	fader.addEventListener('pointerdown', (e) => {
		if (!e.metaKey && !e.ctrlKey) return
		e.preventDefault()
		onReset()
	})
}
