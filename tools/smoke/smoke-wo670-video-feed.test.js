'use strict'

/**
 * WO-670 P1 — JPEG video feed for remote Godot clients: encoder pieces, subscription merge, wire framing, and (when
 * ffmpeg is installed) one real shm segment → JPEG round-trip.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { spawnSync } = require('child_process')

const { createEncoder, createJpegSplitter, feedParams, ffmpegArgs } = require('../../src/system/video-feed-encoder')
const { createVideoFeed, frameMessage, wantedSurfaces } = require('../../src/system/video-feed')
const { readLatestFrame } = require('../../src/tracking/hshm-read')

function writeSegment(file, { width, height, stride, pixels }, seq) {
	const slotSize = Math.ceil((4096 + stride * height) / 4096) * 4096
	const buf = Buffer.alloc(4096 + 3 * slotSize)
	buf.write('HASCGSHM', 0, 'latin1')
	buf.writeUInt32LE(1, 8)
	buf.writeUInt32LE(4096, 12)
	buf.writeUInt32LE(width, 16)
	buf.writeUInt32LE(height, 20)
	buf.writeUInt32LE(stride, 24)
	for (let s = 0; s < 3; s++) buf.writeBigUInt64LE(BigInt(4096 + s * slotSize), 48 + 8 * s)
	const slot = seq % 3
	const base = 4096 + slot * slotSize
	buf.writeBigUInt64LE(BigInt(2 * seq), base)
	pixels.copy(buf, base + 4096)
	buf.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot), 96)
	fs.writeFileSync(file, buf)
}

function fakeProc() {
	const p = new EventEmitter()
	p.stdout = new EventEmitter()
	p.stderr = new EventEmitter()
	p.written = []
	p.stdin = Object.assign(new EventEmitter(), { write: (b) => p.written.push(b), end() {} })
	p.kill = () => {
		p.killed = true
	}
	return p
}

const JPEG = (n) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])])

describe('WO-670 P1 video-feed encoder pieces', () => {
	it('feedParams clamps the client ask and defaults junk', () => {
		assert.deepEqual(feedParams(), { width: 960, fps: 15, quality: 5 })
		assert.deepEqual(feedParams({ width: 99999, fps: 0, quality: 'x' }), { width: 1920, fps: 1, quality: 5 })
		assert.deepEqual(feedParams({ width: '640', fps: '25', quality: 1 }), { width: 640, fps: 25, quality: 2 })
	})

	it('ffmpegArgs: raw BGRA in, never-upscaled MJPEG out', () => {
		const a = ffmpegArgs(3840, 2160, feedParams({ width: 960 })).join(' ')
		assert.match(a, /-f rawvideo -pix_fmt bgra -s 3840x2160/)
		assert.match(a, /scale='min\(960,iw\)':-2/)
		assert.match(a, /-f image2pipe -vcodec mjpeg pipe:1$/)
	})

	it('the splitter rebuilds whole JPEGs from arbitrary chunks', () => {
		const got = []
		const split = createJpegSplitter((j) => got.push(j.length))
		const stream = Buffer.concat([Buffer.from([1, 2]), JPEG(10), JPEG(300)])
		for (let i = 0; i < stream.length; i += 7) split(stream.subarray(i, i + 7))
		assert.deepEqual(got, [14, 304])
	})

	it('readLatestFrame reads into a caller buffer when it fits', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo670-'))
		const file = path.join(dir, 'seg')
		writeSegment(file, { width: 4, height: 2, stride: 16, pixels: Buffer.alloc(32, 9) }, 3)
		const into = Buffer.alloc(64)
		const f = readLatestFrame(file, { into })
		assert.equal(f.state, 'frame')
		assert.equal(f.pixels.buffer, into.buffer, 'a view of the caller buffer')
		assert.equal(into[0], 9)
		fs.rmSync(dir, { recursive: true, force: true })
	})

	it('one frame in flight at a time; a new size restarts ffmpeg; stride padding is packed away', () => {
		const procs = []
		let seq = 0
		let w = 2
		const frames = []
		const enc = createEncoder({
			role: 'opgui',
			path: '/x',
			params: { fps: 10 },
			spawn: (cmd, args) => {
				const p = fakeProc()
				p.args = args
				procs.push(p)
				return p
			},
			read: () => ({ state: 'frame', seq: ++seq, width: w, height: 1, stride: 16, pixels: Buffer.alloc(16, seq) }),
			setInterval: () => 1,
			clearInterval: () => {},
			onFrame: (f) => frames.push(f),
		})
		enc.tick()
		enc.tick()
		assert.equal(procs.length, 1)
		assert.equal(procs[0].written.length, 1, 'second tick skipped: ffmpeg still busy')
		assert.equal(procs[0].written[0].length, 8, '2 px × 4 B, padding dropped')
		procs[0].stdout.emit('data', JPEG(4))
		assert.deepEqual(
			frames.map((f) => [f.role, f.seq]),
			[['opgui', 1]]
		)
		w = 3
		enc.tick()
		assert.equal(procs.length, 2, 'size change → new ffmpeg')
		assert.ok(procs[0].killed)
		assert.match(procs[1].args.join(' '), /-s 3x1/)
		enc.close()
		assert.ok(procs[1].killed)
	})
})

describe('WO-670 P1 video-feed subscriptions', () => {
	it('frameMessage = [u8 n][role][jpeg]', () => {
		const m = frameMessage('pgm1', JPEG(1))
		assert.equal(m[0], 4)
		assert.equal(m.toString('latin1', 1, 5), 'pgm1')
		assert.deepEqual([...m.subarray(5, 7)], [0xff, 0xd8])
	})

	it('a role several clients want is encoded once, at the most demanding params', () => {
		const w = wantedSurfaces([
			{ roles: new Set(['a', 'b']), params: { width: 640, fps: 10, quality: 8 } },
			{ roles: new Set(['a']), params: { width: 1280, fps: 5, quality: 4 } },
		])
		assert.deepEqual(w.get('a'), { width: 1280, fps: 10, quality: 4 })
		assert.deepEqual(w.get('b'), { width: 640, fps: 10, quality: 8 })
	})

	it('worker lives only while someone watches; bad roles dropped; slow clients skip frames', () => {
		const workers = []
		const feed = createVideoFeed({
			makeWorker: () => {
				const wk = Object.assign(new EventEmitter(), {
					posted: [],
					postMessage: (m) => wk.posted.push(m),
					terminate: () => (wk.dead = true),
				})
				workers.push(wk)
				return wk
			},
		})
		const mkWs = (buffered = 0) => {
			const ws = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: buffered, sent: [] })
			ws.send = (b) => ws.sent.push(b)
			return ws
		}
		const fast = mkWs()
		const slow = mkWs(5 * 1024 * 1024)
		feed.addClient(fast, { width: '640' })
		feed.addClient(slow)
		assert.equal(workers.length, 0, 'no roles yet → no worker')
		fast.emit('message', Buffer.from(JSON.stringify({ roles: ['opgui', '../etc', 'x'.repeat(40)] })), false)
		slow.emit('message', Buffer.from(JSON.stringify({ roles: ['opgui'] })), false)
		assert.equal(workers.length, 1)
		const last = workers[0].posted.at(-1)
		assert.deepEqual(
			last.surfaces.map((s) => [s.role, s.path, s.params.width]),
			[['opgui', '/dev/shm/highascg-opgui', 960]]
		)
		const jpeg = JPEG(2)
		workers[0].emit('message', {
			role: 'opgui',
			seq: 1,
			jpeg: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length),
		})
		assert.equal(fast.sent.length, 1)
		assert.equal(slow.sent.length, 0, 'over the buffer cap → skipped')
		fast.emit('close')
		slow.emit('close')
		assert.equal(workers[0].posted.at(-1).type, 'stop', 'last watcher gone → worker told to close its ffmpegs and exit')
	})
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

describe('WO-670 P1 real ffmpeg round-trip', { skip: !hasFfmpeg && 'ffmpeg not installed' }, () => {
	it('a 64×36 shm frame comes out as a 64×36 JPEG within 5 s (asked 160 px: never upscaled)', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo670-'))
		const file = path.join(dir, 'seg')
		const pixels = Buffer.alloc(64 * 4 * 36)
		for (let i = 0; i < pixels.length; i += 4) pixels.set([0, 0, 255, 255], i)
		writeSegment(file, { width: 64, height: 36, stride: 256, pixels }, 1)
		let enc
		const jpeg = await new Promise((resolve, reject) => {
			const t = setTimeout(() => reject(new Error('no frame in 5 s')), 5000)
			enc = createEncoder({
				role: 't',
				path: file,
				params: { width: 160, fps: 30 },
				setInterval: () => 1,
				clearInterval: () => {},
				onFrame: ({ jpeg }) => {
					clearTimeout(t)
					resolve(jpeg)
				},
			})
			enc.tick()
		}).finally(() => {
			enc.close()
			fs.rmSync(dir, { recursive: true, force: true })
		})
		assert.deepEqual([...jpeg.subarray(0, 2)], [0xff, 0xd8])
		// SOF0 marker carries height, width
		const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]))
		assert.ok(sof > 0, 'baseline JPEG')
		assert.deepEqual([jpeg.readUInt16BE(sof + 5), jpeg.readUInt16BE(sof + 7)], [36, 64], 'never upscaled to 160')
	})
})
