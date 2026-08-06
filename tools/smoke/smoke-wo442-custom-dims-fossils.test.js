'use strict'

/**
 * WO-442: the GPU inspector showed disabled custom W/H boxes holding 1920/1080 beside a
 * 2160p5000 mode — values the owner never set ("nowhere in my config apart from those
 * boxes"). They were seeded at cable time by gpuScreenInheritedSettingsPatch while the
 * pre-WO-437 feed resolver returned stale stored dims next to the standard mode. The seed
 * source is fixed (WO-437); this pins the UI rules that stop fossils from ever being shown
 * or reintroduced:
 *  - the custom W/H/FPS row exists ONLY when the Caspar mode is Custom;
 *  - switching to Custom prefills from the mode that was just active, not from stale keys.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Strip comments so an explanatory sentence can never satisfy an assertion. */
function code(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('WO-442: custom-input row is shown only in Custom mode (sync + initial assembly)', () => {
	const modeline = code(read('client/components/device-view-inspector-gpu-video-modeline.js'))
	const sync = /const syncCustomInputsState = \(\) => \{([\s\S]*?)\n\t\}/.exec(modeline)
	assert.ok(sync, 'syncCustomInputsState still exists')
	assert.match(sync[1], /row\.style\.display = isCustom \? 'flex' : 'none'/, 'mode changes toggle the row')
	const gpu = code(read('client/components/device-view-inspector-gpu.js'))
	assert.match(
		gpu,
		/display:\$\{modeSel\.value === 'custom' \? 'flex' : 'none'\}/,
		'initial visibility is applied at assembly (sync runs before the row exists)',
	)
})

test('WO-442: switching to Custom prefills from the previously active mode', () => {
	const modeline = code(read('client/components/device-view-inspector-gpu-video-modeline.js'))
	assert.match(
		modeline,
		/videoModeToResolution\(modeSel\.dataset\.prevStandardMode\)/,
		'Custom starts from the real raster that was just active, never from stale screen_N_custom_* keys',
	)
	assert.match(modeline, /if \(!isCustom\) modeSel\.dataset\.prevStandardMode = modeSel\.value/, 'previous standard mode is tracked')
})
