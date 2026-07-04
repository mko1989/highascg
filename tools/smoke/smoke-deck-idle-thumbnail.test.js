'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('resolveSourceThumbnailUrl deckIdleMode', () => {
	it('returns media thumb for file sources', async () => {
		const { resolveSourceThumbnailUrl } = await import('../../client/lib/thumbnail-url.js')
		const url = resolveSourceThumbnailUrl(
			{ type: 'media', value: 'clip-abc' },
			{ deckIdleMode: true },
		)
		assert.match(url, /\/api\/thumbnail\/clip-abc/)
	})

	it('skips live/route bus stills in deck idle mode', async () => {
		const { resolveSourceThumbnailUrl } = await import('../../client/lib/thumbnail-url.js')
		assert.equal(
			resolveSourceThumbnailUrl(
				{ type: 'route', value: 'route://1' },
				{ channelForLive: 2, deckIdleMode: true },
			),
			null,
		)
		assert.equal(
			resolveSourceThumbnailUrl(
				{ type: 'live', value: 'decklink://0' },
				{ channelForLive: 1, deckIdleMode: true },
			),
			null,
		)
	})

	it('still returns live thumb when deckIdleMode is off', async () => {
		const { resolveSourceThumbnailUrl } = await import('../../client/lib/thumbnail-url.js')
		const url = resolveSourceThumbnailUrl(
			{ type: 'route', value: 'route://3' },
			{ channelForLive: 1 },
		)
		assert.match(url, /\/api\/thumbnail\/live\/3/)
	})
})
