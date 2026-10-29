'use strict'

/**
 * WO-827 — web client: a fresh browser showed "No looks for <main>" while the server project held 22 looks.
 * sceneState imported them (boot / reconnect / project_sync emit 'imported'), but the deck view only re-rendered
 * on 'change' / 'softChange' / …, so the empty first paint stayed. Pins the subscription plus the two
 * ReferenceError fixes found with the same sweep (client no-undef is now an error in eslint.config.js).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

test('scenes editor repaints the deck on a server import', () => {
	const src = read('client/components/scenes-' + 'editor.js')
	assert.match(src, /sceneState\.on\('imported', \(\) => \{ previewPanel\.scheduleDraw\(\); scheduleRender\(\) \}\)/)
})

test('timeline compose stack has no look-layer contentZoom copy (undefined layer/px threw every frame)', () => {
	const src = read('client/components/preview-canvas-draw-' + 'stacks.js')
	const tl = src.slice(src.indexOf('No timeline'))
	assert.ok(tl.length > 0)
	assert.doesNotMatch(tl, /layer\.contentZoom/)
})

test('client no-undef is an error', () => {
	assert.match(read('eslint.config.js'), /'no-undef': 'error', \/\/ WO-827/)
})
