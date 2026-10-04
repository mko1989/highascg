/**
 * WO-592 — waveform strip + timecode helpers for the media-file inspector.
 */

/**
 * @param {number} sec
 * @param {number} fps
 * @returns {string} `m:ss.ff` (or `h:mm:ss.ff`)
 */
export function formatMediaTimecode(sec, fps) {
	const f = Math.max(1, Math.round(Number(fps) || 25))
	const totalFrames = Math.max(0, Math.floor((Number(sec) || 0) * f))
	const ff = totalFrames % f
	const s = Math.floor(totalFrames / f)
	const m = Math.floor(s / 60)
	const h = Math.floor(m / 60)
	const pad = (n) => String(n).padStart(2, '0')
	return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}.${pad(ff)}` : `${m}:${pad(s % 60)}.${pad(ff)}`
}

/**
 * Mirrored peak bars, played part tinted, plus a playhead line.
 * @param {HTMLCanvasElement} canvas
 * @param {number[] | null} peaks - 0..1
 * @param {number} progress - 0..1
 */
export function drawMediaWaveform(canvas, peaks, progress) {
	const dpr = window.devicePixelRatio || 1
	const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
	const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
	if (canvas.width !== w) canvas.width = w
	if (canvas.height !== h) canvas.height = h
	const ctx = canvas.getContext('2d')
	if (!ctx) return
	ctx.clearRect(0, 0, w, h)
	const css = getComputedStyle(canvas)
	const base = css.getPropertyValue('--media-insp-wave').trim() || '#6e7681'
	const played = css.getPropertyValue('--media-insp-wave-played').trim() || '#58a6ff'
	const p = Math.min(1, Math.max(0, Number(progress) || 0))
	const mid = h / 2
	if (Array.isArray(peaks) && peaks.length) {
		const n = peaks.length
		for (let x = 0; x < w; x++) {
			const v = Math.min(1, Math.max(0, Number(peaks[Math.min(n - 1, Math.floor((x / w) * n))]) || 0))
			const bh = Math.max(1, v * (h - 2))
			ctx.fillStyle = x / w <= p ? played : base
			ctx.fillRect(x, mid - bh / 2, 1, bh)
		}
	}
	if (p > 0) {
		ctx.fillStyle = played
		ctx.fillRect(Math.round(p * w) - Math.round(dpr), 0, Math.max(1, Math.round(2 * dpr)), h)
	}
}
