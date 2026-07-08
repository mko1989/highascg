'use strict'

// WO-152 B152.2 — keyframe drag-and-drop pure logic:
// hit-test radius/value-aware Y, drag clamping (clip bounds + same-property
// neighbours), snap candidate collection, and identity-preserving time updates.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const PX_PER_MS = 0.1
const xAt = (ms) => ms * PX_PER_MS

describe('hitTestKeyframeIndex (timeline-canvas-snap)', () => {
	const load = () => import('../../client/components/timeline-canvas-snap.js')
	const clip = {
		startTime: 1000,
		duration: 4000,
		keyframes: [
			{ time: 0, property: 'fill_x', value: 0 },
			{ time: 2000, property: 'opacity', value: 1 },
		],
	}
	const rowY = 34
	const rowH = 50
	// fill_x marker: x = xAt(1000) = 100, y = rowY + rowH - 7 = 77 (bottom lane)
	// opacity@1 marker: x = xAt(3000) = 300, y = rowY + 50 - 7 - 1*(50-14) = 41 (value height)

	it('hits within the 8px radius and misses outside it', async () => {
		const { hitTestKeyframeIndex } = await load()
		assert.equal(hitTestKeyframeIndex(clip, rowY, rowH, 100, 77, xAt), 0)
		assert.equal(hitTestKeyframeIndex(clip, rowY, rowH, 107, 71, xAt), 0)
		assert.equal(hitTestKeyframeIndex(clip, rowY, rowH, 109, 77, xAt), null, '9px right of marker')
		assert.equal(hitTestKeyframeIndex(clip, rowY, rowH, 100, 90, xAt), null, '13px below marker')
	})

	it('is value-aware: opacity marker at value height, not bottom lane', async () => {
		const { hitTestKeyframeIndex } = await load()
		assert.equal(hitTestKeyframeIndex(clip, rowY, rowH, 300, 41, xAt), 1, 'at value-1 height')
		assert.equal(hitTestKeyframeIndex(clip, rowY, rowH, 300, 77, xAt), null, 'bottom lane is empty for opacity@1')
	})

	it('returns the nearest keyframe when hit zones overlap', async () => {
		const { hitTestKeyframeIndex } = await load()
		const dense = {
			startTime: 0,
			duration: 1000,
			keyframes: [
				{ time: 500, property: 'fill_x', value: 0 },
				{ time: 600, property: 'fill_y', value: 0 },
			],
		}
		// x=55px sits between markers at 50px and 60px, nearer the second.
		assert.equal(hitTestKeyframeIndex(dense, rowY, rowH, 56, 77, xAt), 1)
		assert.equal(hitTestKeyframeIndex(dense, rowY, rowH, 53, 77, xAt), 0)
	})

	it('rejects empty keyframes and too-short rows', async () => {
		const { hitTestKeyframeIndex } = await load()
		assert.equal(hitTestKeyframeIndex({ startTime: 0, keyframes: [] }, rowY, rowH, 0, 0, xAt), null)
		assert.equal(hitTestKeyframeIndex(clip, rowY, 6, 100, 34 + 6 - 7, xAt), null, 'row shorter than 8px')
	})
})

describe('clampKeyframeDragTime (timeline-state-keyframes)', () => {
	const load = () => import('../../client/lib/timeline-state-keyframes.js')
	const kfs = [
		{ time: 500, property: 'opacity', value: 0 },
		{ time: 2000, property: 'opacity', value: 1 },
		{ time: 3500, property: 'opacity', value: 0.5 },
		{ time: 2500, property: 'fill_x', value: 100 },
	]

	it('clamps to clip bounds', async () => {
		const { clampKeyframeDragTime } = await load()
		assert.equal(clampKeyframeDragTime([{ time: 100, property: 'opacity' }], 0, -50, 4000), 0)
		assert.equal(clampKeyframeDragTime([{ time: 100, property: 'opacity' }], 0, 9999, 4000), 4000)
	})

	it('cannot cross adjacent same-property keyframes (1ms gap)', async () => {
		const { clampKeyframeDragTime } = await load()
		// middle opacity kf (idx 1): clamped between 500+1 and 3500-1
		assert.equal(clampKeyframeDragTime(kfs, 1, 100, 4000), 501)
		assert.equal(clampKeyframeDragTime(kfs, 1, 3900, 4000), 3499)
		assert.equal(clampKeyframeDragTime(kfs, 1, 2200, 4000), 2200, 'free within the corridor')
	})

	it('other properties are not barriers', async () => {
		const { clampKeyframeDragTime } = await load()
		// middle opacity kf may pass the fill_x kf at 2500
		assert.equal(clampKeyframeDragTime(kfs, 1, 3000, 4000), 3000)
		// fill_x kf (idx 3, only one of its property) roams the whole clip
		assert.equal(clampKeyframeDragTime(kfs, 3, 100, 4000), 100)
		assert.equal(clampKeyframeDragTime(kfs, 3, 3900, 4000), 3900)
	})
})

