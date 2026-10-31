'use strict'

/**
 * WO-807 — average rectangles of a HASCGSHM v1 surface (a Caspar channel's output, leased through
 * src/system/video-surfaces.js) without reading the whole frame: only the rows the regions sample, and per row only
 * the spans they cover (spans closer than MERGE_GAP_PX are read as one). The slot's seqlock is checked before and
 * after, like hshm-read.js — a frame the writer lapped mid-read is reported, never averaged.
 *
 * WO-916: `average` is a point grid — one sample at the centre of each ~GRID_PX × GRID_PX sub-cell of the region, at
 * most GRID_MAX per axis (a 40 × 16 PixelLine cell → 4 × 2 = 8 samples on 2 rows). Every pixel (WO-807) cost 6.4 ms per
 * frame for the 896 edge strips; the rows are most of it, so 2 rows instead of 16 per cell → ~1.2 ms. `point` takes the
 * region's centre pixel. Pixels are BGRA premultiplied (the channel's output over black — what the screen shows). Pure
 * apart from the injected fs.
 */

const fs = require('fs')
const { ABI, readFully } = require('../tracking/hshm-read')

const GRID_PX = 10
const GRID_MAX = 16
// one pread costs the same (~0.8 µs on the box) up to ~8 KB, so spans up to 1024 px (4 KB) apart are read as one: the
// edge proposal's 896 strips (8 columns × 1792 rows of 3840) went from 10 675 reads / 6.8 ms to 3 577 / 5.1 ms per frame
const MERGE_GAP_PX = 1024
const HEADER_BYTES = 128

/** Sample positions along one axis: n sub-cells of [a, b), each one's centre (integer pixels, ascending). */
function axis(a, b, n) {
	const d = (b - a) / n
	return Array.from({ length: n }, (_, i) => a + Math.floor((i + 0.5) * d))
}

/** One region → { xs, ys } (sample columns / rows) on a width × height raster (clipped), or null when nothing is left. */
function samplingOf(r, width, height) {
	const x0 = Math.max(0, Math.floor(r.x))
	const y0 = Math.max(0, Math.floor(r.y))
	const x1 = Math.min(width, Math.floor(r.x + r.w))
	const y1 = Math.min(height, Math.floor(r.y + r.h))
	if (!(x1 > x0 && y1 > y0)) return null
	if (r.mode === 'point') return { xs: [(x0 + x1 - 1) >> 1], ys: [(y0 + y1 - 1) >> 1] }
	const n = (len) => Math.min(GRID_MAX, Math.max(1, Math.ceil(len / GRID_PX)))
	return { xs: axis(x0, x1, n(x1 - x0)), ys: axis(y0, y1, n(y1 - y0)) }
}

/** regions → { samples, rows: [{ y, spans: [[a, b)], regs: [index] }] } (rows ascending). */
function buildPlan(regions, width, height) {
	const samples = regions.map((r) => samplingOf(r, width, height))
	const byRow = new Map()
	samples.forEach((s, i) => {
		if (!s) return
		for (const y of s.ys) {
			if (!byRow.has(y)) byRow.set(y, [])
			byRow.get(y).push(i)
		}
	})
	const rows = []
	for (const y of [...byRow.keys()].sort((a, b) => a - b)) {
		const regs = byRow.get(y)
		const iv = regs.map((i) => [samples[i].xs[0], samples[i].xs[samples[i].xs.length - 1] + 1]).sort((a, b) => a[0] - b[0])
		const spans = []
		for (const [a, b] of iv) {
			const last = spans[spans.length - 1]
			if (last && a - last[1] <= MERGE_GAP_PX) last[1] = Math.max(last[1], b)
			else spans.push([a, b])
		}
		rows.push({ y, spans, regs })
	}
	return { samples, rows }
}

/** Plain average over an in-memory BGRA frame (tests, and the reference the reader is checked against). */
function averageBgra(pixels, stride, s) {
	let r = 0, g = 0, b = 0, n = 0
	for (const y of s.ys) {
		for (const x of s.xs) {
			const i = y * stride + x * 4
			b += pixels[i]
			g += pixels[i + 1]
			r += pixels[i + 2]
			n++
		}
	}
	return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null
}

