'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { isTemplateClip } = require('../../src/state/playback-tracker-media')

describe('playback-tracker template clip detection', () => {
	it('detects built-in Caspar template paths', () => {
		assert.equal(isTemplateClip('CASPARCG-TEMPLATES-MAIN/LOOP-IO/ONE-LINER'), true)
		assert.equal(isTemplateClip('CASPARCG-GUIDE-HTML-TEMPLATE-MASTER/HTML/LOWER-THIRD.1'), true)
	})

	it('detects TLS catalog entries', () => {
		const ctx = { CHOICES_TEMPLATES: [{ id: 'myshow/lower-third' }] }
		assert.equal(isTemplateClip('myshow/lower-third', ctx), true)
		assert.equal(isTemplateClip('clips/foo.mov', ctx), false)
	})
})
