'use strict'

const assert = require('assert')
const { normalizeEditorDefaults } = require('../../src/config/editor-defaults')
const {
	resolvePlaySeekFramesForSceneLayer,
	resolveTimelineClipFrame,
	resolveEffectiveStartBehaviour,
	getLivePlayheadFrames,
} = require('../../src/engine/scene-play-seek')

const ed = normalizeEditorDefaults({ scene: { loop: true }, customFlag: true }, {})
assert.strictEqual(ed.scene.loop, true)
assert.strictEqual(ed.customFlag, true)

assert.strictEqual(resolveEffectiveStartBehaviour({ startBehaviour: null }, { startBehaviour: 'relativeToPrevious' }), 'relativeToPrevious')
assert.strictEqual(resolveEffectiveStartBehaviour({ startBehaviour: 'beginning' }, { startBehaviour: 'relativeToPrevious' }), 'beginning')

const matrixCtx = {
	_playbackMatrix: {
		'1-10': {
			channel: 1,
			layer: 10,
			clip: 'clip.mp4',
			startedAt: Date.now() - 2000,
			durationMs: 60000,
			playing: true,
			loop: false,
			isRoute: false,
		},
	},
}
const phys = (ln, bank) => (bank === 'b' ? ln + 100 : ln)
const seek = resolvePlaySeekFramesForSceneLayer(
	{ startBehaviour: 'relativeToPrevious' },
	matrixCtx,
	{ channel: 1, layerNumber: 10, physicalLayer: 10, fps: 25, forceCut: false, phys, activeBank: 'a', incoming: { layers: [{ layerNumber: 10 }] } }
)
assert.ok(seek >= 49, `expected ~50 frames, got ${seek}`)

matrixCtx._lastPlayFrameByChannelLayer = { '1-10': 42 }
const cutSeek = resolvePlaySeekFramesForSceneLayer(
	{ startBehaviour: 'relativeToPrevious' },
	matrixCtx,
	{ channel: 1, layerNumber: 10, physicalLayer: 10, fps: 25, forceCut: true, phys, activeBank: 'a', incoming: { layers: [{ layerNumber: 10 }] } }
)
assert.strictEqual(cutSeek, 42)

const beginSeek = resolvePlaySeekFramesForSceneLayer(
	{ startBehaviour: 'beginning' },
	matrixCtx,
	{ channel: 1, layerNumber: 3, physicalLayer: 3, fps: 25, forceCut: false, phys, activeBank: 'a', incoming: { layers: [{ layerNumber: 3 }] } }
)
assert.strictEqual(beginSeek, 0)

const tl = { fps: 25, layers: [{ clips: [{ id: 'c1', source: { value: 'a.mp4' }, startTime: 0, duration: 10000, inPoint: 12, startBehaviour: 'beginning' }] }] }
const clip = tl.layers[0].clips[0]
const entry = resolveTimelineClipFrame(clip, 4000, tl, {}, { atEntry: true, channel: 1, physicalLayer: 5 })
assert.strictEqual(entry.frame, 12)
const playhead = resolveTimelineClipFrame(clip, 4000, tl, {}, { atEntry: false, channel: 1, physicalLayer: 5 })
assert.strictEqual(playhead.frame, 12 + 100)

const oscCtx = {
	oscState: {
		getSnapshot: () => ({
			channels: {
				1: {
					layers: {
						5: { type: 'video', file: { frameElapsed: 77, frameTotal: 200 } },
					},
				},
			},
		}),
	},
}
assert.strictEqual(getLivePlayheadFrames(oscCtx, 1, 5, 25), 77)

const relEntry = resolveTimelineClipFrame(
	{ ...clip, startBehaviour: 'relativeToPrevious' },
	4000,
	tl,
	oscCtx,
	{ atEntry: true, channel: 1, physicalLayer: 5 }
)
assert.strictEqual(relEntry.frame, 77)

// Scrub/seek must not use clip-entry frame (atEntry=true would restart at inPoint).
const scrubMid = resolveTimelineClipFrame(clip, 4000, tl, {}, { atEntry: false, channel: 1, physicalLayer: 5 })
assert.strictEqual(scrubMid.frame, 112, 'seek at 4s → inPoint 12 + 100 frames')
const scrubEntryWrong = resolveTimelineClipFrame(clip, 4000, tl, {}, { atEntry: true, channel: 1, physicalLayer: 5 })
assert.strictEqual(scrubEntryWrong.frame, 12, 'atEntry would wrongly SEEK inPoint only')

console.log('smoke-editor-defaults: OK')
