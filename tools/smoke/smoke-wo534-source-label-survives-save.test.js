'use strict'

/**
 * WO-534 — a renamed DeckLink input reverted to its old name in both inspectors.
 *
 * Owner 14.08 (`todos14.08.26`): *"i just changed a label on decklink4 in host channel, it somehow
 * applyed on the compose preview but went back to the previous label in host ch and sdi port
 * inspectors."*
 *
 * The rename really persisted — `/api/state` and `/api/device-view` both report the new name, and
 * the compose label bar (WO-530c, which resolves through the broadcast `sourceLabels`) showed it.
 * What reverted was the two inspectors, each rendering the field from an `extraLiveSources`
 * SNAPSHOT that the save never refreshed:
 *
 *  - the ports inspector called a bare `load()`, which device-view-render.js serves from its 5s
 *    payload cache — i.e. the pre-rename snapshot, re-rendered over the field just edited. WO-436
 *    forced the other nine inspector reloads; this WO-525-era one arrived afterwards.
 *  - the host-channel inspector's `onApplied` only updates `lastPayload.extraLiveSources` when the
 *    callback carries one, and the label control passed `{ message }` — so it was never updated at
 *    all, and the next re-render from that snapshot showed the old name.
 *
 * `POST /api/sources/label` already echoes the authoritative post-save label; the control simply
 * discarded it. It now folds the echo into the array it was handed — which IS the caller's
 * `lastPayload.extraLiveSources`, by reference — so the snapshot is correct however it is re-read.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { applySavedSourceLabel, readSourceLabelState } = require('../../client/components/inspector-source-label.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

/** The live box's two named inputs, in the enriched shape both payloads carry. */
const sources = () => [
	{ connectorId: 'dlsdi_3', label: 'Cam1', generatedLabel: 'DeckLink 3', labelIsCustom: true },
	{ connectorId: 'dlsdi_4', label: 'Cam Szeroka', generatedLabel: 'DeckLink 4', labelIsCustom: true },
]

describe('WO-534: the saved name lands in the snapshot the inspectors re-read', () => {
	it('a rename is applied to the enriched entry', () => {
		const list = sources()
		applySavedSourceLabel(list, 'dlsdi_4', 'Cam Waska')
		assert.deepEqual(readSourceLabelState(list, 'dlsdi_4'), { custom: 'Cam Waska', generated: 'DeckLink 4' })
	})

	it('a blank label clears the override back to the generated name', () => {
		const list = sources()
		applySavedSourceLabel(list, 'dlsdi_3', '   ')
		assert.deepEqual(readSourceLabelState(list, 'dlsdi_3'), { custom: '', generated: 'DeckLink 3' })
	})

	it('it touches only the renamed source', () => {
		const list = sources()
		applySavedSourceLabel(list, 'dlsdi_4', 'Cam Waska')
		assert.equal(readSourceLabelState(list, 'dlsdi_3').custom, 'Cam1')
	})

	it('an unknown connector id is a no-op, not a throw', () => {
		const list = sources()
		applySavedSourceLabel(list, 'nope_9', 'x')
		applySavedSourceLabel(null, 'dlsdi_3', 'x')
		assert.equal(readSourceLabelState(list, 'dlsdi_3').custom, 'Cam1')
	})
})

describe('WO-534: both revert paths are closed', () => {
	it('the control applies the server’s echo before onSaved runs', () => {
		const src = read('client/components/inspector-source-label.js')
		assert.match(src, /const res = await api\.post\('\/api\/sources\/label'/)
		assert.match(
			src,
			/applySavedSourceLabel\(sources, key, res\?\.label\)[\s\S]{0,200}?if \(typeof onSaved === 'function'\)/,
			'the snapshot must be correct before any re-render the callback triggers',
		)
	})

	it('the ports inspector forces a fresh payload', () => {
		assert.match(
			read('client/components/device-view-inspector-decklink-input.js'),
			/onSaved: \(\) => load\?\.\(\{ forceRefresh: true \}\)/,
			'a bare load() is answered by the 5s payload cache',
		)
	})

	it('the server still echoes the authoritative label', () => {
		assert.match(
			read('src/api/routes-sources.js'),
			/jsonBody\(\{ ok: true, sourceId, label: res\.sourceLabels\[sourceId\] \?\? '', sourceLabels: res\.sourceLabels \}\)/,
			'the client fix depends on this echo',
		)
	})
})
