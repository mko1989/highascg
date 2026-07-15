/**
 * Timer control panel — display-time computation + default config (pure helpers, no DOM).
 * Extracted from timer-control-panel.js (WO-221 Phase A mechanical split).
 */

/**
 * Default timer config (mirrors scene-state-timers.js DEFAULT_TIMER_CONFIG).
 */
export const DEFAULT_TIMER_CONFIG = {
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
export function computeDisplayTime(timerRecord) {
	if (!timerRecord) return 0
	const { config = {}, lastCmd, cmdAt, durationSec, remainingSec } = timerRecord
	const mode = config.mode || 'duration'
	const now = Date.now()

	if (mode === 'duration') {
		if (lastCmd === 'pause') {
			// FIX-5 (2026-07-15 review, timers finding 3): show the server-computed frozen
			// remaining time (recordTimerPause) instead of snapping back to the full configured
			// duration. Falls back to config when the server hasn't provided it (older record).
			if (Number.isFinite(remainingSec)) return remainingSec
			return durationSec || config.durationSec || 0
		}
		if (lastCmd === 'start' && Number.isFinite(cmdAt)) {
			// FIX-5: a resume-from-pause uses the frozen remainingSec as its basis instead of
			// the full configured duration.
			const basis = Number.isFinite(remainingSec) ? remainingSec : durationSec || config.durationSec || 0
			const elapsedSec = (now - cmdAt) / 1000
			const remaining = basis - elapsedSec
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
export function formatDisplayTime(seconds) {
	const sign = seconds < 0 ? '-' : ''
	const abs = Math.abs(Math.trunc(seconds))
	const h = Math.floor(abs / 3600)
	const m = Math.floor((abs % 3600) / 60)
	const s = abs % 60
	const pad = (n) => String(n).padStart(2, '0')
	return sign + pad(h) + ':' + pad(m) + ':' + pad(s)
}
