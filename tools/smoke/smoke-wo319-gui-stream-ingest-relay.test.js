'use strict'

/**
 * WO-319 — ingest lifecycle + WS relay, integration-tested offline with a fake ffmpeg process and
 * fake sockets but the REAL splitter → GOP buffer → relay policy chain.
 *
 * What must hold:
 *  - acquire/release refcounting drives ADD/REMOVE exactly once each, reader spawned BEFORE the
 *    consumer is added (TS sent before the port is bound is lost).
 *  - Bytes from the remux stdout come out of the relay as framed AUs with correct seq/keyframe.
 *  - A dying remux process is restarted while clients remain; a deliberate stop() is not.
 *  - The linger keeps the consumer alive across a quick reconnect (page reload) but tears it down
 *    after the last client is really gone.
 *  - Backpressure resets a client to keyframe instead of queueing (stale-drop at the socket layer).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')

const { createGuiStreamIngest, buildRemuxArgs, GUI_STREAM_CONSUMER_INDEX } = require('../../src/preview/gui-stream-ingest')
const { attachGuiStreamRelay, encodeWireFrame, HEADER_BYTES, FLAG_KEYFRAME } = require('../../src/preview/gui-stream-ws-relay')

const SC = [0, 0, 0, 1]
const nal = (type, firstMbZero = true) => Buffer.from([...SC, 0x60 | type, firstMbZero ? 0x88 : 0x3a, 0xaa])
const keyAu = () => Buffer.concat([nal(7), nal(8), nal(5)])
const pAu = () => nal(1)

function makeFakeProc() {
	const proc = new EventEmitter()
	proc.stdout = new EventEmitter()
	proc.stderr = new EventEmitter()
	proc.killed = false
	proc.kill = (sig) => {
		proc.killed = true
		proc.lastSignal = sig
	}
	return proc
}

function makeHarness(opts = {}) {
	const calls = { amcp: [], spawns: [], order: [] }
	let procs = []
	const amcp = {
		raw: async (cmd) => {
			calls.amcp.push(cmd)
			calls.order.push(`amcp:${cmd.split(' ')[0]}`)
			if (opts.failAdd && cmd.startsWith('ADD')) throw new Error('amcp ADD refused')
		},
	}
	const spawnImpl = (bin, args) => {
		const proc = makeFakeProc()
		procs.push(proc)
		calls.spawns.push({ bin, args })
		calls.order.push('spawn')
		return proc
	}
	const ingest = createGuiStreamIngest({
		amcp,
		spawnImpl,
		channel: 4,
		scale: '1920:1080',
		lingerMs: opts.lingerMs ?? 30,
		restartDelayMs: opts.restartDelayMs ?? 20,
		log: () => {},
	})
	return { ingest, calls, procs: () => procs, lastProc: () => procs[procs.length - 1] }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('remux args: udp in on the right port, pure copy out — the ONE encode stays on NVENC', () => {
	const args = buildRemuxArgs(9250)
	const s = args.join(' ')
	assert.match(s, /udp:\/\/127\.0\.0\.1:9250/)
	assert.match(s, /-c:v copy/)
	assert.match(s, /-f h264 pipe:1/)
	assert.ok(!/nvenc|libx264/.test(s), 'the remux hop must never re-encode')
	assert.match(s, /low_delay/, 'low-latency decode posture')
	assert.match(s, /nobuffer/, 'nobuffer trims the demuxer buffer — the low-bitrate multi-second latency')
	assert.match(s, /-flush_packets 1/, 'flush every packet, do not wait to fill an output buffer')
	// Regression guard (verified live 2026-07-22): nobuffer is safe ONLY with a real analyzeduration;
	// nobuffer + analyzeduration 0 starves detection so copy never latches (0 AUs forever).
	assert.ok(!/-analyzeduration 0(\s|$)/.test(s), 'must allow up to one GOP for stream detection')
})

test('acquire spawns the reader BEFORE adding the consumer, on the verified index', async () => {
	const h = makeHarness()
	await h.ingest.acquire()
	assert.equal(h.calls.spawns.length, 1, 'reader spawned')
	assert.equal(h.calls.amcp.length, 1)
	assert.deepEqual(h.calls.order, ['spawn', 'amcp:ADD'], 'reader binds the port BEFORE Caspar starts sending')
	assert.match(h.calls.amcp[0], new RegExp(`^ADD 4-${GUI_STREAM_CONSUMER_INDEX} STREAM udp://127\\.0\\.0\\.1:9250\\?localport=9251 `))
	assert.match(h.calls.amcp[0], /h264_nvenc/)
	assert.match(h.calls.amcp[0], /aformat=channel_layouts=stereo/, 'the mandatory audio downmix must survive the wiring')
	await h.ingest.stop()
})

test('stdout bytes become sequenced AUs with correct keyframe flags', async () => {
	const h = makeHarness()
	const seen = []
	h.ingest.events.on('au', (f) => seen.push({ seq: f.seq, keyframe: f.keyframe }))
	await h.ingest.acquire()
	const proc = h.lastProc()
	proc.stdout.emit('data', keyAu())
	proc.stdout.emit('data', pAu())
	proc.stdout.emit('data', pAu())
	proc.stdout.emit('data', keyAu()) // closes the 2nd P and opens a new GOP
	assert.deepEqual(seen, [
		{ seq: 0, keyframe: true },
		{ seq: 1, keyframe: false },
		{ seq: 2, keyframe: false },
	])
	assert.equal(h.ingest.buffer.keyframeSeq, 0, 'GOP buffer fed through')
	await h.ingest.stop()
})

test('a crashed remux is restarted while running; a stopped one is not', async () => {
	const h = makeHarness({ restartDelayMs: 15 })
	await h.ingest.acquire()
	assert.equal(h.calls.spawns.length, 1)
	h.lastProc().emit('exit', 1, null) // crash
	await sleep(40)
	assert.equal(h.calls.spawns.length, 2, 'restarted after the crash')
	await h.ingest.stop()
	h.lastProc().emit('exit', null, 'SIGTERM') // our own kill
	await sleep(40)
	assert.equal(h.calls.spawns.length, 2, 'no restart after deliberate stop')
})

test('linger: quick reconnect never touches ADD/REMOVE; real departure removes exactly once', async () => {
	const h = makeHarness({ lingerMs: 40 })
	await h.ingest.acquire()
	h.ingest.release()
	await sleep(10) // within linger
	await h.ingest.acquire() // page reload rejoins
	await sleep(60)
	assert.deepEqual(
		h.calls.amcp.filter((c) => c.startsWith('REMOVE')),
		[],
		'consumer survived the reload window',
	)
	assert.equal(h.calls.amcp.filter((c) => c.startsWith('ADD')).length, 1, 'no second ADD either')
	h.ingest.release()
	await sleep(70)
	assert.deepEqual(
		h.calls.amcp.filter((c) => c.startsWith('REMOVE')),
		[`REMOVE 4-${GUI_STREAM_CONSUMER_INDEX}`],
		'torn down after the linger',
	)
})

test('a failed ADD kills the orphan reader and surfaces the error', async () => {
	const h = makeHarness({ failAdd: true })
	await assert.rejects(() => h.ingest.acquire(), /ADD refused/)
	assert.equal(h.lastProc().killed, true, 'no reader left running against a consumer that never started')
	assert.match(h.ingest.stats().lastError || '', /start failed/)
})

test('wire framing: 8-byte LE header, keyframe flag, payload verbatim', () => {
	const data = Buffer.from([1, 2, 3, 4, 5])
	const buf = encodeWireFrame({ seq: 0x01020304, keyframe: true, data })
	assert.equal(buf.length, HEADER_BYTES + data.length)
	assert.equal(buf.readUInt32LE(0), 0x01020304)
	assert.equal(buf[4] & FLAG_KEYFRAME, FLAG_KEYFRAME)
	assert.ok(buf.subarray(HEADER_BYTES).equals(data))
	assert.equal(encodeWireFrame({ seq: 7, keyframe: false, data })[4] & FLAG_KEYFRAME, 0)
})

function makeFakeWs() {
	const ws = new EventEmitter()
	ws.readyState = 1 // OPEN
	ws.bufferedAmount = 0
	ws.sent = []
	ws.send = (x) => ws.sent.push(x)
	ws.close = () => ws.emit('close')
	return ws
}

function makeRelay(h, opts = {}) {
	const httpServer = new EventEmitter()
	const relay = attachGuiStreamRelay(httpServer, { config: {} }, { ingest: h.ingest, log: () => {}, ...opts })
	return relay
}

test('relay: connect sends the JSON config first, then framed binary AUs, IDR first', async () => {
	const h = makeHarness()
	const relay = makeRelay(h)
	const ws = makeFakeWs()
	relay.wss.emit('connection', ws)
	await sleep(10) // let acquire() resolve
	const proc = h.lastProc()
	proc.stdout.emit('data', Buffer.concat([keyAu(), pAu(), pAu()]))
	const first = ws.sent[0]
	assert.equal(typeof first, 'string')
	const cfg = JSON.parse(first)
	assert.equal(cfg.type, 'gui_stream_config')
	assert.ok(cfg.codec)
	const binary = ws.sent.filter((x) => Buffer.isBuffer(x))
	assert.ok(binary.length >= 1)
	assert.equal(binary[0][4] & FLAG_KEYFRAME, FLAG_KEYFRAME, 'first binary frame is the keyframe')
	const seqs = binary.map((b) => b.readUInt32LE(0))
	assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'delivered in order')
	relay.detach()
	await h.ingest.stop()
})

test('relay: backpressure resets the client and resumes from a keyframe after drain', async () => {
	const h = makeHarness()
	const relay = makeRelay(h)
	const ws = makeFakeWs()
	relay.wss.emit('connection', ws)
	await sleep(10)
	const proc = h.lastProc()
	proc.stdout.emit('data', Buffer.concat([keyAu(), pAu()]))
	const deliveredBefore = ws.sent.filter((x) => Buffer.isBuffer(x)).length
	assert.ok(deliveredBefore >= 1)

	ws.bufferedAmount = 100 * 1024 * 1024 // socket jammed
	proc.stdout.emit('data', Buffer.concat([pAu(), pAu()]))
	assert.equal(ws.sent.filter((x) => Buffer.isBuffer(x)).length, deliveredBefore, 'nothing queued onto a jammed socket')

	ws.bufferedAmount = 0 // drained; a new GOP arrives
	proc.stdout.emit('data', Buffer.concat([keyAu(), pAu()]))
	const after = ws.sent.filter((x) => Buffer.isBuffer(x)).slice(deliveredBefore)
	assert.ok(after.length >= 1, 'delivery resumed')
	assert.equal(after[0][4] & FLAG_KEYFRAME, FLAG_KEYFRAME, 'resumed at a keyframe, not mid-GOP')
	relay.detach()
	await h.ingest.stop()
})

test('relay: client close releases the ingest (teardown after linger)', async () => {
	const h = makeHarness({ lingerMs: 20 })
	const relay = makeRelay(h)
	const ws = makeFakeWs()
	relay.wss.emit('connection', ws)
	await sleep(10)
	assert.equal(h.ingest.stats().refs, 1)
	ws.close()
	assert.equal(h.ingest.stats().refs, 0)
	await sleep(50)
	assert.equal(h.calls.amcp.filter((c) => c.startsWith('REMOVE')).length, 1, 'consumer removed after last client left')
	relay.detach()
})

test('relay: a failed stream start tells the client and closes it', async () => {
	const h = makeHarness({ failAdd: true })
	const relay = makeRelay(h)
	const ws = makeFakeWs()
	let closed = false
	ws.close = () => {
		closed = true
	}
	relay.wss.emit('connection', ws)
	await sleep(15)
	const errMsg = ws.sent.filter((x) => typeof x === 'string').map((x) => JSON.parse(x)).find((m) => m.type === 'gui_stream_error')
	assert.ok(errMsg, 'client is told the stream failed')
	assert.equal(closed, true)
	relay.detach()
})
