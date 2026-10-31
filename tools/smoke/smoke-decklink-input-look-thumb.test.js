'use strict'

/**
 * Offline smoke — DeckLink-input look deck thumbnails (2026-07-19).
 *
 * A look layer whose source is a DeckLink input has no media file, so the deck card used to
 * render nothing. It now resolves to the input channel's live (PRINT) thumbnail, captured
 * lazily server-side once per node session on a non-black frame (WO-887; was once per cache lifetime, WO-392).
 *
 * Pure logic + stubs: no Caspar, no ffmpeg, no network, no disk writes.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { listInputCaptureChannels, isInputCaptureChannel } = require('../../src/media/live-thumbnail-input-capture')

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

describe('input capture channel classification', () => {
	it('lists DeckLink (and v4l2) input channels, never program buses', () => {
		assert.deepEqual(listInputCaptureChannels(CHANNEL_MAP), [4, 5, 6, 7])
		assert.equal(isInputCaptureChannel(CHANNEL_MAP, 7), true)
		assert.equal(isInputCaptureChannel(CHANNEL_MAP, 1), false, 'PGM 1 is a bus, not a capture input')
		assert.equal(isInputCaptureChannel(CHANNEL_MAP, 8), false, 'audio-only input has no picture')
	})

	it('is safe with a missing/garbage channel map', () => {
		assert.deepEqual(listInputCaptureChannels(null), [])
		assert.equal(isInputCaptureChannel(undefined, 4), false)
		assert.equal(isInputCaptureChannel(CHANNEL_MAP, 'x'), false)
	})
})

// WO-887 replaced the per-GET backoff gate (`decideInputThumbnailCapture` / `ensureInputLiveThumbnail`) with
// one non-black capture per node session — its decide / retry / no-hot-loop cases live in
// smoke-wo887-live-thumb-session.test.js.

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

// WO-392 deleted `liveThumbnailCacheBustWindow` — live thumbs use stable URLs now; the
// no-periodic-refresh invariant is guarded in smoke-wo331-live-thumb-url-stability.test.js.
