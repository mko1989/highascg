'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	getCompanionPreviewVariableKey,
	resolveCompanionThumbOutputPath,
	companionThumbSize,
	jpegBufferToDataUri,
} = require('../../src/preview/compose-preview-companion-thumb')

describe('compose-preview-companion-thumb', () => {
	it('variable key uses compose_preview_chN_image', () => {
		assert.equal(getCompanionPreviewVariableKey(1), 'compose_preview_ch1_image')
		assert.equal(getCompanionPreviewVariableKey(3), 'compose_preview_ch3_image')
	})

	it('resolveCompanionThumbOutputPath is under media ingest', () => {
		const cfg = { composePreview: { basenamePrefix: 'highascg_preview' }, local_media_path: '/tmp/media' }
		const p = resolveCompanionThumbOutputPath(cfg, 2)
		assert.match(p, /\/tmp\/media\/highascg_preview\/ch2_companion\.jpg$/)
	})

	it('companionThumbSize clamps 32-512', () => {
		assert.equal(companionThumbSize({ composePreview: { companionThumbSize: 144 } }), 144)
		assert.equal(companionThumbSize({ composePreview: { companionThumbSize: 9999 } }), 512)
	})

	it('jpegBufferToDataUri prefixes data URI scheme', () => {
		const uri = jpegBufferToDataUri(Buffer.from('abc'))
		assert.equal(uri, 'data:image/jpeg;base64,YWJj')
	})
})
