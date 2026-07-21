'use strict'

/**
 * WO-319 — the GOP buffer / relay policy.
 *
 * Two properties this MUST guarantee, both of which produce visible corruption or unbounded latency
 * if wrong:
 *  - IDR-FIRST: a joining or resynced client always starts on a keyframe. Feeding WebCodecs a
 *    P-frame first yields "no frame" / green output — the exact mid-stream PPS errors seen live.
 *  - STALE-DROP: a client that fell behind the current GOP jumps FORWARD to the latest keyframe
 *    rather than replaying a backlog. Replaying is latency that never recovers.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	createGopBuffer,
	pushFrame,
	latestKeyframe,
	createClientCursor,
	framesForClient,
	resetClientToKeyframe,
} = require('../../src/preview/gui-stream-gop-buffer')

const K = (seq) => ({ seq, keyframe: true })
const P = (seq) => ({ seq, keyframe: false })
const seqs = (r) => r.frames.map((f) => f.seq)

test('P-frames before the first keyframe are dropped — they are undecodable alone', () => {
	const buf = createGopBuffer()
	assert.deepEqual(pushFrame(buf, P(1)), { startedNewGop: false, dropped: true })
	assert.deepEqual(pushFrame(buf, P(2)), { startedNewGop: false, dropped: true })
	assert.equal(latestKeyframe(buf), null, 'no keyframe yet, nothing to hand a joiner')
	assert.equal(buf.droppedPreKeyframe, 2)
})

test('a keyframe starts a GOP and releases everything before it', () => {
	const buf = createGopBuffer()
	pushFrame(buf, K(10))
	pushFrame(buf, P(11))
	pushFrame(buf, P(12))
	assert.equal(latestKeyframe(buf).seq, 10)
	// A new keyframe drops the old GOP entirely.
	const r = pushFrame(buf, K(20))
	assert.equal(r.startedNewGop, true)
	assert.equal(buf.frames.length, 1)
	assert.equal(latestKeyframe(buf).seq, 20, 'joiners now start at 20, never 10')
})

test('a fresh client receives the whole current GOP, keyframe FIRST', () => {
	const buf = createGopBuffer()
	pushFrame(buf, K(10))
	pushFrame(buf, P(11))
	pushFrame(buf, P(12))
	const cur = createClientCursor()
	const out = framesForClient(buf, cur)
	assert.deepEqual(seqs(out), [10, 11, 12])
	assert.equal(out.frames[0].keyframe, true, 'the first frame a client ever gets MUST be a keyframe')
	assert.equal(out.resynced, false, 'a first join is not a resync')
})

test('a caught-up client is sent nothing, then exactly the new frames as they arrive', () => {
	const buf = createGopBuffer()
	pushFrame(buf, K(10))
	const cur = createClientCursor()
	framesForClient(buf, cur) // drains [10]
	assert.deepEqual(seqs(framesForClient(buf, cur)), [], 'nothing new yet')
	pushFrame(buf, P(11))
	pushFrame(buf, P(12))
	assert.deepEqual(seqs(framesForClient(buf, cur)), [11, 12], 'only the new frames, no keyframe re-send')
})

test('STALE-DROP: a client behind the current keyframe resyncs FORWARD, never replays the gap', () => {
	const buf = createGopBuffer()
	pushFrame(buf, K(10))
	pushFrame(buf, P(11))
	const cur = createClientCursor()
	framesForClient(buf, cur) // client now at seq 11
	// Stream re-keys; the client's seq 11 predates the new GOP.
	pushFrame(buf, K(50))
	pushFrame(buf, P(51))
	const out = framesForClient(buf, cur)
	assert.deepEqual(seqs(out), [50, 51], 'jumps to the new GOP')
	assert.equal(out.frames[0].keyframe, true, 'resync must land on a keyframe')
	assert.equal(out.resynced, true)
	assert.ok(!seqs(out).includes(11) && !seqs(out).some((s) => s > 11 && s < 50), 'the gap is never replayed')
})

test('resetClientToKeyframe forces a resync on the next pull (the lagging-client recovery path)', () => {
	const buf = createGopBuffer()
	pushFrame(buf, K(10))
	pushFrame(buf, P(11))
	pushFrame(buf, P(12))
	const cur = createClientCursor()
	framesForClient(buf, cur) // caught up at 12
	assert.deepEqual(seqs(framesForClient(buf, cur)), [])

	resetClientToKeyframe(cur) // WS decided it is lagging
	const out = framesForClient(buf, cur)
	assert.deepEqual(seqs(out), [10, 11, 12], 'resent from the keyframe')
	assert.equal(out.frames[0].keyframe, true)
})

test('two clients at different positions are served independently from one buffer', () => {
	const buf = createGopBuffer()
	pushFrame(buf, K(10))
	pushFrame(buf, P(11))
	const a = createClientCursor()
	const b = createClientCursor()
	framesForClient(buf, a) // a drains [10,11]
	pushFrame(buf, P(12))
	// b joins now — must still get the keyframe first, independent of a.
	assert.deepEqual(seqs(framesForClient(buf, b)), [10, 11, 12])
	// a only gets the one new frame.
	assert.deepEqual(seqs(framesForClient(buf, a)), [12])
})

test('the safety cap bounds a keyframeless stream without ever dropping the keyframe', () => {
	const buf = createGopBuffer({ maxGopFrames: 5 })
	pushFrame(buf, K(1))
	for (let s = 2; s <= 20; s++) pushFrame(buf, P(s))
	assert.equal(buf.frames.length, 5, 'retained frames are capped')
	assert.equal(buf.frames[0].keyframe, true, 'the keyframe is never the one dropped')
	assert.equal(buf.frames[0].seq, 1)
	// A joiner still gets a decodable start (the keyframe) plus the freshest tail.
	const out = framesForClient(buf, createClientCursor())
	assert.equal(out.frames[0].keyframe, true)
	assert.equal(seqs(out)[seqs(out).length - 1], 20, 'newest frame is retained')
})

test('a malformed frame (no seq) is rejected, not buffered', () => {
	const buf = createGopBuffer()
	pushFrame(buf, K(1))
	assert.deepEqual(pushFrame(buf, { keyframe: false }), { startedNewGop: false, dropped: true })
	assert.deepEqual(pushFrame(buf, null), { startedNewGop: false, dropped: true })
	assert.equal(buf.frames.length, 1, 'only the valid keyframe is held')
})

test('an empty buffer serves no frames and reports no keyframe', () => {
	const buf = createGopBuffer()
	assert.equal(latestKeyframe(buf), null)
	assert.deepEqual(framesForClient(buf, createClientCursor()), { frames: [], resynced: false })
})