describe('collectKeyframeSnapCandidates (timeline-canvas-snap)', () => {
	const load = () => import('../../client/components/timeline-canvas-snap.js')
	const draggedKf = { time: 1000, property: 'opacity', value: 1 }
	const tl = {
		duration: 10000,
		flags: [{ timeMs: 4200 }],
		layers: [
			{
				clips: [
					{ id: 'a', startTime: 1000, duration: 3000, keyframes: [draggedKf, { time: 0, property: 'opacity', value: 0 }] },
				],
			},
			{ clips: [{ id: 'b', startTime: 6000, duration: 2000, keyframes: [{ time: 500, property: 'volume', value: 1 }] }] },
		],
	}
	const getPlayback = () => ({ position: 3333 })

	it('includes playhead, flags, all clip edges and other keyframes (absolute ms)', async () => {
		const { collectKeyframeSnapCandidates } = await load()
		const { candidates, nowPointer } = collectKeyframeSnapCandidates(tl, getPlayback, { excludeKf: draggedKf })
		assert.equal(nowPointer, 3333)
		for (const expected of [0, 10000, 3333, 4200, 1000, 4000, 6000, 8000, 1000 + 0, 6000 + 500]) {
			assert.ok(candidates.includes(expected), `missing candidate ${expected}`)
		}
	})

	it('excludes the dragged keyframe by identity', async () => {
		const { collectKeyframeSnapCandidates } = await load()
		const { candidates } = collectKeyframeSnapCandidates(tl, getPlayback, { excludeKf: draggedKf })
		// dragged kf abs time is 2000; nothing else contributes 2000
		assert.ok(!candidates.includes(2000), 'dragged keyframe must not snap to itself')
	})

	it('snap pipeline: candidate within threshold wins, clamp still applies', async () => {
		const { collectKeyframeSnapCandidates, resolveSnappedEdge } = await load()
		const { clampKeyframeDragTime } = await import('../../client/lib/timeline-state-keyframes.js')
		const { candidates, nowPointer } = collectKeyframeSnapCandidates(tl, getPlayback, { excludeKf: draggedKf })
		const thresholdMs = 8 / PX_PER_MS // 80ms, matches SNAP_THRESHOLD_PX at this zoom
		// cursor at 4030 abs → snaps to clip a right edge (4000)
		const snapped = resolveSnappedEdge(4030, candidates, thresholdMs, nowPointer)
		assert.equal(snapped, 4000)
		const clip = tl.layers[0].clips[0]
		const idx = clip.keyframes.indexOf(draggedKf)
		const local = clampKeyframeDragTime(clip.keyframes, idx, snapped - clip.startTime, clip.duration)
		assert.equal(local, 3000, 'snapped to own clip end, clamped inside the clip')
	})
})

describe('updateKeyframeTime (state mutation path)', () => {
	const makeManager = async (clip) => {
		const { timelineKeyframeMethods } = await import('../../client/lib/timeline-state-keyframes.js')
		return Object.assign(
			{
				saves: 0,
				_findClip() {
					return clip
				},
				_save() {
					this.saves++
				},
			},
			timelineKeyframeMethods,
		)
	}

	it('mutates the keyframe in place (identity stable across re-sort) and saves', async () => {
		const kfA = { time: 500, property: 'opacity', value: 0 }
		const kfB = { time: 1000, property: 'fill_x', value: 10 }
		const clip = { duration: 4000, keyframes: [kfA, kfB] }
		const mgr = await makeManager(clip)
		const out = mgr.updateKeyframeTime('tl', 0, 'c', 0, 1500)
		assert.equal(out, kfA, 'returns the same object')
		assert.equal(kfA.time, 1500)
		assert.deepEqual(clip.keyframes, [kfB, kfA], 're-sorted, same objects')
		assert.equal(mgr.saves, 1)
	})

	it('clamps against same-property neighbours and clip bounds', async () => {
		const clip = {
			duration: 4000,
			keyframes: [
				{ time: 500, property: 'opacity', value: 0 },
				{ time: 2000, property: 'opacity', value: 1 },
			],
		}
		const mgr = await makeManager(clip)
		assert.equal(mgr.updateKeyframeTime('tl', 0, 'c', 1, 100).time, 501, 'blocked at neighbour + 1ms')
		assert.equal(mgr.updateKeyframeTime('tl', 0, 'c', 1, 99999).time, 4000, 'clamped to clip end')
	})

	it('no-op move does not save; bad index returns null', async () => {
		const clip = { duration: 4000, keyframes: [{ time: 500, property: 'opacity', value: 0 }] }
		const mgr = await makeManager(clip)
		assert.equal(mgr.updateKeyframeTime('tl', 0, 'c', 0, 500).time, 500)
		assert.equal(mgr.saves, 0)
		assert.equal(mgr.updateKeyframeTime('tl', 0, 'c', 5, 100), null)
	})
})
