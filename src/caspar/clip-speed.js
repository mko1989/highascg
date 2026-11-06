'use strict'

/**
 * WO-973 — per-layer clip playback speed. This Caspar build has no SPEED / CALL SPEED (ffmpeg_producer.cpp only knows
 * LOOP/IN/OUT/LENGTH/SEEK/SEEKABLE + FILTER/VF/AF), so speed is two libavfilter chains given at LOAD time:
 * VF `setpts=(PTS-STARTPTS)/x+STARTPTS` (video; keeping the first pts so the producer's fps/start_time stage still lines up with SEEK/IN) and AF `atempo=x` (audio, pitch kept). IN / SEEK stay in the clip's own time; LENGTH / OUT are measured in OUTPUT time (probed 06.11), so LENGTH is divided by the speed.
 */

const SPEED_MIN = 0.25
const SPEED_MAX = 4

/** @returns {number | null} a usable speed (≠ 1, clamped into 0.25–4), else null = normal speed */
function normalizeSpeed(v) {
	const n = Number(v)
	if (v == null || v === '' || !Number.isFinite(n) || n <= 0) return null
	const c = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(n * 100) / 100))
	return Math.abs(c - 1) < 0.0005 ? null : c
}

/** atempo takes 0.5–100 per instance (older ffmpeg: 0.5–2): chain 0.5 stages below 0.5 so 0.25× works everywhere. */
function atempoChain(speed) {
	const parts = []
	let s = speed
	while (s < 0.5 - 1e-9) {
		parts.push('atempo=0.5')
		s /= 0.5
	}
	parts.push(`atempo=${+s.toFixed(4)}`)
	return parts.join(',')
}

const join = (a, b) => [a, b].filter(Boolean).join(',')

/** Appends the speed filters to the layer's own video / audio filters. → { videoFilter?, audioFilter? } (empty = no speed) */
function speedFilters(speed, filter, audioFilter) {
	const s = normalizeSpeed(speed)
	if (s == null) return {}
	return { videoFilter: join(filter, `setpts=(PTS-STARTPTS)/${s}+STARTPTS`), audioFilter: join(audioFilter, atempoChain(s)), speed: s }
}

/** Speed only means something for a plain video file (no stills, routes, templates, HTML, NDI, shm, timelines). */
function clipSupportsSpeed(clip) {
	const c = String(clip || '').trim().replace(/^"|"$/g, '')
	if (!c || /^(route|ndi|shm|http|https):\/\//i.test(c) || c.startsWith('[HTML]')) return false
	const m = c.match(/\.([A-Za-z0-9]{2,5})$/)
	if (m && /^(png|jpe?g|gif|bmp|webp|tga|tiff?|svg|html?|ft|wt|swf)$/i.test(m[1])) return false
	return true
}

/** LENGTH (channel frames of clip time) → what Caspar needs under speed: output time = clip time / speed. */
function scaleLength(length, speed) {
	const s = normalizeSpeed(speed)
	if (length == null || s == null) return length
	return Math.max(1, Math.round(Number(length) / s))
}

module.exports = { scaleLength, normalizeSpeed, atempoChain, speedFilters, clipSupportsSpeed }
