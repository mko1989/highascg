/**
 * Volume scale: UI / scene storage uses linear gain (0–1).
 * Caspar AMCP `MIXER … VOLUME` expects decibels (0 = unity, negative = quieter).
 */

/** Matches audio mixer view fader scale (−∞ … +6 dB). */
export const VOLUME_MIN_DB = -60
export const VOLUME_MAX_DB = 6

/** @param {number} gain linear 0–1 */
export function linearGainToCasparDb(gain) {
	const g = Number(gain)
	if (!Number.isFinite(g) || g <= 0) return VOLUME_MIN_DB
	const db = 20 * Math.log10(g)
	return Math.max(VOLUME_MIN_DB, Math.min(VOLUME_MAX_DB, db))
}

export function casparDbToLinearGain(db) {
	const d = Number(db)
	if (!Number.isFinite(d) || d <= VOLUME_MIN_DB) return 0
	return Math.pow(10, Math.min(VOLUME_MAX_DB, d) / 20)
}

/** @param {number} gain linear 0–1 */
export function formatVolumeDb(gain) {
	const db = linearGainToCasparDb(gain)
	if (db <= VOLUME_MIN_DB + 0.05) return '−∞'
	const sign = db > 0 ? '+' : ''
	return `${sign}${db.toFixed(1)} dB`
}

const FADER_CURVE = [
	{ percent: 100, db: 6 },
	{ percent: 83.333, db: 0 },
	{ percent: 66.667, db: -6 },
	{ percent: 50, db: -12 },
	{ percent: 33.333, db: -24 },
	{ percent: 16.667, db: -48 },
	{ percent: 0, db: VOLUME_MIN_DB }
]

/**
 * Fader 0–100: piecewise logarithmic taper matching UI markers.
 * @param {number} percent
 */
export function faderPercentToLinearGain(percent) {
	const p = Math.max(0, Math.min(100, Number(percent) || 0))
	if (p <= 0) return 0
	let db = VOLUME_MIN_DB
	for (let i = 0; i < FADER_CURVE.length - 1; i++) {
		const upper = FADER_CURVE[i]
		const lower = FADER_CURVE[i+1]
		if (p >= lower.percent) {
			const t = (p - lower.percent) / (upper.percent - lower.percent)
			db = lower.db + t * (upper.db - lower.db)
			break
		}
	}
	return casparDbToLinearGain(db)
}

/** @param {number} gain linear */
export function linearGainToFaderPercent(gain) {
	const g = Number(gain)
	if (!Number.isFinite(g) || g <= 0) return 0
	const db = linearGainToCasparDb(g)
	if (db <= VOLUME_MIN_DB) return 0
	for (let i = 0; i < FADER_CURVE.length - 1; i++) {
		const upper = FADER_CURVE[i]
		const lower = FADER_CURVE[i+1]
		if (db >= lower.db) {
			const t = (db - lower.db) / (upper.db - lower.db)
			return Math.round(lower.percent + t * (upper.percent - lower.percent))
		}
	}
	return 100
}

export function volumeApiPayload(linearGain) {
	const maxGain = casparDbToLinearGain(VOLUME_MAX_DB)
	const volume = Math.max(0, Math.min(maxGain, Number(linearGain) || 0))
	return {
		volume,
		volumeDb: linearGainToCasparDb(volume),
	}
}
