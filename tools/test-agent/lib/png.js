'use strict'

/**
 * WO-836 Part 3c — PNG decode / crop / stats / encode with node's zlib only (no image libraries on the box).
 * Handles what Caspar's PRINT writes and what ffmpeg writes: 8-bit gray / RGB / RGBA / gray+alpha, non-interlaced.
 * PRINT frames are RGBA: the ALPHA plane is reported separately, because a frame can look right in RGB while its
 * alpha is all 0 (or the reverse) — the stats must say so rather than hide it (calibrate-pixel-probes memory).
 */

const zlib = require('zlib')

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }

function paeth(a, b, c) {
	const p = a + b - c
	const pa = Math.abs(p - a)
	const pb = Math.abs(p - b)
	const pc = Math.abs(p - c)
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** @param {Buffer} buf @returns {{width:number,height:number,channels:number,data:Buffer}} data = raw samples, row-major */
function decodePng(buf) {
	if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file')
	let pos = 8
	let ihdr = null
	const idat = []
	while (pos + 8 <= buf.length) {
		const len = buf.readUInt32BE(pos)
		const type = buf.toString('latin1', pos + 4, pos + 8)
		const body = buf.subarray(pos + 8, pos + 8 + len)
		if (type === 'IHDR') ihdr = body
		else if (type === 'IDAT') idat.push(body)
		else if (type === 'IEND') break
		pos += 12 + len
	}
	if (!ihdr) throw new Error('PNG has no IHDR')
	const width = ihdr.readUInt32BE(0)
	const height = ihdr.readUInt32BE(4)
	const depth = ihdr[8]
	const ctype = ihdr[9]
	if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth} (need 8)`)
	if (ihdr[12] !== 0) throw new Error('interlaced PNG not supported')
	const channels = CHANNELS[ctype]
	if (!channels) throw new Error(`unsupported PNG colour type ${ctype} (palette PNGs are not produced by Caspar)`)
	const raw = zlib.inflateSync(Buffer.concat(idat))
	const stride = width * channels
	if (raw.length < (stride + 1) * height) throw new Error('PNG data is truncated')
	const data = Buffer.alloc(stride * height)
	for (let y = 0; y < height; y++) {
		const f = raw[y * (stride + 1)]
		const src = y * (stride + 1) + 1
		const dst = y * stride
		for (let i = 0; i < stride; i++) {
			const x = raw[src + i]
			const a = i >= channels ? data[dst + i - channels] : 0
			const b = y > 0 ? data[dst - stride + i] : 0
			const c = y > 0 && i >= channels ? data[dst - stride + i - channels] : 0
			let v
			if (f === 0) v = x
			else if (f === 1) v = x + a
			else if (f === 2) v = x + b
			else if (f === 3) v = x + ((a + b) >> 1)
			else if (f === 4) v = x + paeth(a, b, c)
			else throw new Error(`bad PNG filter ${f}`)
			data[dst + i] = v & 255
		}
	}
	return { width, height, channels, data }
}

/** Crop with a hard bounds check — ffmpeg's crop silently CLAMPS x when x+w exceeds the width; we refuse instead. */
function cropImage(img, { x, y, w, h }) {
	if (x + w > img.width || y + h > img.height) {
		throw new Error(`crop ${x},${y},${w},${h} exceeds the ${img.width}x${img.height} frame (x+w=${x + w}, y+h=${y + h}) — pick a box inside the frame`)
	}
	const out = Buffer.alloc(w * h * img.channels)
	for (let r = 0; r < h; r++) {
		img.data.copy(out, r * w * img.channels, ((y + r) * img.width + x) * img.channels, ((y + r) * img.width + x + w) * img.channels)
	}
	return { width: w, height: h, channels: img.channels, data: out }
}

const r1 = (n) => Math.round(n * 100) / 100

/**
 * @param {{width,height,channels,data}} img
 * @param {{ threshold?: number }} [o] a pixel counts as non-black when its brightest colour channel exceeds `threshold` (default 16)
 */
function stats(img, o = {}) {
	const th = o.threshold ?? 16
	const { width, height, channels, data } = img
	const n = width * height
	let sr = 0
	let sg = 0
	let sb = 0
	let sa = 0
	let sl = 0
	let nonblack = 0
	let opaque = 0
	const hasA = channels === 4 || channels === 2
	for (let i = 0; i < n; i++) {
		const p = i * channels
		let r
		let g
		let b
		if (channels >= 3) {
			r = data[p]
			g = data[p + 1]
			b = data[p + 2]
		} else {
			r = g = b = data[p]
		}
		sr += r
		sg += g
		sb += b
		sl += 0.2126 * r + 0.7152 * g + 0.0722 * b
		if (Math.max(r, g, b) > th) nonblack++
		if (hasA) {
			const a = data[p + channels - 1]
			sa += a
			if (a > 0) opaque++
		}
	}
	const out = {
		width,
		height,
		mean_luma: r1(sl / n),
		mean_rgb: [r1(sr / n), r1(sg / n), r1(sb / n)],
		nonblack_fraction: Math.round((nonblack / n) * 10000) / 10000,
		nonblack_threshold: th,
	}
	if (hasA) {
		out.mean_alpha = r1(sa / n)
		out.alpha_nonzero_fraction = Math.round((opaque / n) * 10000) / 10000
		if (opaque === 0) out.alpha_note = 'alpha plane is ALL ZERO — RGB stats are still valid for the picture, but do not read this as a transparent frame without looking at the shot'
	}
	return out
}

let crcTable
function crc32(buf) {
	if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
	if (!crcTable) {
		crcTable = new Uint32Array(256)
		for (let n = 0; n < 256; n++) {
			let c = n
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
			crcTable[n] = c >>> 0
		}
	}
	let c = 0xffffffff
	for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
	const t = Buffer.from(type, 'latin1')
	const len = Buffer.alloc(4)
	len.writeUInt32BE(body.length)
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(Buffer.concat([t, body])))
	return Buffer.concat([len, t, body, crc])
}

/** Encode raw samples (filter 0) — used to save a cropped frame the agent can open with Read. */
function encodePng({ width, height, channels, data }) {
	const ctype = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels]
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8
	ihdr[9] = ctype
	const stride = width * channels
	const raw = Buffer.alloc((stride + 1) * height)
	for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
	return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

module.exports = { decodePng, cropImage, stats, encodePng }
