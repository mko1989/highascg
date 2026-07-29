'use strict'

/**
 * WO-270: screen labels + streaming channel are Devices-tab-only; WO-268 CEF GPU checkbox.
 * Offline-only source asserts (client ESM).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '../..')

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

describe('WO-270: settings modal cleanup', () => {
	it('defaults pane no longer carries streaming/labels markup, only the pointer note', () => {
		const tpl = src('client/components/settings-modal-templates.js')
		assert.ok(!tpl.includes('set-streaming-ch-'), 'streaming channel form must be gone')
		assert.ok(!tpl.includes('settings-screen-labels-mount'), 'screen labels mount must be gone')
		assert.match(tpl, /configured in the <strong>Devices<\/strong> tab/)
	})

	it('modal logic no longer collects streamingChannel or operatorTools', () => {
		const logic = src('client/components/settings-modal-logic.js')
		assert.ok(!logic.includes('streamingChannel:'), 'streamingChannel collect must be gone')
		assert.ok(!logic.includes('pointerConfineMultiview: false'), 'hardcoded operatorTools must be gone')
		assert.ok(!logic.includes('mountScreenLabelsSection'), 'dead label mount must be gone')
		const modal = src('client/components/settings-modal.js')
		assert.ok(!modal.includes('set-streaming-ch-clear-creds'), 'clear-creds flow must be gone')
		assert.ok(!modal.includes('screen-label-input'), 'label listener must be gone')
	})
})

describe('WO-270: Devices tab replacements', () => {
	it('destination inspector names a screen with ONE field', () => {
		// WO-385 (owner: "name and label should be one thing"): the second "Screen label" input is
		// gone. The destination's own name is the screen's name everywhere, derived by
		// screenLabelsFromConfig — so this guards the removal and the single remaining field.
		const form = src('client/components/device-view-destinations-inspector-form.js')
		assert.doesNotMatch(form, /screenLabelIn/, 'the separate screen-label input must stay gone')
		assert.doesNotMatch(form, /api\/screens\/label/, 'the inspector no longer posts a second label')
		assert.match(form, /patchDestination\(d\.id, \{ label:/, 'the name field patches the destination')
		assert.match(form, /Name of this screen/, 'and says that it names the screen')

		const sd = src('src/config/screen-destinations.js')
		assert.match(sd, /function screenLabelsFromConfig/, 'the derivation is the single source of truth')
		const routing = src('src/config/routing-map.js')
		assert.match(routing, /screenLabels: screenLabelsFromConfig\(config, screenCount\)/)
	})

	it('server inspector carries the WO-268 CEF GPU checkbox', () => {
		const caspar = src('client/components/device-view-inspector-caspar.js')
		assert.match(caspar, /cefEnableGpu: gpuChk\.checked/)
		assert.match(caspar, /setCasparRestartDirty\(true\)/)
	})

	it('settings-post applies only the operatorTools keys present in the patch', () => {
		const post = src('src/api/settings-post.js')
		assert.match(post, /settings\.operatorTools\.pointerConfineMultiview !== undefined/)
		assert.match(post, /settings\.operatorTools\.cefEnableGpu !== undefined/)
	})
})
