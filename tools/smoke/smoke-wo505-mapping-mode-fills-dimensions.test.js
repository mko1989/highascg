'use strict'

/**
 * WO-505 — picking a standard resolution in a pixel-mapping output must fill W/H.
 *
 * Owner 13.08 (`todos13.08.26`): *"in pixel mapping node, when in an output a resolution is chosen
 * from a drop down, it should fill width and height with that resolutions w/h."*
 *
 * `vMode.onchange` computed the standard mode's dimensions for the SAVE (WO-437 made sure the stale
 * custom inputs were no longer persisted alongside a standard mode) but never wrote them back into
 * the visible inputs — so the panel showed one resolution while storing another, and switching to
 * Custom started from the previous mode's numbers.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const SRC = path.join(REPO, 'client/components/device-view-inspector-mapping.js')
const src = fs.readFileSync(SRC, 'utf8')
/** Strip comments so the prose explaining the old behaviour cannot satisfy an assertion. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

test('WO-505: a sync helper writes the mode dimensions into the inputs', () => {
	assert.match(code, /const syncModeFields = \(\) => \{/, 'the helper must exist')
	const body = /const syncModeFields = \(\) => \{([\s\S]*?)\n\t\t\}/.exec(code)
	assert.ok(body, 'helper body must be parseable')
	assert.match(body[1], /videoModeToResolution\(vMode\.value\)/, 'it must resolve the selected mode')
	assert.match(body[1], /cW\.value\s*=/, 'width must be filled')
	assert.match(body[1], /cH\.value\s*=/, 'height must be filled')
	assert.match(body[1], /cF\.value\s*=/, 'fps must be filled')
})

test('WO-505: the helper runs on change AND on first render', () => {
	assert.match(code, /vMode\.onchange = \(\) => \{\s*syncModeFields\(\)/, 'must run when the mode changes')
	assert.match(code, /\n\t\tsyncModeFields\(\)\n\t\tvMode\.onchange/, 'must also run once at mount, so the panel opens consistent')
})

test('WO-505: the fields stay visible and become read-only for a standard mode', () => {
	const body = /const syncModeFields = \(\) => \{([\s\S]*?)\n\t\t\}/.exec(code)[1]
	assert.match(body, /customBox\.style\.display = 'grid'/, 'a filled field the operator cannot see is not "filled"')
	assert.match(body, /disabled = !isCustom/, 'standard-mode dimensions are derived, so they must not be editable')
	assert.doesNotMatch(
		code,
		/customBox\.style\.display = isCustomMode \? 'grid' : 'none'/,
		'the old hide-on-standard branch must be gone',
	)
})

test('WO-505: WO-437 is preserved — a standard mode still saves derived dimensions', () => {
	const save = /const saveCustom = async \(\) => \{([\s\S]*?)\n\t\t\}/.exec(code)
	assert.ok(save, 'saveCustom must still exist')
	assert.match(save[1], /const width = isCustom \? [^:]+: std\.w/, 'standard mode must save std.w, never the input')
	assert.match(save[1], /const height = isCustom \? [^:]+: std\.h/, 'standard mode must save std.h, never the input')
})
