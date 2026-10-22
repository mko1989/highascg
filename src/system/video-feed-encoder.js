'use strict'

/**
 * WO-670 P1 — one shared-memory video surface → a stream of JPEG frames, for clients that are not on the box (the
 * Godot GUI on a laptop reads /dev/shm only when it runs next to the server).
 *
 * Each encoder polls its HASCGSHM segment at `fps` and hands a NEW frame to one long-lived ffmpeg (rawvideo BGRA on
 * stdin → MJPEG on stdout, scaled down to `width`) only while ffmpeg has nothing in flight — a slow client or a busy
 * box drops frames instead of queueing latency. Runs inside the video-feed worker thread (video-feed-worker.js), so
 * the 8 MB-per-frame reads never touch the server's main thread. Pure enough to test: spawn / read / timers are injected.
 */

const { spawn: realSpawn } = require('child_process')
const { readLatestFrame } = require('../tracking/hshm-read')

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])

/** Clamp the client's ask into what the box will do for it. */
function feedParams({ width, fps, quality } = {}) {
	const n = (v, d, lo, hi) => {
		const x = Math.round(Number(v))
		return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d
	}
	return { width: n(width, 960, 160, 1920), fps: n(fps, 15, 1, 30), quality: n(quality, 5, 2, 20) }
}

/** ffmpeg arguments for one input size (even output height, never upscaled). */
function ffmpegArgs(w, h, p) {
	return [
		'-hide_banner',
		'-loglevel',
		'error',
		// one thread each side: with frame threading ffmpeg 6.1 holds every frame until the NEXT arrives, and the
		// one-in-flight pacing below would then wait forever (measured: first JPEG after write 2 without, write 1 with)
		'-threads',
		'1',
		'-f',
		'rawvideo',
		'-pix_fmt',
		'bgra',
		'-s',
		`${w}x${h}`,
		'-framerate',
		String(p.fps),
		'-i',
		'pipe:0',
		'-vf',
		`scale='min(${p.width},iw)':-2:flags=bilinear`,
		'-fps_mode',
		'passthrough',
		'-threads',
		'1',
		'-pix_fmt',
		'yuvj420p',
		'-q:v',
		String(p.quality),
		'-flush_packets',
		'1',
		'-f',
		'image2pipe',
		'-vcodec',
		'mjpeg',
		'pipe:1',
	]
}

/**
 * Splits an MJPEG byte stream into whole JPEGs. Entropy-coded JPEG data stuffs every 0xFF with 0x00, so the only
 * FF D9 in an ffmpeg-made frame is its end marker.
 */
function createJpegSplitter(onJpeg) {
	let acc = Buffer.alloc(0)
	return (chunk) => {
		acc = acc.length ? Buffer.concat([acc, chunk]) : chunk
		for (;;) {
			const start = acc.indexOf(SOI)
			if (start < 0) {
				acc = Buffer.alloc(0)
				return
			}
			const end = acc.indexOf(EOI, start + 2)
			if (end < 0) {
				if (start > 0) acc = acc.subarray(start)
				return
			}
			onJpeg(Buffer.from(acc.subarray(start, end + 2)))
			acc = acc.subarray(end + 2)
		}
	}
}

/**
 * @param {{ role: string, path: string, params: object, onFrame: (f: {role, jpeg, seq}) => void,
 *   spawn?: Function, read?: Function, setInterval?: Function, clearInterval?: Function, log?: Function }} o
 */
function createEncoder(o) {
	const spawn = o.spawn || realSpawn
	const read = o.read || readLatestFrame
	const every = o.setInterval || setInterval
	const stop = o.clearInterval || clearInterval
	const log = o.log || (() => {})
	let params = feedParams(o.params)
	let proc = null
	let size = ''
	let inflight = 0
	let lastSeq = 0
	let seqOut = []
	let buf = null
	let timer = null
	let closed = false

	function kill() {
		if (!proc) return
		const p = proc
		proc = null
		size = ''
		inflight = 0
		seqOut = []
		try {
			p.stdin.end()
		} catch {}
		try {
			p.kill('SIGKILL')
		} catch {}
	}

	function start(w, h) {
		kill()
		const p = spawn('ffmpeg', ffmpegArgs(w, h, params), { stdio: ['pipe', 'pipe', 'pipe'] })
		proc = p
		size = `${w}x${h}`
		const split = createJpegSplitter((jpeg) => {
			if (proc !== p) return
			inflight = Math.max(0, inflight - 1)
			o.onFrame({ role: o.role, jpeg, seq: seqOut.shift() || 0 })
		})
		p.stdout.on('data', split)
		p.stderr.on('data', (d) => log('warn', `[video-feed] ${o.role} ffmpeg: ${String(d).trim().slice(0, 200)}`))
		p.stdin.on('error', () => {})
		p.on('exit', () => {
			if (proc === p) {
				proc = null
				size = ''
				inflight = 0
			}
		})
	}

	function tick() {
		if (closed || inflight > 0) return
		const f = read(o.path, { since: lastSeq, into: buf })
		if (f.state !== 'frame') return
		lastSeq = f.seq
		const need = f.width * 4 * f.height
		if (!buf || buf.length < f.stride * f.height) buf = Buffer.alloc(f.stride * f.height)
		let px = f.pixels
		if (f.stride !== f.width * 4) {
			const packed = Buffer.alloc(need)
			for (let y = 0; y < f.height; y++) px.copy(packed, y * f.width * 4, y * f.stride, y * f.stride + f.width * 4)
			px = packed
		}
		if (size !== `${f.width}x${f.height}` || !proc) start(f.width, f.height)
		inflight++
		seqOut.push(f.seq)
		proc.stdin.write(Buffer.from(px.subarray(0, need)))
	}

	function retune(next) {
		const p = feedParams(next)
		if (p.fps === params.fps && p.width === params.width && p.quality === params.quality) return
		params = p
		kill()
		if (timer) stop(timer)
		timer = every(tick, Math.round(1000 / params.fps))
	}

	timer = every(tick, Math.round(1000 / params.fps))
	return {
		retune,
		tick,
		close() {
			closed = true
			if (timer) stop(timer)
			timer = null
			kill()
		},
		get params() {
			return params
		},
	}
}

module.exports = { createEncoder, createJpegSplitter, feedParams, ffmpegArgs }
