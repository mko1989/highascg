'use strict'

/**
 * WO-616 T13b — one still from a HASCGSHM v1 video surface (caspar/modules/shm/hshm_abi.h; Python mirror
 * tools/hshm-bridge/hshm_abi.py). Positional reads, no mmap: the server grabs a single frame now and then (beam-spot
 * detection) — and the WO-670 video feed polls it 10–25×/s from a worker thread for remote clients; on-box streams
 * stay with the sidecar and the Godot `hshm` GDExtension. The slot's seqlock is
 * read before and after the pixels, so a frame the writer lapped mid-read is reported, never returned.
 */

const fs = require('fs')

const MAGIC = 'HASCGSHM'
const ABI_VERSION = 1
const SLOTS = 3
const SLOT_HEADER_SIZE = 4096
const OFF_WIDTH = 16
const OFF_HEIGHT = 20
const OFF_STRIDE = 24
const OFF_SLOT_OFFSET = 48
const OFF_LATEST = 96

function readFully(fsImpl, fd, buf, pos) {
	let got = 0
	while (got < buf.length) {
		const n = fsImpl.readSync(fd, buf, got, buf.length - got, pos + got)
		if (n <= 0) break
		got += n
	}
	return got === buf.length
}

/**
 * → { state: 'frame', seq, width, height, stride, pixels (BGRA premultiplied) } or { state: 'missing' | 'invalid' |
 * 'none' | 'lapped', error? }. `since`: a seq already seen — that frame again reads as 'none'. `into`: a Buffer to
 * read the pixels into when it is big enough (WO-670 video feed reads 15×/s; `pixels` is then a view of it).
 */
function readLatestFrame(file, { since = 0, fsImpl = fs, into = null } = {}) {
	let fd
	try {
		fd = fsImpl.openSync(file, 'r')
	} catch (e) {
		return { state: 'missing', error: e?.code || String(e) }
	}
	try {
		const h = Buffer.alloc(128)
		if (!readFully(fsImpl, fd, h, 0) || h.toString('latin1', 0, 8) !== MAGIC || h.readUInt32LE(8) !== ABI_VERSION) {
			return { state: 'invalid' }
		}
		const width = h.readUInt32LE(OFF_WIDTH)
		const height = h.readUInt32LE(OFF_HEIGHT)
		const stride = h.readUInt32LE(OFF_STRIDE)
		const latest = h.readBigUInt64LE(OFF_LATEST)
		const seq = Number(latest >> 8n)
		const slot = Number(latest & 0xffn)
		if (!width || !height || stride < width * 4 || slot >= SLOTS) return { state: latest === 0n ? 'none' : 'invalid' }
		if (latest === 0n || seq === since) return { state: 'none' }
		const base = Number(h.readBigUInt64LE(OFF_SLOT_OFFSET + 8 * slot))
		const s = Buffer.alloc(8)
		const seqOk = () => readFully(fsImpl, fd, s, base) && s.readBigUInt64LE(0) === BigInt(2 * seq)
		if (!seqOk()) return { state: 'lapped' }
		const pixels = into && into.length >= stride * height ? into.subarray(0, stride * height) : Buffer.alloc(stride * height)
		if (!readFully(fsImpl, fd, pixels, base + SLOT_HEADER_SIZE)) return { state: 'invalid' }
		if (!seqOk()) return { state: 'lapped' }
		return { state: 'frame', seq, width, height, stride, pixels }
	} finally {
		fsImpl.closeSync(fd)
	}
}

module.exports = { readLatestFrame, readFully, ABI: { MAGIC, ABI_VERSION, SLOTS, SLOT_HEADER_SIZE, OFF_WIDTH, OFF_HEIGHT, OFF_STRIDE, OFF_SLOT_OFFSET, OFF_LATEST } } // WO-807: pixel-map-frame.js reads rows of the same rings
