'use strict'

/**
 * WO-887 — live-source thumbnails: one non-black capture per node session, bounded retries, manual
 * recapture over the API only, previous-session PNG served as a placeholder until the session frame lands.
 * Offline: stub PRINTs write PNGs into a temp media root; no Caspar.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { PNG } = require('pngjs')

const { classifyRgbaFrame, analyzeThumbnailFrame } = require('../../src/media/live-thumbnail-frame-check')
const {
	SESSION_RETRY_DELAYS_MS,
	decideSessionCapture,
	ensureSessionLiveThumbnail,
	recaptureLiveThumbnails,
	markSessionThumbnailFresh,
	_resetSessions,
} = require('../../src/media/live-thumbnail-session')
const { isAudioOnlyLiveChannel, listLiveThumbnailChannels } = require('../../src/media/live-thumbnail-input-capture')
const { handleLiveThumbnailGet, handleLiveThumbnailRecapturePost } = require('../../src/media/live-thumbnail-cache-handlers')

const CM = {
	programChannels: [2, 4],
	previewChannels: [3, 5],
	decklinkInputChannels: [6],
	inputChannels: [
		{ kind: 'decklink', slot: 1, channel: 6, route: 'route://6-1' },
		{ kind: 'live_audio', slot: 1, channel: 7, route: 'route://7' },
	],
}
const quiet = () => {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** RGBA frame: `paint(x, y)` → [r, g, b, a]. */
function frame(w, h, paint) {
	const png = new PNG({ width: w, height: h })
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const [r, g, b, a] = paint(x, y)
			const i = (y * w + x) * 4
			png.data[i] = r
			png.data[i + 1] = g
			png.data[i + 2] = b
			png.data[i + 3] = a
		}
	}
	return png
}
const BLACK_CLEAR = () => [0, 0, 0, 0]
const BLACK_OPAQUE = () => [0, 0, 0, 255]
const PICTURE = (x, y) => [(x * 7 + y * 3) & 255, (x * 13) & 255, (y * 5) & 255, 255]

describe('frame check (calibrated on the box cache: ch-6 alpha-0 black, ch-7 opaque black, ch-4/5 pictures)', () => {
	it('transparent black, opaque black and transparent white are black', () => {
		for (const paint of [BLACK_CLEAR, BLACK_OPAQUE, () => [255, 255, 255, 0]]) {
			const p = frame(320, 180, paint)
			assert.equal(classifyRgbaFrame(p.data, p.width, p.height).black, true)
		}
	})

	it('a picture, a dark grey slate and small white text on black are not black', () => {
		const text = (x, y) => (x > 100 && x < 140 && y > 80 && y < 90 ? [255, 255, 255, 255] : [0, 0, 0, 255])
		for (const paint of [PICTURE, () => [20, 20, 20, 255], text]) {
			const p = frame(320, 180, paint)
			assert.equal(classifyRgbaFrame(p.data, p.width, p.height).black, false)
		}
	})

	it('decodes real PNG bytes; garbage counts as black and never throws', async () => {
		assert.equal((await analyzeThumbnailFrame(PNG.sync.write(frame(64, 36, PICTURE)))).black, false)
		assert.equal((await analyzeThumbnailFrame(PNG.sync.write(frame(64, 36, BLACK_CLEAR)))).black, true)
		const bad = await analyzeThumbnailFrame(Buffer.from('not a png'))
		assert.equal(bad.black, true)
		assert.ok(bad.error)
	})
})

describe('channel classification', () => {
	it('audio-only live channels have no picture; the recapture-all set is video inputs + buses', () => {
		assert.equal(isAudioOnlyLiveChannel(CM, 7), true)
		assert.equal(isAudioOnlyLiveChannel(CM, 6), false)
		assert.equal(isAudioOnlyLiveChannel(CM, 2), false)
		assert.deepEqual(listLiveThumbnailChannels(CM), [2, 3, 4, 5, 6])
	})
})

describe('decideSessionCapture', () => {
	it('first request of the session captures; any started session never starts another', () => {
		assert.deepEqual(decideSessionCapture({}), { attempt: true, reason: 'session_first' })
		for (const phase of ['capturing', 'waiting', 'fresh', 'gave_up']) {
			assert.deepEqual(decideSessionCapture({ phase }), { attempt: false, reason: `session_${phase}` })
		}
		assert.equal(decideSessionCapture({ audioOnly: true }).reason, 'no_picture')
		assert.equal(decideSessionCapture({ customCache: true }).reason, 'custom')
		assert.equal(decideSessionCapture({ amcpReady: false }).reason, 'amcp_disconnected')
	})

	it('the retry schedule is fixed and bounded', () => {
		assert.ok(SESSION_RETRY_DELAYS_MS.length > 0 && SESSION_RETRY_DELAYS_MS.length <= 8)
		assert.ok(SESSION_RETRY_DELAYS_MS.every((d, i) => d >= 10000 && (i === 0 || d >= SESSION_RETRY_DELAYS_MS[i - 1])))
	})
})

