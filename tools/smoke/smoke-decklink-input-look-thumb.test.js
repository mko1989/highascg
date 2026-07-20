'use strict'

/**
 * Offline smoke — DeckLink-input look deck thumbnails (2026-07-19).
 *
 * A look layer whose source is a DeckLink input has no media file, so the deck card used to
 * render nothing. It now resolves to the input channel's live (PRINT) thumbnail, captured
 * lazily server-side under the live-thumbnail TTL and a capped backoff.
 *
 * Pure logic + stubs: no Caspar, no ffmpeg, no network, no disk writes.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const {
	listInputCaptureChannels,
	isInputCaptureChannel,
	decideInputThumbnailCapture,
	ensureInputLiveThumbnail,
	_gate,
} = require('../../src/media/live-thumbnail-input-capture')

/** Shape produced by `src/config/routing-map.js` getChannelMap(): PGM 1/2, DeckLink inputs 4..7. */
const CHANNEL_MAP = {
	programChannels: [1, 2],
	decklinkInputChannels: [4, 5, 6, 7],
	liveAudioInputChannels: [8],
	inputChannels: [
		{ kind: 'decklink', slot: 1, channel: 4, layer: 1, route: 'route://4-1', label: 'DeckLink 1' },
		{ kind: 'decklink', slot: 2, channel: 5, layer: 2, route: 'route://5-2', label: 'DeckLink 2' },
		{ kind: 'decklink', slot: 3, channel: 6, layer: 3, route: 'route://6-3', label: 'DeckLink 3' },
		{ kind: 'decklink', slot: 4, channel: 7, layer: 4, route: 'route://7-4', label: 'DeckLink 4' },
		{ kind: 'live_audio', slot: 1, channel: 8, layer: 10, route: 'route://8', label: 'Live audio 1' },
	],
}

/** Silences the once-per-transition warn so a failing-input test does not spam the runner. */
const CTX = { config: {}, amcp: {}, log: () => {} }

describe('input capture channel classification', () => {
	it('lists DeckLink (and v4l2) input channels, never program buses', () => {
		assert.deepEqual(listInputCaptureChannels(CHANNEL_MAP), [4, 5, 6, 7])
		assert.equal(isInputCaptureChannel(CHANNEL_MAP, 7), true)
		assert.equal(isInputCaptureChannel(CHANNEL_MAP, 1), false, 'PGM 1 must never PRINT from a GET')
		assert.equal(isInputCaptureChannel(CHANNEL_MAP, 8), false, 'audio-only input has no picture')
	})

	it('is safe with a missing/garbage channel map', () => {
		assert.deepEqual(listInputCaptureChannels(null), [])
		assert.equal(isInputCaptureChannel(undefined, 4), false)
		assert.equal(isInputCaptureChannel(CHANNEL_MAP, 'x'), false)
	})
})

describe('decideInputThumbnailCapture', () => {
	const base = { isInputChannel: true, hasCache: false, stale: true, gateAllows: true, amcpReady: true }

	it('captures when an input channel has no cache', () => {
		assert.deepEqual(decideInputThumbnailCapture(base), { attempt: true, reason: 'no_cache' })
	})

	it('captures when the cached frame is older than the TTL', () => {
		assert.deepEqual(decideInputThumbnailCapture({ ...base, hasCache: true, stale: true }), {
			attempt: true,
			reason: 'stale_cache',
		})
	})

	it('serves a fresh cache without printing (no capture per render)', () => {
		assert.deepEqual(decideInputThumbnailCapture({ ...base, hasCache: true, stale: false }), {
			attempt: false,
			reason: 'fresh_cache',
		})
	})

	it('never captures for a non-input channel', () => {
		assert.deepEqual(decideInputThumbnailCapture({ ...base, isInputChannel: false }), {
			attempt: false,
			reason: 'not_input_channel',
		})
	})

	it('does not attempt while the backoff window is open, or with Caspar down', () => {
		assert.deepEqual(decideInputThumbnailCapture({ ...base, gateAllows: false }), {
			attempt: false,
			reason: 'backoff',
		})
		assert.deepEqual(decideInputThumbnailCapture({ ...base, amcpReady: false }), {
			attempt: false,
			reason: 'amcp_disconnected',
		})
	})
})

