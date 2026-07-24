'use strict'

/**
 * Offline smoke — WO-331: live-input thumbnail URL stability (2026-07-24).
 *
 * The sources-panel Live tab used `Date.now()` as the cache-bust on EVERY render, so each
 * state tick minted a new URL → browser refetch → visible tile flicker. Passive renders must
 * use the TTL-quantised window bust (one URL per 30 s window), like the deck thumbs do.
 * Explicit capture/upload actions keep `Date.now()` — those are deliberate refreshes.
 *
 * Pure logic + a source-text regression guard: no network, no DOM.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

describe('liveThumbnailCacheBustWindow stability', () => {
	it('is constant inside one TTL window and changes across windows', async () => {
		const { liveThumbnailCacheBustWindow, getLiveThumbnailUrl, LIVE_THUMBNAIL_TTL_MS } =
			await import('../../client/lib/thumbnail-url.js')
		const t0 = 1_753_300_000_000 // arbitrary fixed epoch, window-aligned math below
		const winStart = Math.floor(t0 / LIVE_THUMBNAIL_TTL_MS) * LIVE_THUMBNAIL_TTL_MS
		const a = liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS, winStart)
		const b = liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS, winStart + LIVE_THUMBNAIL_TTL_MS - 1)
		const c = liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS, winStart + LIVE_THUMBNAIL_TTL_MS)
		assert.equal(a, b, 'same window → same bust token (URL reused, no refetch)')
		assert.notEqual(b, c, 'next window → new bust token')
		assert.equal(
			getLiveThumbnailUrl(4, a),
			getLiveThumbnailUrl(4, b),
			'same window → byte-identical URL'
		)
	})

	it('defaults sanely on garbage ttl', async () => {
		const { liveThumbnailCacheBustWindow } = await import('../../client/lib/thumbnail-url.js')
		assert.equal(typeof liveThumbnailCacheBustWindow('junk', 60000), 'number')
	})
})

describe('sources-panel Live tab render path', () => {
	const src = fs.readFileSync(
		path.join(__dirname, '../../client/components/sources-panel-live-render.js'),
		'utf8'
	)

	it('passive render busts with the TTL window, never Date.now()', () => {
		assert.match(
			src,
			/getLiveThumbnailUrl\(ch, liveThumbnailCacheBustWindow\(\)\)/,
			'render must use the TTL-window bust'
		)
		const renderSection = src.slice(0, src.indexOf('captureBtn.onclick'))
		assert.doesNotMatch(
			renderSection,
			/getLiveThumbnailUrl\([^)]*Date\.now\(\)/,
			'render path must not mint a per-render bust (WO-331 regression)'
		)
	})

	it('explicit capture/upload refreshes still force a fresh URL', () => {
		const handlers = src.slice(src.indexOf('captureBtn.onclick'))
		assert.match(handlers, /const bust = Date\.now\(\)/, 'user-triggered refresh keeps Date.now()')
	})
})
