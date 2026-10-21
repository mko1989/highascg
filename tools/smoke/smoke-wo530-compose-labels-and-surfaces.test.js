'use strict'

/**
 * WO-530 smoke — owner 14.08, three defects reported together:
 *
 *  (a) the compose preview "remembers" either the looks editor or the timeline editor's settings.
 *      That was the kiosk's shared tile layout (`surface` tags, operator-compose-tiles*.js); it went
 *      with the Firefox kiosk (WO-646), and so did its cases.
 *
 *  (b) "in decklink ports inspector there are 2 input boxes for labels." WO-525 regression: the
 *      ports inspector mounts the shared label control, and must not also get one from the host
 *      controls.
 *
 *  (c) the compose label bar must show the operator's current name, not the name captured at drop
 *      time. The resolver (source-label.js) remains. The tile label-bar wiring in
 *      operator-compose-tiles*.js was deleted in WO-646, so that case was removed.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { liveSourceLabelForValue } = require('../../client/lib/source-label.js')

const REPO_ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')

/* ------------------------------------------------------ (b) one label control */

describe('WO-530(b): the DeckLink ports inspector mounts exactly one Label field', () => {
	it('the ports inspector suppresses the host controls’ own label', () => {
		const src = read('client/components/device-view-inspector-decklink-input.js')
		assert.equal((src.match(/mountSourceLabelControl\(/g) || []).length, 1, 'it mounts the label itself, once')
		assert.match(src, /includeLabel: false/, 'and tells the host controls not to mount a second one')
	})

	it('the host-channel inspector still gets a label (the option defaults to on)', () => {
		const src = read('client/components/inspector-decklink-host.js')
		assert.match(src, /includeLabel = true/, 'default is unchanged for every other caller')
		assert.match(src, /if \(includeLabel\) mountSourceLabelControl\(/, 'the mount is gated, not deleted')
		const host = read('client/components/device-view-destinations-inspector-host-channel.js')
		assert.doesNotMatch(host, /includeLabel: false/, 'the host-channel inspector must keep its label')
	})
})

/* ------------------------------------------------------ (c) live label resolver */

describe('WO-530(c): the live source label resolves to the operator’s current name', () => {
	const SOURCES = [
		{ value: 'route://5-3', label: 'Cam1', generatedLabel: 'DeckLink 3', labelIsCustom: true, connectorId: 'dlsdi_3', sourceLabelKey: 'dlsdi_3' },
		{ value: 'route://6-4', label: 'DeckLink 4', generatedLabel: 'DeckLink 4', labelIsCustom: false, connectorId: 'dlsdi_4', sourceLabelKey: 'dlsdi_4' },
	]

	it('resolves the current name from state, not the name captured at drop time', () => {
		assert.equal(liveSourceLabelForValue(SOURCES, 'route://5-3', 'DeckLink 3'), 'Cam1')
	})

	it('a rename shows immediately — sourceLabels outranks the not-yet-repushed extraLiveSources', () => {
		// The server broadcasts only `change { path: 'sourceLabels' }`, so extraLiveSources is stale here.
		const labels = { dlsdi_3: 'Wide' }
		assert.equal(liveSourceLabelForValue(SOURCES, 'route://5-3', 'DeckLink 3', labels), 'Wide')
		// Untouched sources are unaffected by someone else's override.
		assert.equal(liveSourceLabelForValue(SOURCES, 'route://6-4', 'DeckLink 4', labels), 'DeckLink 4')
	})

	it('falls back to the stored payload label when the source has left state', () => {
		assert.equal(liveSourceLabelForValue(SOURCES, 'route://9-9', 'Old Cam'), 'Old Cam')
		assert.equal(liveSourceLabelForValue(null, 'route://5-3', 'Old Cam'), 'Old Cam')
	})
})
