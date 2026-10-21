'use strict'

/**
 * WO-616 T13b — find a moving head's beam spot in a camera still (instead of the operator clicking it or dropping
 * a marker on it). Pure: frames in (hshm-read.js), a pixel out; calibrate-spot.js maps it onto the floor.
 *
 *   lumaGrid(frames)   BGRA frames → one luma grid sampled every STEP pixels, averaged over the frames (noise)
 *   findBeamSpot(grid, { ref })
 *       the brightest point, its blob (4-connected, ≥ halfway between the picture's median and the peak) and the
 *       blob's weighted centre. With `ref` (a grid taken with the beam off / aimed away) only what got BRIGHTER
 *       counts, so LED walls and lit scenery drop out. Refused when nothing stands out (contrast < minContrast) or
 *       the blob is too big to be a spot; `ambiguous` when a second, separate area is nearly as bright.
 */

const STEP = 2

function lumaGrid(frames, step = STEP) {
	const f0 = frames[0]
	const w = Math.floor(f0.width / step)
	const h = Math.floor(f0.height / step)
	const sum = new Uint16Array(w * h)
	const used = frames.filter((f) => f.width === f0.width && f.height === f0.height)
	for (const f of used) {
		const px = f.pixels
		for (let y = 0; y < h; y++) {
			let o = y * step * f.stride
			const row = y * w
			for (let x = 0; x < w; x++, o += step * 4) sum[row + x] += (29 * px[o] + 150 * px[o + 1] + 77 * px[o + 2]) >> 8
		}
	}
	const v = new Uint8Array(w * h)
	for (let i = 0; i < v.length; i++) v[i] = Math.round(sum[i] / used.length)
	return { w, h, step, width: f0.width, height: f0.height, v }
}

function median(d) {
	const hist = new Uint32Array(256)
	for (let i = 0; i < d.length; i++) hist[d[i]]++
	let acc = 0
	for (let b = 0; b < 256; b++) if ((acc += hist[b]) * 2 >= d.length) return b
	return 255
}

function findBeamSpot(grid, { ref = null, minContrast = 40, maxAreaFrac = 0.02 } = {}) {
	const { w, h, step } = grid
	const n = w * h
	const useRef = !!ref && ref.w === w && ref.h === h
	const d = useRef ? new Uint8Array(n) : grid.v
	if (useRef) for (let i = 0; i < n; i++) d[i] = Math.max(0, grid.v[i] - ref.v[i])
	let peak = 0
	let at = 0
	for (let i = 0; i < n; i++) if (d[i] > peak) (peak = d[i]), (at = i)
	const med = median(d)
	const contrast = peak - med
	const base = { peak, median: med, contrast, reference: useRef }
	if (contrast < minContrast) return { ok: false, ...base, reason: 'no spot stands out of the picture — is the beam on and in view?' }
	const thr = med + contrast / 2
	const blob = new Uint8Array(n)
	const stack = [at]
	blob[at] = 1
	let area = 0, sw = 0, sx = 0, sy = 0
	let x0 = w, y0 = h, x1 = 0, y1 = 0
	while (stack.length) {
		const i = stack.pop()
		const x = i % w, y = (i - x) / w
		const wt = d[i] - thr + 1
		area++, (sw += wt), (sx += wt * x), (sy += wt * y)
		if (x < x0) x0 = x
		if (x > x1) x1 = x
		if (y < y0) y0 = y
		if (y > y1) y1 = y
		for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
			if (j >= 0 && !blob[j] && d[j] >= thr) (blob[j] = 1), stack.push(j)
		}
	}
	if (area > maxAreaFrac * n) {
		return { ok: false, ...base, area: area * step * step, reason: 'the brightest area is too large for a beam spot (a lit wall or screen?) — take a reference with the beam off' }
	}
	// a second spot: the brightest point outside the blob's box grown by its own size
	const gx = Math.max(x1 - x0, y1 - y0) + 2
	let second = 0
	for (let y = 0; y < h; y++) {
		const near = y >= y0 - gx && y <= y1 + gx
		for (let x = 0; x < w; x++) {
			if (near && x >= x0 - gx && x <= x1 + gx) continue
			if (d[y * w + x] > second) second = d[y * w + x]
		}
	}
	const px = [((sx / sw) + 0.5) * step, ((sy / sw) + 0.5) * step].map((v) => Math.round(v * 10) / 10)
	return { ok: true, ...base, px, area: area * step * step, second, ambiguous: second - med >= 0.8 * contrast }
}

module.exports = { STEP, lumaGrid, findBeamSpot }
