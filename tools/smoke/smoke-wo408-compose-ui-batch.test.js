'use strict'

/**
 * WO-408 smoke — todos03.08 UI batch (compose tiles + test pattern).
 *
 * 1. Dropped live-source tiles (WO-323 `def.sourceTile`) fell through to the PGM-red
 *    label-row default — they now carry `data-live-source` and a blue rule.
 * 2. Non-PGM tiles said 'PRT' while the PGM tile said 'CAPTURE' for the same
 *    Caspar PRINT snapshot — label/chrome unified on CAPTURE.
 * 3. The test pattern printed the resolution twice ("1728×960 · 1728x960") because
 *    custom video modes are NAMED by their resolution and config-compare.js appended
 *    the mode id unconditionally.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('WO-408: live-source tiles get the blue label bar, not the red default', () => {
	const js = read('client/components/operator-compose-tiles-tile-controller.js')
	assert.match(js, /if \(def\.sourceTile\) el\.dataset\.liveSource = '1'/, 'tile marks itself as a live source')
	const css = read('client/styles/10b-operator-compose-tiles.css')
	assert.match(css, /\.operator-tile\[data-live-source='1'\] \.operator-tile__labelrow \{ background: #2563eb; \}/, 'blue rule outranks the red default')
})

test('WO-408: capture button label unified — no PRT text remains on tiles', () => {
	const js = read('client/components/operator-compose-tiles-tile-controller.js')
	assert.match(js, /prtBtn\.textContent = 'CAPTURE'/, 'non-PGM tiles say CAPTURE')
	assert.match(js, /prtBtn\.className = 'operator-tile__btn operator-tile__btn--capture'/, 'same chrome class as the PGM button')
	assert.doesNotMatch(js, /'PRT'/, 'the PRT label is gone')
})

test('WO-408: resolution-named video modes are not printed twice on the test pattern', () => {
	const src = read('src/config/config-compare.js')
	assert.match(src, /vmIsResolution = String\(vm \|\| ''\)\.toLowerCase\(\) === `\$\{screenWidth\}x\$\{screenHeight\}`/, 'detects modes named by their resolution')
	assert.match(src, /vm && !vmIsResolution\s*\n?\s*\? `\$\{screenWidth\}×\$\{screenHeight\} · \$\{vm\}`/, 'named modes keep the mode suffix')
	// The duplicated form must be impossible: label building no longer appends vm unconditionally.
	assert.doesNotMatch(src, /`\$\{screenWidth\}×\$\{screenHeight\} · \$\{vm \|\| '—'\}`/, 'old unconditional suffix removed')
})