describe('ensureInputLiveThumbnail', () => {
	beforeEach(() => _gate.clear())

	it('captures a DeckLink input channel and reports success', async () => {
		let calls = 0
		const r = await ensureInputLiveThumbnail(CTX, 7, {
			channelMap: CHANNEL_MAP,
			hasCache: false,
			stale: true,
			capture: async () => {
				calls += 1
				return { ok: true, path: '/tmp/ch-7.png' }
			},
		})
		assert.deepEqual(r, { captured: true, reason: 'no_cache' })
		assert.equal(calls, 1)
		assert.equal(_gate.failures(7), 0)
	})

	it('leaves the program bus alone', async () => {
		let calls = 0
		const r = await ensureInputLiveThumbnail(CTX, 1, {
			channelMap: CHANNEL_MAP,
			hasCache: false,
			stale: true,
			capture: async () => {
				calls += 1
				return { ok: true }
			},
		})
		assert.equal(r.captured, false)
		assert.equal(r.reason, 'not_input_channel')
		assert.equal(calls, 0, 'PGM must not PRINT from a thumbnail GET')
	})

	it('no-signal input backs off instead of hot-retrying, then recovers', async () => {
		let calls = 0
		const failing = async () => {
			calls += 1
			return { ok: false, error: 'PRINT produced no PNG (check media path / Caspar logs)' }
		}
		const t0 = 1_000_000

		// Camera powered off: DeckLink 4 fails once...
		const first = await ensureInputLiveThumbnail(CTX, 7, {
			channelMap: CHANNEL_MAP,
			hasCache: false,
			stale: true,
			now: t0,
			capture: failing,
		})
		assert.equal(first.captured, false)
		assert.equal(first.reason, 'capture_failed')
		assert.equal(calls, 1)
		assert.equal(_gate.failures(7), 1)

		// ...and the next few deck renders inside the backoff window do NOT re-PRINT.
		for (const dt of [0, 10, 500, 2000]) {
			const again = await ensureInputLiveThumbnail(CTX, 7, {
				channelMap: CHANNEL_MAP,
				hasCache: false,
				stale: true,
				now: t0 + dt,
				capture: failing,
			})
			assert.equal(again.reason, 'backoff')
		}
		assert.equal(calls, 1, 'no hot retry loop while the input is dead')

		// Backoff grows on each real retry (3s → 6s), so a permanently dead input idles down.
		const retry = await ensureInputLiveThumbnail(CTX, 7, {
			channelMap: CHANNEL_MAP,
			hasCache: false,
			stale: true,
			now: t0 + 3000,
			capture: failing,
		})
		assert.equal(retry.reason, 'capture_failed')
		assert.equal(calls, 2)
		assert.equal(_gate.failures(7), 2)
		assert.equal(_gate.delayMs(7), 6000)

		// Camera comes back: one success clears the gate entirely.
		const ok = await ensureInputLiveThumbnail(CTX, 7, {
			channelMap: CHANNEL_MAP,
			hasCache: false,
			stale: true,
			now: t0 + 9000,
			capture: async () => ({ ok: true, path: '/tmp/ch-7.png' }),
		})
		assert.equal(ok.captured, true)
		assert.equal(_gate.failures(7), 0)
	})

	it('never hangs on a capture that never settles', async () => {
		const started = Date.now()
		const r = await ensureInputLiveThumbnail(CTX, 4, {
			channelMap: CHANNEL_MAP,
			hasCache: false,
			stale: true,
			timeoutMs: 300,
			capture: () => new Promise(() => {}),
		})
		assert.equal(r.captured, false)
		assert.equal(r.reason, 'capture_failed')
		assert.equal(r.error, 'capture timed out')
		assert.ok(Date.now() - started < 3000, 'GET must not block on a wedged PRINT')
	})

	it('does nothing when Caspar is disconnected', async () => {
		let calls = 0
		const r = await ensureInputLiveThumbnail(
			{ config: {}, amcp: null, log: () => {} },
			7,
			{
				channelMap: CHANNEL_MAP,
				hasCache: false,
				stale: true,
				capture: async () => {
					calls += 1
					return { ok: true }
				},
			},
		)
		assert.equal(r.reason, 'amcp_disconnected')
		assert.equal(calls, 0)
	})
})

