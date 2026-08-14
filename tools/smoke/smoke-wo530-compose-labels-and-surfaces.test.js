'use strict'

/**
 * WO-530 smoke — owner 14.08, three defects reported together:
 *
 *  (a) *"the compose preview just 'remembers' either the settings of looks eidotr or timeline,
 *      never both at the same time."* Both editors report into ONE shared server layout, tagged
 *      `surface` ('compose' / 'timeline'), but `tileSeedKey` is `role:mainIndex` — the surface is
 *      NOT part of it. So the two editors' `pgm_1` cells collide, each canvas seeded from whichever
 *      surface wrote last, and `seedHostLayoutFromCells` PERSISTS what it seeds — one arrangement
 *      permanently replaced the other.
 *
 *  (b) *"in decklink ports inspector there are 2 input boxes for labels."* WO-525 regression: the
 *      ports inspector mounts the shared label control itself (it must appear even before the input
 *      has a host channel) AND mounts `mountDecklinkHostSourceControls`, which mounted a second one
 *      on the same connector id.
 *
 *  (c) *"the labels then doesnt show up on the compose preview label bar."* A WO-323 source tile
 *      stores its drag payload `{ type, value, label }`, and the tile label bar rendered
 *      `def.label` — the name captured AT DROP TIME. Renaming the input never reached it.
 *
 * Offline: pure helpers where they exist, source-grep for the DOM wiring.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { readOperatorComposeTiles, REPO_ROOT } = require('./lib/operator-compose-tiles-read.js')
const { cellsForSurface } = require('../../client/components/operator-compose-tiles-state.js')
const { liveSourceLabelForValue } = require('../../client/lib/source-label.js')

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')

/* ------------------------------------------------------ (a) surface isolation */

describe('WO-530(a): a tile canvas seeds only from its own surface', () => {
	// The exact collision: same role + mainIndex, different surfaces, different rects.
	const CELLS = [
		{ id: 'pgm_1', role: 'pgm', mainIndex: 0, surface: 'compose', rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 } },
		{ id: 'pgm_1', role: 'pgm', mainIndex: 0, surface: 'timeline', rect: { x: 0.6, y: 0.6, w: 0.2, h: 0.2 } },
		{ id: 'prv_1', role: 'prv', mainIndex: 0, surface: 'compose', rect: { x: 0.5, y: 0.1, w: 0.4, h: 0.4 } },
	]

	it('splits colliding cells by surface instead of letting the last one win', () => {
		const compose = cellsForSurface(CELLS, 'compose')
		const timeline = cellsForSurface(CELLS, 'timeline')
		assert.equal(compose.length, 2, 'the looks editor keeps both of its cells')
		assert.equal(timeline.length, 1)
		assert.deepEqual(compose.find((c) => c.id === 'pgm_1').rect, { x: 0.1, y: 0.1, w: 0.4, h: 0.4 })
		assert.deepEqual(timeline[0].rect, { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }, 'the timeline keeps its own')
	})

	it('treats untagged cells as compose, so pre-existing persisted layouts still restore', () => {
		const legacy = [{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }]
		assert.equal(cellsForSurface(legacy, 'compose').length, 1, 'a record written before surfaces existed is compose')
		assert.equal(cellsForSurface(legacy, 'timeline').length, 0, 'and must NOT leak into the timeline editor')
	})

	it('both seeders filter, and each editor declares its surface', () => {
		const src = readOperatorComposeTiles()
		const seeds = src.match(/cellsForSurface\(cells, getSurface\?\.\(\)\)/g) || []
		assert.equal(seeds.length, 2, 'seedFromCells AND seedHostLayoutFromCells both filter')
		assert.match(src, /getSurface: \(\) => surface/, 'the canvas knows its own surface')
		assert.match(read('client/components/timeline-editor.js'), /surface: 'timeline'/, 'timeline editor declares it')
		// The looks editor relies on the default; pin that the default is the compose surface.
		assert.match(
			read('client/components/preview-canvas-panel.js'),
			/surface = 'compose' \} = options/,
			'the looks editor keeps the compose surface by default',
		)
	})
})

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

/* ------------------------------------------------------ (c) live label on the bar */

describe('WO-530(c): the compose label bar shows the operator’s current name', () => {
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

	it('the tile label bar uses the resolver, and relabels on a rename broadcast', () => {
		const src = readOperatorComposeTiles()
		assert.match(
			src,
			/liveSourceLabelForValue\(st\?\.extraLiveSources, def\.sourceTile\?\.value, def\.label, st\?\.sourceLabels\)/,
			'the label bar resolves through state',
		)
		assert.match(
			src,
			/stateStore\?\.on\?\.\('sourceLabels', \(\) => \{ for \(const t of tiles\.values\(\)\) relabel\(t\) \}\)/,
			'a rename repaints the bar without waiting for a full state reload',
		)
	})
})
