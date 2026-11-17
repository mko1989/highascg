'use strict'

/**
 * WO-1082 — the venue's textures for a phone (moved into the core by WO-1098: the venue importer shares it, and the core
 * never reaches into an opt-in module; the game's rc-scene-tex.js hands this file on): each image the kept geometry uses is re-encoded smaller by ffmpeg in a
 * child process (the server's event loop never decodes a 4032 × 3024 PNG itself), JPEG unless the PNG has an alpha
 * channel. Budget (TEX_BUDGET, on top of the geometry's MAX_BYTES): every image starts at MAX_EDGE px on its long
 * edge, then the largest one is halved until the sum fits (never below MIN_EDGE); still over → the textures are
 * left out (the materials keep their colours). Identical images (same bytes) are encoded once.
 *
 *   shrinkImages(images: [{ data, mime } | { load() → Promise<{ data, mime } | null> }], { encode?, budget?, maxEdge?, pause? })
 *     → Promise<[{ data, mime, w, edge } | null]>   (`load`: read on demand, one picture in memory at a time — WO-1106 B5)
 *   encode(data, mime, edge) → Promise<{ data, mime } | null> (default: ffmpeg; smokes inject their own)
 *   ffmpegMeanColor({ data, mime }) → Promise<[r, g, b] linear | null> (rc-scene-venue.js flattenHeavyTextures)
 *   stopAll() → n: kill this thread's running ffmpeg children and refuse new ones (WO-1106 B20: the venue import worker's
 *     cancel — a terminated worker would orphan them). Never called on the main thread (the game shares this module).
 */

const crypto = require('crypto')
const { spawn } = require('child_process')

const TEX_BUDGET = 1.5 * 1024 * 1024
const MAX_EDGE = 1024
const MIN_EDGE = 128
const ENCODE_MS = 20000

const live = new Set() // { p, timer } of every running ffmpeg child (WO-1106 B20)
let stopped = false

/** ffmpeg as a tracked child: the timer kills a stuck one; stopAll() kills them all. → the ChildProcess, or null. */
function track(args) {
	if (stopped) return null
	const p = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'] })
	const c = { p, timer: setTimeout(() => p.kill('SIGKILL'), ENCODE_MS) }
	live.add(c)
	p.on('close', () => {
		clearTimeout(c.timer)
		live.delete(c)
	})
	return p
}

function stopAll() {
	stopped = true
	const n = live.size
	for (const c of live) {
		clearTimeout(c.timer)
		try {
			c.p.kill('SIGKILL')
		} catch {
			/* already gone */
		}
	}
	live.clear()
	return n
}

/** A PNG whose colour type carries alpha (4 grey + alpha, 6 RGBA) or a tRNS chunk. */
function pngHasAlpha(buf) {
	if (!(buf.length > 33 && buf.readUInt32BE(0) === 0x89504e47)) return false
	const ct = buf[25]
	if (ct === 4 || ct === 6) return true
	return buf.indexOf('tRNS', 33, 'latin1') > 0 && buf.indexOf('tRNS', 33, 'latin1') < buf.indexOf('IDAT', 33, 'latin1')
}

