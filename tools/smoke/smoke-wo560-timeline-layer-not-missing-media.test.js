'use strict'

/**
 * WO-560 — a timeline layer was permanently flagged as "missing media".
 *
 * Owner: *"the warning triangle in the web gui is still present. its there all the time. it seems
 * like it was added as a test. find it and remove it."*
 *
 * Traced live: `document.querySelector('.scenes-card__missing-badge')` — the WO-360 "this look
 * carries media Caspar doesn't know" corner badge — with
 * `title="Missing in Caspar media:\ntmsro89fsecg"`. `tmsro89fsecg` is not a media filename at all:
 * it is the `id` of the project's one Timeline object (`project.timelines.timelines[0].id` and
 * `.timelines.activeId`), and it is also the `source.value` of Look 5's one layer, whose
 * `source.type` is `"timeline"` (confirmed by reading `projects/test420.json` directly).
 *
 * `missingMediaInScene` (`media-exists.js`) pushed `layer.source.value` into its check for EVERY
 * layer, with no regard for `layer.source.type`. `clipMissing`'s own filtering
 * (`NON_MEDIA_RE`/`TEMPLATE_PATH_RE`) is a VALUE-pattern match — `route://`, `https://`, `decklink`,
 * `color`, template-ish paths — and a timeline id is just an opaque alphanumeric string that
 * matches none of those patterns, so it slipped through as if it were a plausible-but-absent clip
 * name. Since the timeline is a permanent part of the project (its own object, not a Caspar media
 * file), the look carrying it was flagged forever — read by the owner as "there all the time...
 * seems like it was added as a test" (it does look exactly like a stray test fixture id).
 *
 * Fix: `missingMediaInScene` now skips any layer whose `source.type` is never a Caspar media clip
 * path in the first place (`timeline`, `template`, `live_audio`, `placeholder`, `effect`,
 * `browser`, `route`) before ever looking at its `.value`.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { missingMediaInScene, clipMissing, initMediaExistsIndex } = require('../../client/lib/media-exists.js')

function makeStateStore(media) {
	const handlers = { media: [], '*': [] }
	return {
		getState: () => ({ media }),
		on: (evt, fn) => {
			if (handlers[evt]) handlers[evt].push(fn)
		},
	}
}

describe('WO-560: a timeline layer is never flagged as missing media', () => {
	it('reproduces the exact live case: a timeline-type layer whose value is a timeline id', () => {
		initMediaExistsIndex(makeStateStore([{ id: 'testowe/forest_jester-dv', name: 'forest_jester' }]))
		const scene = {
			id: 'scene-5',
			name: 'Look 5',
			layers: [
				{
					layerNumber: 10,
					source: { type: 'timeline', value: 'tmsro89fsecg', isPlaceholder: false },
				},
			],
		}
		assert.deepEqual(missingMediaInScene(scene), [], 'a timeline layer must never be reported as missing media')
	})

	it('regression check: without the type guard, the identical layer WAS flagged (the bug)', () => {
		initMediaExistsIndex(makeStateStore([{ id: 'testowe/forest_jester-dv', name: 'forest_jester' }]))
		// clipMissing alone (no type awareness) is exactly what the pre-fix loop relied on.
		assert.equal(clipMissing('tmsro89fsecg'), true, 'documents why the value alone looks exactly like a missing clip')
	})

	it('a genuinely missing plain-media layer is still correctly flagged', () => {
		initMediaExistsIndex(makeStateStore([{ id: 'testowe/forest_jester-dv', name: 'forest_jester' }]))
		const scene = {
			id: 'scene-x',
			layers: [{ layerNumber: 10, source: { type: 'media', value: 'testowe/does-not-exist' } }],
		}
		assert.deepEqual(missingMediaInScene(scene), ['testowe/does-not-exist'])
	})

	it('an untyped (legacy) layer is still checked — the guard only excludes KNOWN non-media types', () => {
		initMediaExistsIndex(makeStateStore([{ id: 'testowe/forest_jester-dv', name: 'forest_jester' }]))
		const scene = {
			id: 'scene-legacy',
			layers: [{ layerNumber: 10, source: { value: 'testowe/does-not-exist' } }],
		}
		assert.deepEqual(missingMediaInScene(scene), ['testowe/does-not-exist'])
	})

	it('template/live_audio/placeholder/effect/browser/route layers are also excluded', () => {
		initMediaExistsIndex(makeStateStore([]))
		for (const type of ['template', 'live_audio', 'placeholder', 'effect', 'browser', 'route']) {
			const scene = { id: `scene-${type}`, layers: [{ layerNumber: 10, source: { type, value: 'anything-not-in-the-media-list' } }] }
			assert.deepEqual(missingMediaInScene(scene), [], `${type} layers must never be flagged`)
		}
	})
})

describe('WO-560: wired end-to-end', () => {
	it('media-exists.js filters by layer.source.type before checking the value', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../client/lib/media-exists.js'), 'utf8')
		assert.match(src, /NON_PLAIN_MEDIA_LAYER_TYPES\.has\(layer\?\.source\?\.type\)/)
		assert.match(src, /'timeline'/)
	})
})
