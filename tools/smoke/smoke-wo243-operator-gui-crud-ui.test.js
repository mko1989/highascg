'use strict'

/**
 * WO-243/255 smoke tests — Operator GUI channel: device-view CRUD single-instance validation and
 * client-gate/UI source checks.
 *
 * Split out of smoke-wo243-operator-gui.test.js (line-count refactor, originally 599 lines) — this
 * file owns T243.1's CRUD validation/patch-merge coverage and T243.1/T243.2/T243.3/T255.3's
 * UI + client-gate source checks. Destination model, routing, generator, layout-endpoint pure
 * logic and router registration stay in smoke-wo243-operator-gui.test.js. The program-screen-slot
 * regression guard, boot-window shrink guard, and never-persist-an-empty-layout guard live in
 * smoke-wo243-operator-gui-guards.test.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { handleAddDestination, handleUpdateDestination } = require('../../src/api/device-view-crud')

describe('WO-243 T243.1: device-view CRUD single-instance validation + operator_gui patch merge', () => {
	function mockCtx(initialConfig) {
		const config = initialConfig
		return {
			config,
			configManager: {
				get: () => config,
				save: (next) => Object.assign(config, next),
			},
		}
	}

	it('handleAddDestination creates an operator_gui destination (no kiosk guiUrl, WO-664)', () => {
		const ctx = mockCtx({ screenDestinations: { version: 1, destinations: [] } })
		const res = handleAddDestination({ addDestination: { type: 'operator_gui', mainScreenIndex: 0 } }, ctx)
		assert.equal(res.ok, true)
		const d = res.screenDestinations.destinations.find((x) => x.id === res.addedId)
		assert.equal(d.mode, 'operator_gui')
		assert.equal('guiUrl' in d, false)
		assert.equal(d.autoLaunch, true)
	})

	it('handleAddDestination rejects a second operator_gui destination', () => {
		const ctx = mockCtx({
			screenDestinations: { version: 1, destinations: [{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1' }] },
		})
		const res = handleAddDestination({ addDestination: { type: 'operator_gui', mainScreenIndex: 1 } }, ctx)
		assert.ok(res.error, 'second operator_gui destination is rejected')
		assert.equal(ctx.config.screenDestinations.destinations.length, 1)
	})

	it('handleUpdateDestination rejects switching a second destination\'s mode to operator_gui', () => {
		const ctx = mockCtx({
			screenDestinations: {
				version: 1,
				destinations: [
					{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1' },
					{ id: 'scr1', mainScreenIndex: 1, mode: 'pgm_prv' },
				],
			},
		})
		const res = handleUpdateDestination({ updateDestination: { id: 'scr1', mode: 'operator_gui' } }, ctx)
		assert.ok(res.error)
	})

	it('handleUpdateDestination merges a physicalPort patch without clobbering autoLaunch; drops a saved guiUrl', () => {
		const ctx = mockCtx({
			screenDestinations: {
				version: 1,
				destinations: [{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1', physicalPort: 2, autoLaunch: false }],
			},
		})
		const res = handleUpdateDestination({ updateDestination: { id: 'og1', physicalPort: 3 } }, ctx)
		assert.equal(res.ok, true)
		const d = res.screenDestinations.destinations[0]
		assert.equal(d.physicalPort, 3, 'patched field applied')
		assert.equal(d.autoLaunch, false, 'sibling field preserved, not clobbered')
		assert.equal('guiUrl' in d, false, 'WO-664: a saved kiosk URL is dropped')
	})

	it('handleUpdateDestination honours autoLaunch:false on patch (todos22 "can\'t uncheck autostart gui")', () => {
		const ctx = mockCtx({
			screenDestinations: {
				version: 1,
				destinations: [{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?operatorGui=1', autoLaunch: true }],
			},
		})
		const res = handleUpdateDestination({ updateDestination: { id: 'og1', autoLaunch: false } }, ctx)
		assert.equal(res.ok, true)
		const d = res.screenDestinations.destinations[0]
		assert.equal(d.autoLaunch, false, 'explicit autoLaunch:false must stick — the merge used to drop it and the box re-checked the box')
		assert.equal(d.mode, 'operator_gui', 'untouched fields preserved')
	})

	it('handleUpdateDestination preserves autoLaunch when the patch omits it, and honours headless (WO-325)', () => {
		const ctx = mockCtx({
			screenDestinations: {
				version: 1,
				destinations: [{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?operatorGui=1', autoLaunch: false, headless: false }],
			},
		})
		const res = handleUpdateDestination({ updateDestination: { id: 'og1', headless: true } }, ctx)
		assert.equal(res.ok, true)
		const d = res.screenDestinations.destinations[0]
		assert.equal(d.autoLaunch, false, 'omitted field keeps its stored value')
		assert.equal(d.headless, true, 'explicit headless:true applied')
	})

	it('handleUpdateDestination honours videoOutput/shmName (WO-597: switching the operator GUI to shm was dropped)', () => {
		const ctx = mockCtx({
			screenDestinations: {
				version: 1,
				destinations: [{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?operatorGui=1', videoOutput: 'screen', shmName: 'opgui' }],
			},
		})
		let d = handleUpdateDestination({ updateDestination: { id: 'og1', videoOutput: 'shm' } }, ctx).screenDestinations.destinations[0]
		assert.equal(d.videoOutput, 'shm', 'explicit videoOutput:shm must stick')
		assert.equal(d.shmName, 'opgui', 'omitted shmName keeps its stored value')
		d = handleUpdateDestination({ updateDestination: { id: 'og1', shmName: 'opgui2' } }, ctx).screenDestinations.destinations[0]
		assert.equal(d.shmName, 'opgui2')
		assert.equal(d.videoOutput, 'shm', 'omitted videoOutput keeps its stored value')
	})
})

describe('WO-243/255 T243.1/T243.2/T243.3: UI source checks', () => {
	const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

	it('destination type select + inspector form know about operator_gui', () => {
		assert.match(read('client/lib/device-view-host-channels.js'), /value:\s*'operator_gui'/)
		const form = read('client/components/device-view-destinations-inspector-form.js')
		assert.match(form, /'operator_gui'/)
		assert.match(form, /buildOperatorGuiFields/)
	})

	it('addDestination() client action normalizes the operator_gui type', () => {
		assert.match(read('client/components/device-view-actions.js'), /o\.type === 'operator_gui'/)
	})

	it('device-view-crud enforces at most one operator_gui destination', () => {
		assert.match(read('src/api/device-view-crud.js'), /At most one Operator GUI destination is allowed/)
	})

	it('WO-646: kiosk client-gate files stay deleted (cef-operator-mode rename, orphan timeline-editor-preview, old CSS)', () => {
		assert.ok(!fs.existsSync(path.join(__dirname, '../../client/lib/cef-operator-mode.js')), 'old file removed')
		assert.ok(
			!fs.existsSync(path.join(__dirname, '../../client/components/timeline-editor-preview.js')),
			'orphaned timeline-editor-preview.js stays deleted (dead copy that masked the WO-255 wiring regression)',
		)
		assert.ok(!fs.existsSync(path.join(__dirname, '../../client/styles/10-cef-operator-mode.css')), 'old CSS file removed')
	})
})
