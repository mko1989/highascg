'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	buildComposeFfmpegConsumerArgs,
	buildComposeFfmpegFilterChain,
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

	it('buildComposeFfmpegFilterChain uses yuvj420p for mjpeg FILE consumer', () => {
		const chain = buildComposeFfmpegFilterChain({ fps: 5, resolutionScale: 'half' })
		assert.match(chain, /scale=iw\/2:ih\/2/)
		assert.match(chain, /fps=5/)
		assert.match(chain, /format=yuvj420p/)
		assert.match(chain, /in_range=limited:out_range=full/)
	})

	it('buildComposeFfmpegFilterChain ignores companionThumbEnabled (square derived server-side, WO-110)', () => {
		const chain = buildComposeFfmpegFilterChain({
			fps: 25,
			resolutionScale: 'half',
			companionThumbEnabled: true,
			companionThumbSize: 144,
		})
		assert.match(chain, /scale=iw\/2:ih\/2/)
		assert.match(chain, /fps=25/)
		assert.doesNotMatch(chain, /pad=144:144/)
	})

	it('buildComposeFfmpegConsumerArgs keeps image2 for static config embed', () => {
		const args = buildComposeFfmpegConsumerArgs({ fps: 2, resolutionScale: 'half', jpegQuality: 10 })
		assert.match(args, /-format image2 -update 1/)
		assert.match(args, /-codec:v mjpeg/)
		assert.match(args, /format=yuvj420p/)
		assert.match(args, /-q:v:v 10/)
		assert.doesNotMatch(args, /format=yuv420p/)
	})

	it('buildComposeFfmpegConsumerArgs includes -r to limit image2 output fps (T201.4)', () => {
		const args = buildComposeFfmpegConsumerArgs({ fps: 25, resolutionScale: 'half', jpegQuality: 10 })
		assert.match(args, /-r 25/, 'includes -r with configured fps')
		assert.match(args, /fps=25/, 'filter chain also uses fps')
	})

	it('buildComposeFfmpegConsumerArgs -r respects fps clamping', () => {
		const argsLow = buildComposeFfmpegConsumerArgs({ fps: 0, resolutionScale: 'half', jpegQuality: 10 })
		assert.match(argsLow, /-r 1/, 'clamps low fps to 1')
		const argsHigh = buildComposeFfmpegConsumerArgs({ fps: 99, resolutionScale: 'half', jpegQuality: 10 })
		assert.match(argsHigh, /-r 30/, 'clamps high fps to 30')
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