describe('ensureSessionLiveThumbnail', () => {
	const ctx = { config: {}, amcp: {}, log: quiet }
	beforeEach(() => _resetSessions())

	it('captures once on the first GET, never again this session', async () => {
		let calls = 0
		const capture = async () => (calls++, { ok: true })
		const a = await ensureSessionLiveThumbnail(ctx, 4, { channelMap: CM, capture })
		assert.equal(a.phase, 'fresh')
		const b = await ensureSessionLiveThumbnail(ctx, 4, { channelMap: CM, capture })
		assert.equal(b.phase, 'fresh')
		assert.equal(b.reason, 'session_fresh')
		assert.equal(calls, 1)
	})

	it('black frames retry on the bounded schedule, then give up for the session', async () => {
		let calls = 0
		const capture = async () => (calls++, { ok: false, rejected: true, error: 'black frame' })
		const opts = { channelMap: CM, capture, retryDelaysMs: [15, 15] }
		const a = await ensureSessionLiveThumbnail(ctx, 6, opts)
		assert.equal(a.phase, 'waiting')
		assert.ok(a.retryInMs >= 0 && a.retryInMs <= 15)
		await sleep(120)
		const b = await ensureSessionLiveThumbnail(ctx, 6, opts)
		assert.equal(b.phase, 'gave_up')
		assert.equal(b.attempts, 3)
		assert.equal(calls, 3, '1 + 2 retries, then nothing')
		await sleep(60)
		assert.equal(calls, 3, 'no capture loop after giving up')
	})

	it('a black first frame then a picture ends fresh', async () => {
		const results = [{ ok: false, rejected: true }, { ok: true }]
		let calls = 0
		const capture = async () => results[calls++]
		await ensureSessionLiveThumbnail(ctx, 6, { channelMap: CM, capture, retryDelaysMs: [10, 10, 10] })
		await sleep(80)
		const s = await ensureSessionLiveThumbnail(ctx, 6, { channelMap: CM, capture })
		assert.equal(s.phase, 'fresh')
		assert.equal(calls, 2)
	})

	it('audio-only channels, custom uploads and a disconnected Caspar never PRINT', async () => {
		let calls = 0
		const capture = async () => (calls++, { ok: true })
		assert.equal((await ensureSessionLiveThumbnail(ctx, 7, { channelMap: CM, capture })).phase, 'no_picture')
		assert.equal((await ensureSessionLiveThumbnail(ctx, 2, { channelMap: CM, capture, customCache: true })).phase, 'custom')
		const off = await ensureSessionLiveThumbnail({ config: {}, amcp: null, log: quiet }, 3, { channelMap: CM, capture })
		assert.equal(off.phase, 'idle')
		assert.equal(calls, 0)
		// Caspar comes up: the next GET is still the session's first capture.
		assert.equal((await ensureSessionLiveThumbnail(ctx, 3, { channelMap: CM, capture })).phase, 'fresh')
		assert.equal(calls, 1)
	})

	it('a wedged PRINT does not block the GET past waitMs', async () => {
		const t0 = Date.now()
		const s = await ensureSessionLiveThumbnail(ctx, 5, { channelMap: CM, capture: () => new Promise(() => {}), waitMs: 50 })
		assert.equal(s.phase, 'capturing')
		assert.ok(s.retryInMs > 0)
		assert.ok(Date.now() - t0 < 1000)
	})

	it('manual recapture restarts a fresh channel; recapture-all covers the live channels; manual capture cancels retries', async () => {
		let calls = 0
		const capture = async () => (calls++, { ok: true })
		await ensureSessionLiveThumbnail(ctx, 4, { channelMap: CM, capture })
		const one = await recaptureLiveThumbnails(ctx, [4], { channelMap: CM, capture })
		assert.deepEqual(one.map((r) => [r.channel, r.phase]), [[4, 'fresh']])
		assert.equal(calls, 2)
		const all = await recaptureLiveThumbnails(ctx, null, { channelMap: CM, capture })
		assert.deepEqual(all.map((r) => r.channel), [2, 3, 4, 5, 6])
		const audio = await recaptureLiveThumbnails(ctx, [7], { channelMap: CM, capture })
		assert.equal(audio[0].phase, 'no_picture')

		_resetSessions()
		let blackCalls = 0
		const black = async () => (blackCalls++, { ok: false, rejected: true })
		await ensureSessionLiveThumbnail(ctx, 6, { channelMap: CM, capture: black, retryDelaysMs: [30] })
		markSessionThumbnailFresh(6)
		await sleep(80)
		assert.equal(blackCalls, 1, 'the pending retry was cancelled by the manual capture')
		assert.equal((await ensureSessionLiveThumbnail(ctx, 6, { channelMap: CM, capture: black })).phase, 'fresh')
	})
})

