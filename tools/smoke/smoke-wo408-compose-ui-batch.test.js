'use strict'

/**
 * WO-408 smoke — todos03.08 UI batch.
 *
 * The compose-tile cases (blue live-source label bar, CAPTURE button label) read
 * operator-compose-tiles-tile-controller.js and 10b-operator-compose-tiles.css, which were deleted
 * with the Firefox kiosk operator GUI (WO-646); those cases were removed.
 *
 * What remains: the test-pattern resolution label (config-compare.js).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('WO-408: resolution-named video modes are not printed twice on the test pattern', () => {
	const src = read('src/config/config-compare.js')
	assert.match(src, /vmIsResolution = String\(vm \|\| ''\)\.toLowerCase\(\) === `\$\{screenWidth\}x\$\{screenHeight\}`/, 'detects modes named by their resolution')
	assert.match(src, /vm && !vmIsResolution\s*\n?\s*\? `\$\{screenWidth\}×\$\{screenHeight\} · \$\{vm\}`/, 'named modes keep the mode suffix')
	// The duplicated form must be impossible: label building no longer appends vm unconditionally.
	assert.doesNotMatch(src, /`\$\{screenWidth\}×\$\{screenHeight\} · \$\{vm \|\| '—'\}`/, 'old unconditional suffix removed')
})
