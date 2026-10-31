'use strict'

/**
 * WO-898: the video mode of an audio-only Caspar channel (live ALSA input, extra audio output, monitor bus).
 *
 * Such a channel's picture is never looked at, but Caspar still composites and reads back its whole raster every
 * tick (every channel carries the meter-null consumer — src/audio/meter-null-consumer.js), so 1080p50 costs
 * 8.3 MB × 50/s of GPU readback for nothing. Its AUDIO, however, travels over `route://` to/from the PGM buses, and
 * route_producer drops or repeats frames (and their audio) when the two channels tick at different rates — the
 * WO-237/WO-406 "25 Hz chop". So the mode is: the smallest sane raster, at exactly the rate of the main channels.
 *
 * 64x36 rather than the owner's 1x1 (both proven in Caspar, see the WO): same cost to within noise, but 16:9 so
 * layer/multiview fits computed from the channel's INFO CONFIG resolution stay what they were, and even in both
 * axes so a yuv420 recorder attached to the channel still opens. `WxH` id so pixelSizeForVideoMode and
 * resolutionFromVideoModeString parse it; the rate lives only in the generated `<video-modes>` block.
 */

const AUDIO_ONLY_MODE_WIDTH = 64
const AUDIO_ONLY_MODE_HEIGHT = 36
const AUDIO_ONLY_MODE_ID = `${AUDIO_ONLY_MODE_WIDTH}x${AUDIO_ONLY_MODE_HEIGHT}`

/**
 * The NTSC-family rates as Caspar's own standard modes define them (core/video_format.cpp): N*1000/1001 with a
 * cadence list. server.cpp rejects a custom mode unless sum(cadence) * time-scale == 48000 * duration * len.
 */
const FRACTIONAL_RATES = [
	{ base: 24, cadence: [2002] },
	{ base: 30, cadence: [1602, 1601, 1602, 1601, 1602] },
	{ base: 60, cadence: [801, 800, 801, 801, 801] },
]

/**
 * Exact Caspar timing for a frame rate, or null when no valid 48 kHz cadence is known for it.
 * 50 → 50000/1000 [960]; 25 → 25000/1000 [1920]; 59.94 → 60000/1001 [801,800,801,801,801].
 * @param {number} fps
 * @returns {{ timeScale: number, duration: number, cadence: number[], fps: number } | null}
 */
function videoModeTiming(fps) {
	const f = Number(fps)
	if (!Number.isFinite(f) || f <= 0) return null
	for (const r of FRACTIONAL_RATES) {
		const exact = (r.base * 1000) / 1001
		if (Math.abs(f - exact) < 0.01) return { timeScale: r.base * 1000, duration: 1001, cadence: r.cadence.slice(), fps: exact }
	}
	const timeScale = Math.round(f * 1000)
	const samples = (48000 * 1000) / timeScale
	if (!Number.isInteger(samples)) return null
	return { timeScale, duration: 1000, cadence: [samples], fps: timeScale / 1000 }
}

/**
 * Dims (plan-entry shape, plus exact timing for the `<video-modes>` emitter) of the audio-only mode at `fps`.
 * A rate with no valid cadence (or no rate) falls back to 50 — Caspar refuses to start on a bad cadence.
 * @param {number} [fps] rate of the channels this audio channel exchanges route:// frames with
 */
function audioOnlyModeDimensions(fps) {
	const t = videoModeTiming(fps) || videoModeTiming(50)
	return {
		width: AUDIO_ONLY_MODE_WIDTH,
		height: AUDIO_ONLY_MODE_HEIGHT,
		fps: t.fps,
		modeId: AUDIO_ONLY_MODE_ID,
		isCustom: true,
		timeScale: t.timeScale,
		duration: t.duration,
		cadence: t.cadence,
	}
}

module.exports = {
	AUDIO_ONLY_MODE_ID,
	videoModeTiming,
	audioOnlyModeDimensions,
}
