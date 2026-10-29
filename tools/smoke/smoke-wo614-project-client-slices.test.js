'use strict'

/**
 * WO-614: the Godot previs stage lives in project.previs. The web client rebuilds its save/autosave
 * payload from a fixed key list (client/lib/project-state.js exportProject: scenes, programOutput,
 * timelines, multiview, placeholders), so ONE web autosave used to erase every stage object.
 * Server rule: a write that omits a client-owned slice keeps the stored copy; the owning client
 * always sends the key (possibly empty), which is how it edits or clears it.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const { CLIENT_OWNED_SLICES, preserveClientOwnedSlices } = require('../../src/engine/project-client-slices')

const STAGE = { stage: { version: 1, objects: [{ id: 'led_wall_1', type: 'led_wall' }] } }

describe('WO-614 client-owned project slices survive clients that do not know them', () => {
	it('previs is client-owned', () => {
		assert.ok(CLIENT_OWNED_SLICES.includes('previs'))
	})

	it('a web-shaped payload (no previs key) keeps the stored stage', () => {
		const web = { name: 'Show', scenes: [], timelines: [] }
		const kept = preserveClientOwnedSlices(web, { name: 'Show', previs: STAGE })
		assert.deepEqual(kept, ['previs'])
		assert.deepEqual(web.previs, STAGE)
	})

	it('live e2e 29.10: a web autosave keeps the stored operatorCompose (operator-screen cell layout)', () => {
		const cells = [{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]
		const web = { name: 'Show', scenes: [] }
		const kept = preserveClientOwnedSlices(web, { name: 'Show', operatorCompose: { cells } })
		assert.deepEqual(kept, ['operatorCompose'])
		assert.deepEqual(web.operatorCompose.cells, cells)
		const godot = { name: 'Show', operatorCompose: { cells: [] } }
		assert.deepEqual(preserveClientOwnedSlices(godot, { operatorCompose: { cells } }), [], 'a client that sends it wins')
	})

	it('the owning client can change or clear it (key present wins, even empty)', () => {
		const godot = { name: 'Show', previs: { stage: { version: 1, objects: [] } } }
		assert.deepEqual(preserveClientOwnedSlices(godot, { previs: STAGE }), [])
		assert.deepEqual(godot.previs.stage.objects, [], 'explicit empty stage is honoured')
	})

	it('no stored project / no stored slice → nothing invented', () => {
		const p = { name: 'New' }
		assert.deepEqual(preserveClientOwnedSlices(p, null), [])
		assert.deepEqual(preserveClientOwnedSlices(p, { name: 'New' }), [])
		assert.equal('previs' in p, false)
	})

	it('both save and autosave apply it before validating/persisting (source)', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-data-project-handlers.js'), 'utf8')
		const calls = src.match(/preserveClientOwnedSlices\(project, existing\)/g) || []
		assert.equal(calls.length, 2, 'one call in /api/project/save and one in /api/project/autosave')
		for (const route of ["'/api/project/save'", "'/api/project/autosave'"]) {
			const from = src.indexOf(route)
			const call = src.indexOf('preserveClientOwnedSlices(project, existing)', from)
			const persist = src.indexOf('persistProject(', from)
			assert.ok(from >= 0 && call > from && call < persist, `${route}: preserve runs before persistProject`)
		}
	})
})
