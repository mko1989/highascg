'use strict'

/**
 * WO-734 — the main video on each program screen: the topmost playing clip in the live bank that is not looped. A looped
 * clip is a background and is never timed. The layer rules match the kiosk PGM timer (pgm_timer_model.gd): the timer
 * band, the border layer, routes and layers Caspar stopped reporting on are skipped.
 */

const TIMER_BAND = [980, 989]
const BORDER_LAYER = 998
const STALE_MS = 12000

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** @param {unknown} ly  one OSC snapshot layer */
function timing(ly, now) {
	if (!ly || typeof ly !== 'object' || ly.type !== 'ffmpeg') return null
	if (Number.isFinite(ly._lastOscAt) && now - ly._lastOscAt > STALE_MS) return null
	const f = ly.file || {}
	const duration = num(f.duration)
	const elapsed = num(f.elapsed)
	if (f.loop === true || !(duration > 0) || elapsed === null) return null
	const remaining = num(f.remaining) ?? Math.max(0, duration - elapsed)
	const label = String(f.name || f.path || '').split('/').pop()
	return { label, elapsed_s: elapsed, remaining_s: remaining, duration_s: duration, paused: ly.paused === true }
}

/**
 * @param {{ channels?: Record<string, { layers?: Record<string, object> }> }} snapshot  ctx.oscState.getSnapshot()
 * @param {{ programChannels?: number[], screenLabels?: string[] }} channelMap
 * @param {Record<string, unknown>} [banks]  ctx.programLayerBankByChannel
 * @param {number} [now]
 */
function mainVideos(snapshot, channelMap, banks, now = Date.now()) {
	const out = []
	const pgm = Array.isArray(channelMap?.programChannels) ? channelMap.programChannels : []
	pgm.forEach((ch, i) => {
		const layers = snapshot?.channels?.[ch]?.layers || {}
		const [lo, hi] = String(banks?.[ch] ?? 'a') === 'b' ? [110, 199] : [10, 99]
		const nums = Object.keys(layers)
			.map(Number)
			.filter((n) => n >= lo && n <= hi && !(n >= TIMER_BAND[0] && n <= TIMER_BAND[1]) && n !== BORDER_LAYER)
			.sort((a, b) => b - a)
		for (const n of nums) {
			const t = timing(layers[n], now)
			if (!t) continue
			out.push({ screen: String(channelMap.screenLabels?.[i] || `Screen ${i + 1}`), channel: ch, layer: n, ...t })
			break
		}
	})
	return out
}

module.exports = { mainVideos, STALE_MS }
