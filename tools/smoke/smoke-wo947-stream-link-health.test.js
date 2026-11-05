'use strict'

/**
 * WO-947 — a running stream reports whether Caspar actually reaches its receiver. Before: `active: true, lastError: null`
 * while Caspar logged "Connection lost … Attempting reconnect" every second (box, 05.11, RTMP and SRT receivers stopped).
 * The log lines below are the box's own (URL shortened).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	streamLinkState,
	runningStreamLink,
	linkErrorText,
	STALE_MS,
} = require('../../src/streaming/stream-link-health')
const { buildStreamingChannelStatusPayload } = require('../../src/streaming/streaming-channel-status')

const URL_ = 'rtmp://127.0.0.1:1935/live/test'
const L = (t, lvl, msg, url = URL_) => `[2026-11-05 ${t}] [${lvl}]   ffmpeg[${url}] ${msg}`
const at = (t) => {
	const [h, m, s] = t.split(':').map(Number)
	return new Date(2026, 10, 5, h, m, Math.floor(s), Math.round((s % 1) * 1000)).getTime()
}
const LOG = [
	L('08:56:44.793', 'info', 'Initialized.'),
	L('08:56:45.055', 'warning', 'Unused option i=-'),
	L('08:56:53.010', 'warning', 'Connection lost. Attempting reconnection in 1000ms'),
	'[2026-11-05 08:56:53.020] [error]   [ffmpeg] [tcp @ 0x7c75] Connection to tcp://127.0.0.1:1935?tcp_nodelay=0 failed: Connection refused',
	L('08:56:54.017', 'info', 'Attempting reconnect...'),
	L('08:56:54.043', 'warning', 'Connection lost. Attempting reconnection in 1000ms'),
	L('08:56:54.050', 'info', 'Initialized.', 'rec.mp4'),
]

test('WO-947: failures newer than the window → reconnecting, since the first one, attempts counted', () => {
	const s = streamLinkState(URL_, LOG, at('08:56:55'))
	assert.deepEqual([s.state, s.sinceMs, s.attempts], ['reconnecting', at('08:56:53.010'), 2])
	assert.equal(linkErrorText(s), 'Receiver not reachable — Caspar keeps retrying since 08:56:53 (2 attempts)')
})

test('WO-947: no new failure for longer than the window → connected again; a clean run → connected', () => {
	assert.equal(streamLinkState(URL_, LOG, at('08:56:54.043') + STALE_MS + 1).state, 'connected')
	assert.equal(streamLinkState(URL_, LOG.slice(0, 2), at('08:56:46')).state, 'connected')
	assert.equal(linkErrorText({ state: 'connected' }), '')
})

test('WO-947: only this consumer counts — another URL failing, or none at all, is not this stream', () => {
	assert.equal(streamLinkState('srt://other:9000', LOG, at('08:56:55')).state, 'connected')
	assert.equal(streamLinkState(URL_, [], at('08:56:55')).state, 'connected')
	const rerun = [...LOG, L('08:56:54.900', 'info', 'Initialized.')] // a new ADD of the same URL resets the run
	assert.equal(streamLinkState(URL_, rerun, at('08:56:55')).state, 'connected')
})

test('WO-947: an SRT caller retries every ~4 s (1 s + 3 s connect timeout) — it must not flicker to connected between', () => {
	const srt = 'srt://127.0.0.1:9000?latency=120000&mode=caller'
	const log = [
		L('09:01:56.325', 'warning', 'Connection lost. Attempting reconnection in 1000ms', srt),
		L('09:01:57.344', 'info', 'Attempting reconnect...', srt),
	]
	assert.equal(
		streamLinkState(srt, log, at('09:02:00.300')).state,
		'reconnecting',
		'3 s after the attempt, before the next loss'
	)
})

test('WO-947: the status payload carries link + the reason, and never the URL unredacted', () => {
	const ctx = { config: {}, streamingChannelRtmp: { active: true, url: URL_, consumerIndex: 97, lastError: null } }
	const link = streamLinkState(URL_, LOG, at('08:56:55'))
	const p = buildStreamingChannelStatusPayload(ctx, { link })
	assert.equal(p.rtmp.link, 'reconnecting')
	assert.match(p.rtmp.lastError, /^Receiver not reachable/)
	assert.ok(!JSON.stringify(p).includes('/live/test'), 'the stream key stays redacted')
	const ok = buildStreamingChannelStatusPayload(ctx, { link: { state: 'connected', sinceMs: null, attempts: 0 } })
	assert.deepEqual([ok.rtmp.link, ok.rtmp.lastError], ['connected', null])
	const idle = buildStreamingChannelStatusPayload({ config: {}, streamingChannelRtmp: { active: false } })
	assert.equal(idle.rtmp.link, null, 'no stream → no link state, and no log read')
	assert.equal(runningStreamLink({ active: false, url: URL_ }), null)
	const failed = buildStreamingChannelStatusPayload(
		{ config: {}, streamingChannelRtmp: { active: false, lastError: 'ADD failed' } },
		{ link: null }
	)
	assert.equal(failed.rtmp.lastError, 'ADD failed', 'a start error still wins')
})

test('WO-947: the log is read through the tail helper, cached per second', () => {
	let reads = 0
	const readTail = () => {
		reads += 1
		return LOG
	}
	const s = runningStreamLink({ active: true, url: URL_ }, { logPath: '/x.log', nowMs: at('08:56:55'), readTail })
	assert.equal(s.state, 'reconnecting')
	assert.equal(reads, 1)
})
