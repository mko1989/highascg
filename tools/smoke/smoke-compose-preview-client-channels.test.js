'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('resolveComposePreviewChannelsFromChannelMap (client)', () => {
	it('includes PGM/PRV per screen but excludes multiview channel', async () => {
		const { resolveComposePreviewChannelsFromChannelMap } = await import(
			'../../client/lib/compose-preview-url.js'
		)
		const cm = {
			screenCount: 3,
			programChannels: [1, 3, 5],
			previewChannels: [2, null, null],
			previewEnabledByMain: [true, false, false],
			multiviewCh: 5,
		}
		const ch = resolveComposePreviewChannelsFromChannelMap(cm)
		assert.deepEqual(ch, [1, 2, 3])
	})
})
