'use strict'

/**
 * Reported live: the GPU port inspector's "Native mode" summary row correctly read the operator
 * monitor's EDID-preferred timing ("3840x2160@50Hz"), but that exact resolution could not be
 * selected anywhere — the OS-resolution dropdown only ever lists modes xrandr already has as CRTC
 * modes (confirmed live: xrandr --query for that port listed only 1920x1080 family + 1280x1024,
 * nothing at 4K, despite the monitor's own EDID naming 3840x2160@50 as preferred), and "Custom OS
 * resolution" defaulted to a hardcoded 1920x1080@50 with no awareness of the EDID value at all.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

async function loadModule() {
	return import('file://' + path.join(__dirname, '..', '..', 'client', 'lib', 'edid-preferred-mode.js'))
}

test('parseEdidPreferredMode reads the exact edid-parse.js format', async () => {
	const { parseEdidPreferredMode } = await loadModule()
	assert.deepEqual(parseEdidPreferredMode('3840x2160@50Hz'), { w: 3840, h: 2160, r: 50 })
	assert.deepEqual(parseEdidPreferredMode('1920x1080@59.94Hz'), { w: 1920, h: 1080, r: 59.94 })
	assert.equal(parseEdidPreferredMode(''), null)
	assert.equal(parseEdidPreferredMode(null), null)
	assert.equal(parseEdidPreferredMode('garbage'), null)
	assert.equal(parseEdidPreferredMode('0x0@50Hz'), null, 'zero dimensions must not parse as valid')
})

test('edidPreferredModeIsSelectable: true only when the EDID mode is already a detected CRTC mode', async () => {
	const { parseEdidPreferredMode, edidPreferredModeIsSelectable } = await loadModule()
	const preferred4k = parseEdidPreferredMode('3840x2160@50Hz')

	// The owner's exact live case: detected modes are 1080p-family only, no 4K entry anywhere.
	const detected1080pOnly = [
		{ mode: '1920x1080', rate: '60' },
		{ mode: '1920x1080', rate: '50' },
		{ mode: '1280x1024', rate: '60.02' },
	]
	assert.equal(
		edidPreferredModeIsSelectable(preferred4k, detected1080pOnly),
		false,
		'the native 4K mode is not selectable when xrandr only knows 1080p-family modes',
	)

	// If the driver DOES already have the native mode as a CRTC mode, nothing extra is needed.
	const detectedWith4k = [...detected1080pOnly, { mode: '3840x2160', rate: '50' }]
	assert.equal(edidPreferredModeIsSelectable(preferred4k, detectedWith4k), true)

	// No EDID preference at all → trivially "selectable" (nothing to force Custom for).
	assert.equal(edidPreferredModeIsSelectable(null, detected1080pOnly), true)
})

test('the GPU inspector wires the EDID-native fallback into BOTH the default selection and the Custom prefill', () => {
	const fs = require('fs')
	const src = fs
		.readFileSync(path.join(__dirname, '..', '..', 'client', 'components', 'device-view-inspector-gpu-video-modeline.js'), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')

	assert.match(src, /import\s*\{\s*parseEdidPreferredMode,\s*edidPreferredModeIsSelectable\s*\}\s*from\s*'\.\.\/lib\/edid-preferred-mode\.js'/)
	assert.match(
		src,
		/preferCustomOs\s*=[\s\S]*?!savedOsMode\s*&&\s*!edidPreferredIsSelectable/,
		'the dropdown must default to Custom when nothing is saved and the native mode is not selectable',
	)
	assert.match(
		src,
		/return\s+edidPreferred\s*\|\|\s*\{\s*w:\s*1920,\s*h:\s*1080,\s*r:\s*50\s*\}/,
		'the Custom-fields fallback must prefer the EDID-native mode over the hardcoded 1080p50 default',
	)
})
