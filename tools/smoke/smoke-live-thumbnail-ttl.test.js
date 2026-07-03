'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	resolveLiveThumbnailTtlMs,
	isLiveThumbnailMetaStale,
} = require('../../src/media/live-thumbnail-cache')

describe('live-thumbnail-cache TTL (WO-110)', () => {
	it('resolveLiveThumbnailTtlMs defaults to 30s', () => {
		assert.equal(resolveLiveThumbnailTtlMs({}), 30000)
		assert.equal(resolveLiveThumbnailTtlMs({ live_thumbnail_ttl_ms: 5000 }), 5000)
	})

	it('isLiveThumbnailMetaStale respects ttl', () => {
		const fresh = { capturedAt: new Date().toISOString() }
		assert.equal(isLiveThumbnailMetaStale(fresh, 30000), false)
		const old = { capturedAt: new Date(Date.now() - 60000).toISOString() }
		assert.equal(isLiveThumbnailMetaStale(old, 30000), true)
		assert.equal(isLiveThumbnailMetaStale(null, 30000), true)
		assert.equal(isLiveThumbnailMetaStale(fresh, 0), false)
	})
})
