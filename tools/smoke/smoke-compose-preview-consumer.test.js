'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	buildComposeFileAddParams,
	COMPOSE_FILE_CONSUMER_INDEX,
} = require('../../src/preview/compose-preview-consumer')

describe('compose-preview-consumer', () => {
	it('buildComposeFileAddParams uses media/ path and image2 mjpeg', () => {
		const params = buildComposeFileAddParams(
			{
				composePreview: {
					fps: 5,
					resolutionScale: 'half',
					jpegQuality: 8,
					basenamePrefix: 'highascg_preview',
				},
			},
			2,
		)
		assert.match(params, /^media\/highascg_preview\/ch2\.jpg /)
		assert.match(params, /-format image2 -update 1/)
		assert.match(params, /format=yuvj420p/)
		assert.match(params, /fps=5/)
		assert.match(params, /-codec:v mjpeg/)
		assert.match(params, /-q:v:v 8/)
	})

	it('buildComposeFileAddParams includes -r argument from fps setting (T201.4)', () => {
		const params = buildComposeFileAddParams(
			{
				composePreview: {
					fps: 25,
					resolutionScale: 'half',
					jpegQuality: 10,
					basenamePrefix: 'highascg_preview',
				},
			},
			2,
		)
		assert.match(params, /-r 25/, 'includes -r with fps')
	})

	it('uses fixed consumer index 701 for direct FILE', () => {
		assert.equal(COMPOSE_FILE_CONSUMER_INDEX, 701)
	})
})