/** ffmpeg: one image (stdin) → the same picture with its long edge ≤ `edge` (stdout), JPEG or PNG (alpha). */
function ffmpegEncode(data, mime, edge) {
	const alpha = mime === 'image/png' && pngHasAlpha(data)
	const args = ['-hide_banner', '-v', 'error', '-f', mime === 'image/png' ? 'png_pipe' : 'jpeg_pipe', '-i', 'pipe:0',
		'-vf', `scale=w='min(iw,${edge})':h='min(ih,${edge})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
		'-frames:v', '1', ...(alpha ? ['-c:v', 'png'] : ['-c:v', 'mjpeg', '-q:v', '4', '-pix_fmt', 'yuvj420p']), '-f', 'image2pipe', 'pipe:1']
	return new Promise((resolve) => {
		let p
		try {
			p = track(args)
		} catch {
			p = null
		}
		if (!p) return void resolve(null)
		const out = []
		p.on('error', () => resolve(null))
		p.stdout.on('data', (d) => out.push(d))
		p.stdin.on('error', () => {})
		p.on('close', (code) => {
			const buf = Buffer.concat(out)
			resolve(code === 0 && buf.length > 16 ? { data: buf, mime: alpha ? 'image/png' : 'image/jpeg' } : null)
		})
		p.stdin.end(data)
	})
}

/** ffmpeg: one image → its mean colour, linear [r, g, b] (area-averaged to 1 × 1 px, sRGB decoded); null on failure. */
function ffmpegMeanColor(im) {
	if (!im?.data?.length) return Promise.resolve(null)
	const args = ['-hide_banner', '-v', 'error', '-f', im.mime === 'image/png' ? 'png_pipe' : 'jpeg_pipe', '-i', 'pipe:0',
		'-vf', 'scale=1:1:flags=area', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
	return new Promise((resolve) => {
		let p
		try {
			p = track(args)
		} catch {
			p = null
		}
		if (!p) return void resolve(null)
		const out = []
		p.on('error', () => resolve(null))
		p.stdout.on('data', (d) => out.push(d))
		p.stdin.on('error', () => {})
		p.on('close', (code) => {
			const b = Buffer.concat(out)
			const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
			resolve(code === 0 && b.length >= 3 ? [lin(b[0] / 255), lin(b[1] / 255), lin(b[2] / 255)] : null)
		})
		p.stdin.end(im.data)
	})
}

/** The long edge of a PNG / JPEG (0 when unknown). */
function edgeOf(buf) {
	if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return Math.max(buf.readUInt32BE(16), buf.readUInt32BE(20))
	for (let i = 2; i + 9 < buf.length; ) {
		if (buf[i] !== 0xff) return 0
		const m = buf[i + 1]
		if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return Math.max(buf.readUInt16BE(i + 5), buf.readUInt16BE(i + 7))
		i += 2 + buf.readUInt16BE(i + 2)
	}
	return 0
}

/**
 * Images (index-aligned, null allowed) → the shrunk ones (null = left out). Encodes run one at a time; a `load` image is
 * read when it is encoded and let go after (a re-encode reads it again), so only one source picture is held at a time.
 * @param {({ data: Buffer, mime: string } | { load: () => Promise<{ data: Buffer, mime: string } | null> } | null)[]} images
 */
async function shrinkImages(images, o = {}) {
	const encode = o.encode || ffmpegEncode
	const budget = o.budget ?? TEX_BUDGET
	const maxEdge = o.maxEdge || MAX_EDGE
	const pause = o.pause || (() => new Promise((r) => setImmediate(r)))
	const uniq = new Map() // hash → { src, edge, out }
	const run = async (u, got) => {
		const s = got || (u.src.load ? await u.src.load() : u.src)
		u.out = (s?.data?.length && (await encode(s.data, s.mime, u.edge).catch(() => null))) || null
		await pause()
	}
	const keyOf = []
	for (const im of images) {
		const got = im?.load ? await im.load() : im
		if (!got?.data?.length) {
			keyOf.push(null)
			continue
		}
		const h = crypto.createHash('sha1').update(got.data).digest('hex')
		keyOf.push(h)
		if (uniq.has(h)) continue
		const u = { src: im.load ? im : got, edge: Math.min(maxEdge, edgeOf(got.data) || maxEdge), out: null }
		uniq.set(h, u)
		await run(u, got)
	}
	const total = () => [...uniq.values()].reduce((s, u) => s + (u.out ? u.out.data.length : 0), 0)
	while (total() > budget) {
		const big = [...uniq.values()].filter((u) => u.out && u.edge > MIN_EDGE).sort((a, b) => b.out.data.length - a.out.data.length)[0]
		if (!big) break
		big.edge = Math.max(MIN_EDGE, Math.floor(big.edge / 2))
		await run(big)
	}
	if (total() > budget) return images.map(() => null)
	return keyOf.map((h) => {
		const u = h ? uniq.get(h) : null
		return u?.out ? { ...u.out, edge: u.edge, key: h } : null
	})
}

module.exports = { TEX_BUDGET, MAX_EDGE, shrinkImages, ffmpegEncode, ffmpegMeanColor, edgeOf, stopAll }
