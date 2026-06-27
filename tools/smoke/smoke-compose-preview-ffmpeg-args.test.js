'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	buildComposeFfmpegConsumerArgs,
	buildComposeFfmpegFilterChain,
	buildComposeStreamConsumerArgs,
	buildScaleFilter,
	clampComposePreviewFps,
	normalizeResolutionScale,
} = require('../../src/preview/compose-preview-ffmpeg-args')
const { buildComposePreviewFfmpegConsumerXml } = require('../../src/config/config-generator-audio-xml')
const { normalizeComposePreviewSettings } = require('../../src/preview/compose-preview-mode')

describe('compose-preview-ffmpeg-args', () => {
	it('clampComposePreviewFps allows up to 30', () => {
		assert.equal(clampComposePreviewFps(30), 30)
		assert.equal(clampComposePreviewFps(99), 30)
		assert.equal(clampComposePreviewFps(0), 1)
	})

	it('buildScaleFilter uses iw/ih relative scale', () => {
		assert.equal(buildScaleFilter('half'), 'scale=iw/2:ih/2')
		assert.equal(buildScaleFilter('75'), 'scale=trunc(iw*3/4/2)*2:trunc(ih*3/4/2)*2')
		assert.equal(buildScaleFilter('full'), null)
	})

	it('buildComposeFfmpegFilterChain includes fps', () => {
		const chain = buildComposeFfmpegFilterChain({ fps: 5, resolutionScale: 'half' })
		assert.match(chain, /scale=iw\/2:ih\/2/)
		assert.match(chain, /fps=5/)
	})

	it('buildComposeStreamConsumerArgs uses mpegts with stereo downmix (no -an)', () => {
		const args = buildComposeStreamConsumerArgs({ fps: 2, resolutionScale: 'half', jpegQuality: 10 })
		assert.match(args, /-format mpegts/)
		assert.match(args, /-codec:v libx264/)
		assert.match(args, /-filter:a aformat=channel_layouts=stereo/)
		assert.doesNotMatch(args, /-an/)
	})

	it('buildComposeFfmpegConsumerArgs keeps image2 for static config embed', () => {
		const args = buildComposeFfmpegConsumerArgs({ fps: 2, resolutionScale: 'half', jpegQuality: 10 })
		assert.match(args, /-format image2 -update 1/)
		assert.match(args, /-codec:v mjpeg/)
	})

	it('buildComposePreviewFfmpegConsumerXml embeds path when static config enabled', () => {
		const config = {
			composePreview: {
				mode: 'ffmpeg_jpeg',
				fps: 3,
				resolutionScale: '75',
				jpegQuality: 8,
				basenamePrefix: 'highascg_preview',
				attachViaAmcp: false,
				embedConsumersInCasparConfig: true,
			},
			screen_count: 1,
		}
		const xml = buildComposePreviewFfmpegConsumerXml(config, 2)
		assert.match(xml, /<ffmpeg>/)
		assert.match(xml, /highascg_preview\/ch2\.jpg/)
		assert.match(xml, /fps=3/)
		assert.match(xml, /iw\*3\/4/)
	})

	it('normalizeComposePreviewSettings clamps fps to 30', () => {
		const out = normalizeComposePreviewSettings({ mode: 'ffmpeg_jpeg', fps: 45 }, { fps: 2 })
		assert.equal(out.fps, 30)
		assert.equal(normalizeResolutionScale(out.resolutionScale), 'half')
	})
})
