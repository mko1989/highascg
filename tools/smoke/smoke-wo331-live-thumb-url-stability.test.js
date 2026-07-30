'use strict'

/**
 * Offline smoke — WO-331 → WO-392: live-input thumbnail URL stability (2026-07-30).
 *
 * WO-331 (2026-07-24) stopped the sources panel minting a `Date.now()` bust on every render.
 * WO-392 goes further: live-input thumbs are capture-once, so passive renders must use a
 * STABLE, un-busted URL — no TTL-window token, no timer-driven refetch. Freshness comes from
 * the server (`Cache-Control: private, no-cache` + ETag/304), and only explicit capture/upload
 * actions mint a `Date.now()` bust (those are deliberate refreshes).
 *
 * Pure logic + source-text regression guards: no network, no DOM.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('live thumbnail URLs are stable (WO-392)', () => {
	it('the TTL-window bust helper is gone from the client lib', async () => {
		const mod = await import('../../client/lib/thumbnail-url.js')
		assert.equal(mod.liveThumbnailCacheBustWindow, undefined, 'periodic bust helper must stay deleted')
		const url = mod.getLiveThumbnailUrl(4)
		assert.match(url, /\/api\/thumbnail\/live\/4$/, 'un-busted URL has no query token')
		assert.equal(mod.getLiveThumbnailUrl(4), url, 'stable across calls')
	})
})

describe('sources-panel Live tab render path', () => {
	const src = read('client/components/sources-panel-live-render.js')

	it('passive render uses the stable un-busted URL, never a time-varying bust', () => {
		assert.match(
			src,
			/const thumbUrl = getLiveThumbnailUrl\(ch\)/,
			'render must use the stable URL (WO-392)'
		)
		const renderSection = src.slice(0, src.indexOf('captureBtn.onclick'))
		assert.doesNotMatch(
			renderSection,
			/getLiveThumbnailUrl\([^)]*(Date\.now|BustWindow)/,
			'render path must not mint a per-render or per-window bust (WO-331/WO-392 regression)'
		)
	})

	it('explicit capture/upload refreshes still force a fresh URL', () => {
		const handlers = src.slice(src.indexOf('captureBtn.onclick'))
		assert.match(handlers, /const bust = Date\.now\(\)/, 'user-triggered refresh keeps Date.now()')
	})
})

describe('scenes deck thumbnails', () => {
	const src = read('client/components/scenes-editor-deck-thumb.js')

	it('deck painting has no periodic live-thumb refresh timer and no bust token', () => {
		assert.doesNotMatch(src, /armLiveInputRefresh/, 'TTL-rollover repaint timer must stay deleted')
		assert.doesNotMatch(src, /liveThumbnailCacheBustWindow|LIVE_THUMBNAIL_TTL_MS/, 'no window bust in deck URLs')
		assert.doesNotMatch(src, /cacheBust:/, 'deck resolves live thumbs without a bust option')
	})
})

describe('server serve path supports stable URLs', () => {
	const handlers = read('src/media/live-thumbnail-cache-handlers.js')
	const capture = read('src/media/live-thumbnail-input-capture.js')

	it('cached PNGs are served no-cache with ETag so stable URLs revalidate', () => {
		assert.match(handlers, /'Cache-Control': 'private, no-cache'/, 'stable URLs need revalidation, not max-age')
		assert.match(handlers, /status: 304/, 'If-None-Match must short-circuit to 304')
		assert.doesNotMatch(handlers, /max-age=86400/, 'a long max-age would pin day-old thumbs on stable URLs')
	})

	it('a GET never PRINTs while a cached PNG exists (capture-once)', () => {
		assert.match(capture, /if \(hasCache\) return \{ attempt: false, reason: 'has_cache' \}/)
		assert.doesNotMatch(capture, /stale_cache/, 'TTL-stale recapture must stay deleted (WO-392)')
	})
})