/**
 * A sampler for a fixed list of regions ({ x, y, w, h, mode }); the plan is rebuilt only when the surface size changes.
 * read(file, { since }) → { state: 'frame', seq, width, height, colours: ([r, g, b] | null)[], means: unrounded, reads } or
 * { state: 'missing' | 'invalid' | 'none' | 'lapped' }.
 */
function createRegionSampler(regions, { fsImpl = fs } = {}) {
	let plan = null
	let planFor = ''
	let row = Buffer.alloc(0)
	const header = Buffer.alloc(HEADER_BYTES)
	const seqBuf = Buffer.alloc(8)

	function read(file, { since = 0 } = {}) {
		let fd
		try {
			fd = fsImpl.openSync(file, 'r')
		} catch (e) {
			return { state: 'missing', error: e?.code || String(e) }
		}
		try {
			if (!readFully(fsImpl, fd, header, 0) || header.toString('latin1', 0, 8) !== ABI.MAGIC || header.readUInt32LE(8) !== ABI.ABI_VERSION) {
				return { state: 'invalid' }
			}
			const width = header.readUInt32LE(ABI.OFF_WIDTH)
			const height = header.readUInt32LE(ABI.OFF_HEIGHT)
			const stride = header.readUInt32LE(ABI.OFF_STRIDE)
			const latest = header.readBigUInt64LE(ABI.OFF_LATEST)
			const seq = Number(latest >> 8n)
			const slot = Number(latest & 0xffn)
			if (latest === 0n || seq === since) return { state: 'none' }
			if (!width || !height || stride < width * 4 || slot >= ABI.SLOTS) return { state: 'invalid' }
			if (planFor !== `${width}x${height}`) {
				plan = buildPlan(regions, width, height)
				planFor = `${width}x${height}`
			}
			if (row.length < stride) row = Buffer.alloc(stride)
			const base = Number(header.readBigUInt64LE(ABI.OFF_SLOT_OFFSET + 8 * slot))
			const seqOk = () => readFully(fsImpl, fd, seqBuf, base) && seqBuf.readBigUInt64LE(0) === BigInt(2 * seq)
			if (!seqOk()) return { state: 'lapped' }
			const sums = plan.samples.map(() => [0, 0, 0, 0])
			const pix = base + ABI.SLOT_HEADER_SIZE
			let reads = 0
			for (const { y, spans, regs } of plan.rows) {
				for (const [a, b] of spans) {
					if (!readFully(fsImpl, fd, row.subarray(a * 4, b * 4), pix + y * stride + a * 4)) return { state: 'invalid' }
					reads++
				}
				for (const i of regs) {
					const s = plan.samples[i]
					const acc = sums[i]
					for (const x of s.xs) {
						const o = x * 4
						acc[2] += row[o]
						acc[1] += row[o + 1]
						acc[0] += row[o + 2]
					}
					acc[3] += s.xs.length
				}
			}
			if (!seqOk()) return { state: 'lapped' }
			// WO-893: the unrounded means feed the smoothing (pixel-map-smooth.js); `colours` stays the rounded ints of WO-807
			const means = sums.map((a) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : null))
			const colours = means.map((m) => (m ? [Math.round(m[0]), Math.round(m[1]), Math.round(m[2])] : null))
			return { state: 'frame', seq, width, height, colours, means, reads }
		} finally {
			fsImpl.closeSync(fd)
		}
	}

	return { read, plan: () => plan }
}

const peekBuf = Buffer.alloc(8)

/** WO-897: a surface's latest frame seq from its header alone (0 = none / no segment) — the watcher's cheap per-poll check. */
function peekSeq(file, { fsImpl = fs } = {}) {
	let fd
	try {
		fd = fsImpl.openSync(file, 'r')
	} catch {
		return 0
	}
	try {
		return readFully(fsImpl, fd, peekBuf, ABI.OFF_LATEST) ? Number(peekBuf.readBigUInt64LE(0) >> 8n) : 0
	} finally {
		fsImpl.closeSync(fd)
	}
}

module.exports = { GRID_MAX, samplingOf, buildPlan, averageBgra, createRegionSampler, peekSeq }
