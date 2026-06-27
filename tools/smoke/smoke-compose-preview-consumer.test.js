'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	buildComposeFileAddParams,
	buildComposeStreamAddParams,
	COMPOSE_FILE_CONSUMER_INDEX,
} = require('../../src/preview/compose-preview-consumer')
const {
	buildComposeStreamConsumerArgs,
	composePreviewStreamUri,
	COMPOSE_PREVIEW_UDP_PORT_BASE,
} = require('../../src/preview/compose-preview-ffmpeg-args')

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
	})

	it('buildComposeStreamAddParams uses UDP STREAM and mpegts (fallback)', () => {
		const params = buildComposeStreamAddParams(
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
		assert.match(params, new RegExp(`udp://127\\.0\\.0\\.1:${COMPOSE_PREVIEW_UDP_PORT_BASE + 2}\\?localport=`))
		assert.match(params, /-format mpegts/)
		assert.match(params, /fps=5/)
		assert.match(params, /-codec:v libx264/)
	})

	it('composePreviewStreamUri matches consumer port base', () => {
		assert.match(composePreviewStreamUri(3), /127\.0\.0\.1:52103/)
	})

	it('buildComposeStreamConsumerArgs is video encode + stereo aac mux', () => {
		const args = buildComposeStreamConsumerArgs({ fps: 2, resolutionScale: 'half' })
		assert.match(args, /-format mpegts/)
		assert.match(args, /scale=w=iw\/2:h=ih\/2/)
		assert.match(args, /-codec:a aac/)
	})

	it('uses fixed consumer index 701 for direct FILE', () => {
		assert.equal(COMPOSE_FILE_CONSUMER_INDEX, 701)
	})
})
