'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const activity = require('../../src/preview/compose-preview-activity')
const dirty = require('../../src/preview/compose-preview-dirty')

function mockOscCtx(channels) {
	return {
		oscState: {
			getSnapshot: () => ({ channels }),
		},
	}
}

describe('compose-preview-activity', () => {
	it('isStillImageClip detects png', () => {
		assert.equal(activity.isStillImageClip('logo.png'), true)
		assert.equal(activity.isStillImageClip('clip.mov'), false)
		assert.equal(activity.isStillImageClip('ndi://source'), false)
	})

	it('resolveFileRemainingSec prefers remaining then duration-elapsed', () => {
		assert.equal(activity.resolveFileRemainingSec({ remaining: 3.5 }), 3.5)
		assert.equal(activity.resolveFileRemainingSec({ duration: 10, elapsed: 4 }), 6)
		assert.equal(activity.resolveFileRemainingSec({}), null)
	})

	it('settling blocks capture until deadline', () => {
		dirty.reset()
		activity.reset()
		const ctx = mockOscCtx({})
		activity.onProgramMutation(ctx, 1, { transition: 'MIX', durationFrames: 50 })
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), false)
		assert.equal(activity.isComposePreviewSettled(1), false)
	})

	it('isComposePreviewSettled is true for untracked channel', () => {
		activity.reset()
		assert.equal(activity.isComposePreviewSettled(99), true)
	})

	it('OSC remaining > 0 keeps tick captures active', () => {
		dirty.reset()
		activity.reset()
		const ctx = mockOscCtx({
			1: {
				layers: {
					10: {
						type: 'video',
						file: { name: 'test.mov', remaining: 5.2 },
					},
				},
			},
		})
		const osc = activity.analyzeChannelOsc(ctx, 1)
		assert.equal(osc.hasActiveRemaining, true)
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), true)
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), true)
	})

	it('OSC all remaining 0/null captures once then stops', () => {
		dirty.reset()
		activity.reset()
		const ctx = mockOscCtx({
			1: {
				layers: {
					10: {
						type: 'video',
						file: { name: 'test.mov', remaining: 0 },
					},
				},
			},
		})
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), true)
		activity.onCaptureComplete(ctx, 1)
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), false)
		assert.equal(activity.getStats().idleCaptured, 1)
	})

	it('still image with null remaining captures once', () => {
		dirty.reset()
		activity.reset()
		const ctx = mockOscCtx({
			1: {
				layers: {
					10: {
						type: 'image',
						file: { name: 'still.png' },
					},
				},
			},
		})
		assert.equal(activity.analyzeChannelOsc(ctx, 1).hasActiveRemaining, false)
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), true)
		activity.onCaptureComplete(ctx, 1)
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), false)
	})

	it('video end after live does one final capture', () => {
		dirty.reset()
		activity.reset()
		const liveCtx = mockOscCtx({
			1: {
				layers: {
					10: {
						type: 'video',
						file: { name: 'test.mov', remaining: 1.5 },
					},
				},
			},
		})
		assert.equal(activity.shouldCaptureOnTick(liveCtx, 1, 125), true)
		activity.onCaptureComplete(liveCtx, 1)

		const endedCtx = mockOscCtx({
			1: {
				layers: {
					10: {
						type: 'video',
						file: { name: 'test.mov', remaining: 0 },
					},
				},
			},
		})
		assert.equal(activity.shouldCaptureOnTick(endedCtx, 1, 125), true)
		activity.onCaptureComplete(endedCtx, 1)
		assert.equal(activity.shouldCaptureOnTick(endedCtx, 1, 125), false)
	})

	it('fallback matrix captures when video playing without OSC', () => {
		dirty.reset()
		activity.reset()
		const ctx = {
			_playbackMatrix: {
				'1-10': { channel: 1, layer: 10, clip: 'test.mov', playing: true, remainingSec: 4 },
			},
		}
		const osc = activity.analyzeChannelOsc(ctx, 1)
		assert.equal(osc.source, 'fallback')
		assert.equal(osc.hasActiveRemaining, true)
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), true)
	})

	it('OSC layer with null type but file name is visible content', () => {
		dirty.reset()
		activity.reset()
		const ctx = mockOscCtx({
			1: {
				layers: {
					110: {
						type: null,
						file: { name: 'clip.mov', remaining: 12.5, duration: 60, elapsed: 47.5 },
					},
				},
			},
		})
		const osc = activity.analyzeChannelOsc(ctx, 1)
		assert.equal(osc.hasContent, true)
		assert.equal(osc.hasActiveRemaining, true)
		assert.equal(activity.shouldCaptureOnTick(ctx, 1, 125), true)
	})

	it('transitionMsFromOpts uses frames at 50fps', () => {
		const ms = activity.transitionMsFromOpts(
			{ transition: 'MIX', durationFrames: 25 },
			{ casparServer: { screen_1_mode: '1080p5000' } },
		)
		assert.ok(ms >= 500)
	})
})
