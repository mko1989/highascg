'use strict'

/**
 * WO-523 — swapping the media under a timeline clip keeps the clip the operator built.
 *
 * Owner 13.08: *"when copying a clip in timelines to another layer then dropping a different media
 * on to it, i want it to preserve all the settings (resolution should be similar when ratios doest
 * match). also when the clip was 'extended' (dragged by the clips edge to make take up more space
 * in the timeline) it should preserve that too."*
 *
 * `replaceClipSource` overwrote `clip.duration` with the incoming media's length unconditionally, so
 * any edge-drag was discarded. Nothing recorded the media's own length, so "extended" could not be
 * told from "happens to match its media" after the fact — `naturalDuration` is what makes the two
 * distinguishable.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** Drive the real store methods without a DOM. */
function loadClipStore() {
	// Strip BOTH single-line and multi-line import blocks — a naive per-line strip leaves the
	// closing `} from '...'` behind and the Function constructor dies on it.
	const src = read('client/lib/timeline-state-clips.js')
	const body = src
		.replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*\n/g, '')
		.replace(/import[^\n{]*from\s*'[^']*'\s*\n/g, '')
		.replace(/export const |export default /g, 'const ')
	const name = /const (\w+) = \{/.exec(body)?.[1] || 'timelineStateClips'
	// addClip needs `defaultClip` from the model; these tests only exercise replaceClipSource, so a
	// stub keeps the module evaluable without pulling the whole model in.
	const store = new Function('defaultClip', 'uid', 'flagUid', 'computeContentEndMs', 'CONTENT_END_PADDING_MS',
		`${body}; return ${name}`)(() => ({}), () => 'id', () => 'id', () => 0, 0)
	// Minimal host: the methods only need getTimeline/_findClip/_save/expandDurationToContent.
	const tl = { id: 't1', duration: 60000, layers: [{ clips: [] }] }
	store.getTimeline = () => tl
	store._findClip = (_id, li, cid) => tl.layers[li].clips.find((c) => c.id === cid) || null
	store._save = () => {}
	store.expandDurationToContent = () => {}
	return { store, tl }
}

function makeClip(tl, over) {
	const clip = {
		id: 'c1',
		source: { type: 'media', value: 'old.mp4' },
		startTime: 0,
		duration: 5000,
		naturalDuration: 5000,
		inPoint: 0,
		outPoint: null,
		keyframes: [],
		fillPx: { x: 100, y: 50, w: 800, h: 400 },
		...over,
	}
	tl.layers[0].clips = [clip]
	return clip
}

test('WO-523: an EXTENDED clip keeps its length when the media is swapped', () => {
	const { store, tl } = loadClipStore()
	makeClip(tl, { duration: 12000, naturalDuration: 5000 }) // operator dragged 5s -> 12s
	const out = store.replaceClipSource('t1', 0, 'c1', { type: 'media', value: 'new.mp4' }, 3000)
	assert.equal(out.duration, 12000, 'THE BUG: the edge-drag was discarded and the clip snapped to 3s')
})

test('WO-523: a clip that simply matched its media adopts the new length', () => {
	const { store, tl } = loadClipStore()
	makeClip(tl, { duration: 5000, naturalDuration: 5000 })
	const out = store.replaceClipSource('t1', 0, 'c1', { type: 'media', value: 'new.mp4' }, 9000)
	assert.equal(out.duration, 9000, 'an untouched clip should follow its media')
})

test('WO-523: a SHORTENED clip is preserved too — any operator resize counts', () => {
	const { store, tl } = loadClipStore()
	makeClip(tl, { duration: 2000, naturalDuration: 5000 })
	const out = store.replaceClipSource('t1', 0, 'c1', { type: 'media', value: 'new.mp4' }, 9000)
	assert.equal(out.duration, 2000)
})

test('WO-523: a legacy clip with no naturalDuration is PRESERVED, not shrunk', () => {
	// Clips created before this was tracked. Silently shrinking one the operator had stretched is
	// the worse error, so unknown provenance resolves toward keeping the length.
	const { store, tl } = loadClipStore()
	const c = makeClip(tl, { duration: 15000 })
	delete c.naturalDuration
	const out = store.replaceClipSource('t1', 0, 'c1', { type: 'media', value: 'new.mp4' }, 4000)
	assert.equal(out.duration, 15000)
})

test('WO-523: the incoming media length is recorded for the NEXT swap', () => {
	const { store, tl } = loadClipStore()
	makeClip(tl, { duration: 5000, naturalDuration: 5000 })
	const out = store.replaceClipSource('t1', 0, 'c1', { type: 'media', value: 'new.mp4' }, 9000)
	assert.equal(out.naturalDuration, 9000, 'otherwise the next swap cannot tell resized from natural')
})

test('WO-523: the transform survives; trim points reset', () => {
	const { store, tl } = loadClipStore()
	makeClip(tl, { duration: 12000, naturalDuration: 5000, inPoint: 1200, outPoint: 4000 })
	const out = store.replaceClipSource('t1', 0, 'c1', { type: 'media', value: 'new.mp4' }, 3000)
	assert.deepEqual(out.fillPx, { x: 100, y: 50, w: 800, h: 400 }, '"preserve all the settings"')
	// Trim points index into the OUTGOING media and mean nothing for a different file.
	assert.equal(out.inPoint, 0)
	assert.equal(out.outPoint, null)
})

test('WO-523: keyframes are clamped to the PRESERVED duration, not the incoming one', () => {
	const { store, tl } = loadClipStore()
	makeClip(tl, {
		duration: 12000,
		naturalDuration: 5000,
		keyframes: [{ property: 'opacity', time: 11000, value: 1 }],
	})
	const out = store.replaceClipSource('t1', 0, 'c1', { type: 'media', value: 'new.mp4' }, 3000)
	assert.equal(out.keyframes[0].time, 11000, 'clamping to the 3s incoming length would destroy it')
})

test('WO-523: a new clip records its natural duration on creation', () => {
	const src = read('client/lib/timeline-state-clips.js')
	assert.match(src, /clip\.naturalDuration = clip\.duration/, 'addClip must seed it or nothing can compare later')
})

test('WO-523: the drop handler re-fits the new media into the old rect (WO-520 rule)', () => {
	const src = read('client/components/timeline-editor-handlers.js')
	assert.match(src, /refitExchangedClipToOldRect/, 'the aspect refit must be wired')
	assert.match(src, /containRectPreservingAspect/, 'and reuse the shared contain-fit, not a second copy')
	const body = /async function refitExchangedClipToOldRect\([\s\S]*?\n\}/.exec(src)[0]
	assert.match(body, /if \(!\(res\?\.w > 0 && res\?\.h > 0\)\) return/, 'unknown resolution must not guess')
	assert.match(body, /catch \{/, 'the swap already succeeded; a failed refit must stay silent')
})
