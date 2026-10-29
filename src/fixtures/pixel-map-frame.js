'use strict'

/**
 * WO-807 — average rectangles of a HASCGSHM v1 surface (a Caspar channel's output, leased through
 * src/system/video-surfaces.js) without reading the whole frame: only the rows the regions sample, and per row only
 * the spans they cover (spans closer than MERGE_GAP_PX are read as one). The slot's seqlock is checked before and
 * after, like hshm-read.js — a frame the writer lapped mid-read is reported, never averaged.
 *
 * Averaging is exact (every pixel) up to 4 × MAX_SAMPLES pixels per region; above that a uniform stride keeps between
 * MAX_SAMPLES and 4 × MAX_SAMPLES samples, each at the centre of its stride cell. `point` takes the region's centre pixel. Pixels are BGRA
 * premultiplied (the channel's output over black — what the screen shows). Pure apart from the injected fs.
 */

const fs = require('fs')
const { ABI, readFully } = require('../tracking/hshm-read')

const MAX_SAMPLES = 65536
// one pread costs the same (~0.8 µs on the box) up to ~8 KB, so spans up to 1024 px (4 KB) apart are read as one: the
// edge proposal's 896 strips (8 columns × 1792 rows of 3840) went from 10 675 reads / 6.8 ms to 3 577 / 5.1 ms per frame
const MERGE_GAP_PX = 1024
const HEADER_BYTES = 128

/** One region → { x0, y0, step, nx, ny } on a width × height raster (clipped), or null when nothing is left. */
function samplingOf(r, width, height) {
	const x0 = Math.max(0, Math.floor(r.x))
	const y0 = Math.max(0, Math.floor(r.y))
	const x1 = Math.min(width, Math.floor(r.x + r.w))
	const y1 = Math.min(height, Math.floor(r.y + r.h))
	if (!(x1 > x0 && y1 > y0)) return null
	if (r.mode === 'point') return { x0: (x0 + x1 - 1) >> 1, y0: (y0 + y1 - 1) >> 1, step: 1, nx: 1, ny: 1 }
	const area = (x1 - x0) * (y1 - y0)
	const step = Math.max(1, Math.floor(Math.sqrt(area / MAX_SAMPLES))) // samples stay in [MAX_SAMPLES, ~4 × MAX_SAMPLES)
	const off = step >> 1
	const sx = Math.min(x1 - 1, x0 + off)
	const sy = Math.min(y1 - 1, y0 + off)
	return { x0: sx, y0: sy, step, nx: Math.ceil((x1 - sx) / step), ny: Math.ceil((y1 - sy) / step) }
}

/** regions → { samples, rows: [{ y, spans: [[a, b)], regs: [index] }] } (rows ascending). */
function buildPlan(regions, width, height) {
	const samples = regions.map((r) => samplingOf(r, width, height))
	const byRow = new Map()
	samples.forEach((s, i) => {
		if (!s) return
		for (let k = 0; k < s.ny; k++) {
			const y = s.y0 + k * s.step
			if (!byRow.has(y)) byRow.set(y, [])
			byRow.get(y).push(i)
		}
	})
	const rows = []
	for (const y of [...byRow.keys()].sort((a, b) => a - b)) {
		const regs = byRow.get(y)
		const iv = regs.map((i) => [samples[i].x0, samples[i].x0 + (samples[i].nx - 1) * samples[i].step + 1]).sort((a, b) => a[0] - b[0])
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
	for (let k = 0; k < s.ny; k++) {
		const row = (s.y0 + k * s.step) * stride
		for (let j = 0; j < s.nx; j++) {
			const i = row + (s.x0 + j * s.step) * 4
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
 * read(file, { since }) → { state: 'frame', seq, width, height, colours: ([r, g, b] | null)[], reads } or
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
					for (let j = 0, x = s.x0; j < s.nx; j++, x += s.step) {
						const o = x * 4
						acc[2] += row[o]
						acc[1] += row[o + 1]
						acc[0] += row[o + 2]
					}
					acc[3] += s.nx
				}
			}
			if (!seqOk()) return { state: 'lapped' }
			const colours = sums.map((a) => (a[3] ? [Math.round(a[0] / a[3]), Math.round(a[1] / a[3]), Math.round(a[2] / a[3])] : null))
			return { state: 'frame', seq, width, height, colours, reads }
		} finally {
			fsImpl.closeSync(fd)
		}
	}

	return { read, plan: () => plan }
}

module.exports = { MAX_SAMPLES, samplingOf, buildPlan, averageBgra, createRegionSampler }