describe('deck thumbnail URL resolution for DeckLink-input layers', () => {
	it('resolves a DeckLink-input layer to its input channel live thumbnail', async () => {
		const { resolveSourceThumbnailUrl } = await import('../../client/lib/thumbnail-url.js')
		const layerSource = { type: 'route', value: 'route://7-4', label: 'DeckLink 4', routeType: 'decklink' }
		const url = resolveSourceThumbnailUrl(layerSource, {
			deckIdleMode: true,
			channelMap: CHANNEL_MAP,
			cacheBust: 12345,
		})
		assert.match(url, /\/api\/thumbnail\/live\/7\?v=12345$/)
	})

	it('resolves legacy DeckLink layers saved without routeType via the channel map', async () => {
		const { resolveSourceThumbnailUrl } = await import('../../client/lib/thumbnail-url.js')
		const url = resolveSourceThumbnailUrl(
			{ type: 'route', value: 'route://5-2' },
			{ deckIdleMode: true, channelMap: CHANNEL_MAP },
		)
		assert.match(url, /\/api\/thumbnail\/live\/5$/)
	})

	it('still refuses program-bus stills on idle deck cards (WO-63)', async () => {
		const { resolveSourceThumbnailUrl } = await import('../../client/lib/thumbnail-url.js')
		assert.equal(
			resolveSourceThumbnailUrl(
				{ type: 'route', value: 'route://1', routeType: 'pgm' },
				{ deckIdleMode: true, channelMap: CHANNEL_MAP },
			),
			null,
		)
		assert.equal(
			resolveSourceThumbnailUrl(
				{ type: 'route', value: 'route://1-10' },
				{ deckIdleMode: true, channelMap: CHANNEL_MAP },
			),
			null,
		)
	})

	it('does not regress media-file thumbnails', async () => {
		const { resolveSourceThumbnailUrl } = await import('../../client/lib/thumbnail-url.js')
		const url = resolveSourceThumbnailUrl(
			{ type: 'media', value: 'clip-abc' },
			{ deckIdleMode: true, channelMap: CHANNEL_MAP },
		)
		assert.match(url, /\/api\/thumbnail\/clip-abc\?hq=1/)
	})

	it('leaves templates, timelines and placeholders without a thumbnail', async () => {
		const { resolveSourceThumbnailUrl } = await import('../../client/lib/thumbnail-url.js')
		for (const src of [
			{ type: 'template', value: 'LOWER-THIRDS/LT-CLASSIC-BOX' },
			{ type: 'timeline', value: 'tmr1u4em24d0' },
			{ type: 'route', value: 'route://7-4', isPlaceholder: true },
		]) {
			assert.equal(
				resolveSourceThumbnailUrl(src, { deckIdleMode: true, channelMap: CHANNEL_MAP }),
				null,
				`expected no thumb for ${src.type}`,
			)
		}
	})
})

describe('liveThumbnailCacheBustWindow', () => {
	it('is constant inside one TTL window and changes across windows', async () => {
		const { liveThumbnailCacheBustWindow, LIVE_THUMBNAIL_TTL_MS } = await import(
			'../../client/lib/thumbnail-url.js'
		)
		assert.equal(LIVE_THUMBNAIL_TTL_MS, 30000)
		// Aligned to a window start so the +29 999 / +30 000 edges are exact.
		const t = Math.floor(1_700_000_000_000 / LIVE_THUMBNAIL_TTL_MS) * LIVE_THUMBNAIL_TTL_MS
		const w = liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS, t)
		// Every repaint inside the window reuses one URL → one request, not one per render.
		assert.equal(liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS, t + 1), w)
		assert.equal(liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS, t + 29_999), w)
		assert.equal(liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS, t + 30_000), w + 1)
	})
})
