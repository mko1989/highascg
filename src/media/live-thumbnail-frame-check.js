/**
 * WO-887 — is a captured live-thumbnail frame worth keeping, or is it black?
 *
 * Caspar PRINTs 8-bit RGBA PNGs at channel resolution. An idle channel / a DeckLink input with no signal
 * prints fully transparent black (alpha 0) and an audio-only channel prints opaque black; both compress to
 * ~10 KB at 1080p, a real picture to MBs. File size alone is not a safe test (a dark slate with a small
 * logo also compresses well), so the frame is decoded and sampled on a sparse grid (~160 samples across):
 * luminance is multiplied by alpha, because transparent pixels show as black on every consumer.
 *
 * A frame is NOT black when either the mean premultiplied luma reaches MEAN_MIN or at least
 * BRIGHT_FRACTION_MIN of the samples are brighter than BRIGHT_LUMA (white titles on black count).
 * Decoding is async (pngjs inflate off the event loop); one 1080p frame costs ~50 ms in total.
 */
'use strict'

const { PNG } = require('pngjs')

const BRIGHT_LUMA = 24
const BRIGHT_FRACTION_MIN = 0.001
const MEAN_MIN = 6
const SAMPLES_ACROSS = 160

/**
 * Pure: classify decoded RGBA pixels.
 * @param {Uint8Array|Buffer} data — RGBA, row-major
 * @param {number} width
 * @param {number} height
 * @returns {{ black: boolean, mean: number, brightFraction: number }}
 */
function classifyRgbaFrame(data, width, height) {
	const w = Math.max(0, width | 0)
	const h = Math.max(0, height | 0)
	if (!w || !h || !data || data.length < w * h * 4) return { black: true, mean: 0, brightFraction: 0 }
	const step = Math.max(1, Math.floor(w / SAMPLES_ACROSS))
	let n = 0
	let sum = 0
	let bright = 0
	for (let y = Math.floor(step / 2); y < h; y += step) {
		for (let x = Math.floor(step / 2); x < w; x += step) {
			const i = (y * w + x) * 4
			const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * (data[i + 3] / 255)
			sum += luma
			if (luma > BRIGHT_LUMA) bright += 1
			n += 1
		}
	}
	const mean = n ? sum / n : 0
	const brightFraction = n ? bright / n : 0
	return { black: !(mean >= MEAN_MIN || brightFraction >= BRIGHT_FRACTION_MIN), mean, brightFraction }
}

/**
 * Decode a PNG and classify it. Never throws: an undecodable PNG counts as black (not worth keeping).
 * @param {Buffer} buf
 * @returns {Promise<{ black: boolean, mean: number, brightFraction: number, error?: string }>}
 */
function analyzeThumbnailFrame(buf) {
	return new Promise((resolve) => {
		try {
			new PNG().parse(buf, (err, png) => {
				if (err || !png) {
					resolve({ black: true, mean: 0, brightFraction: 0, error: err?.message || 'PNG decode failed' })
					return
				}
				resolve(classifyRgbaFrame(png.data, png.width, png.height))
			})
		} catch (e) {
			resolve({ black: true, mean: 0, brightFraction: 0, error: e?.message || String(e) })
		}
	})
}

module.exports = {
	classifyRgbaFrame,
	analyzeThumbnailFrame,
}