describe('HTTP handlers + real capture pipeline (temp media root, stub PRINT)', () => {
	beforeEach(() => _resetSessions())

	function setup(printFrames) {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo887-'))
		const media = path.join(root, 'media')
		const cache = path.join(root, 'cache')
		fs.mkdirSync(media)
		fs.mkdirSync(cache)
		let n = 0
		const print = async () => {
			const png = printFrames[Math.min(n++, printFrames.length - 1)]
			fs.writeFileSync(path.join(media, `20261031T0800${String(n).padStart(2, '0')}.png`), png)
			return { ok: true, data: '202 PRINT OK' }
		}
		const ctx = {
			config: { local_media_path: media, live_thumbnail_cache_path: cache, channelMap: CM },
			amcp: { basic: { print } },
			log: quiet,
		}
		return { root, cache, media, ctx, prints: () => n }
	}

	it('serves the old PNG as placeholder, a black PRINT never overwrites it, a picture replaces it', async () => {
		const blackPng = PNG.sync.write(frame(1920, 1080, BLACK_CLEAR))
		const goodPng = PNG.sync.write(frame(256, 144, PICTURE))
		const oldPng = PNG.sync.write(frame(256, 144, () => [200, 10, 10, 255]))
		const t = setup([blackPng])
		try {
			fs.writeFileSync(path.join(t.cache, 'ch-6.png'), oldPng)
			const r = await handleLiveThumbnailGet(t.ctx, 6, {})
			assert.equal(r.status, 200)
			assert.equal(r.headers['X-Live-Thumb-Session'], 'waiting')
			assert.ok(Number(r.headers['X-Live-Thumb-Retry-Ms']) > 0)
			assert.deepEqual(r.body, oldPng, 'previous session PNG kept as placeholder')
			assert.deepEqual(fs.readdirSync(t.media), [], 'black PRINT still cleaned up')

			const rc = await handleLiveThumbnailRecapturePost({ channel: 6 }, { ...t.ctx, amcp: { basic: { print: async () => {
				fs.writeFileSync(path.join(t.media, '20261031T090000.png'), goodPng)
				return { ok: true, data: '202 PRINT OK' }
			} } } })
			assert.equal(rc.status, 200)
			assert.equal(JSON.parse(rc.body).channels[0].phase, 'fresh')
			const r2 = await handleLiveThumbnailGet(t.ctx, 6, {})
			assert.equal(r2.headers['X-Live-Thumb-Session'], 'fresh')
			assert.deepEqual(r2.body, goodPng)
			assert.equal(r2.headers['X-Live-Thumb-Retry-Ms'], undefined)
			const prints = t.prints()
			await handleLiveThumbnailGet(t.ctx, 6, {})
			assert.equal(t.prints(), prints, 'fresh: no PRINT on later GETs')
		} finally {
			_resetSessions()
			fs.rmSync(t.root, { recursive: true, force: true })
		}
	})

	it('no PNG and only black frames → 404 with the session phase, never a stored black frame', async () => {
		const t = setup([PNG.sync.write(frame(1920, 1080, BLACK_OPAQUE))])
		try {
			const r = await handleLiveThumbnailGet(t.ctx, 4, {})
			assert.equal(r.status, 404)
			assert.equal(r.headers['X-Live-Thumb-Session'], 'waiting')
			assert.equal(fs.existsSync(path.join(t.cache, 'ch-4.png')), false)
			const bad = await handleLiveThumbnailRecapturePost({ channel: 'x' }, t.ctx)
			assert.equal(bad.status, 400)
		} finally {
			_resetSessions()
			fs.rmSync(t.root, { recursive: true, force: true })
		}
	})
})
