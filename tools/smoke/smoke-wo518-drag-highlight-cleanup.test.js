'use strict'

/**
 * WO-518 — a drag-hover highlight must not outlive the gesture.
 *
 * Owner 13.08: *"going between looks and timelines screwes up the compose preview. also there is a
 * weird dotted blue line around the compose preview, why???"*
 *
 * That line is `outline: dashed var(--accent)` (#58a6ff) from `scenes-layer--drag-over`, added on
 * `dragover` in `scenes-compose.js` and removed only on `dragleave`. `dragleave` is not a reliable
 * counterpart: it does not fire on an Esc-cancelled drag, when the pointer leaves the window, or
 * when the drop lands elsewhere — and a mid-drag re-render leaves the class with no listener to
 * clear it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const SRC = read('client/lib/drag-highlight-cleanup.js')

test('WO-518: the sweeper listens on the events that mean the gesture ended', () => {
	// dragend fires on the SOURCE, drop on the TARGET — between them every completed or abandoned
	// drag is covered. Esc emits neither in some browsers, so the key is the remaining signal.
	assert.match(SRC, /addEventListener\('dragend'/, 'dragend covers an abandoned drag')
	assert.match(SRC, /addEventListener\('drop'/, 'drop covers a completed one')
	assert.match(SRC, /Escape/, 'Esc-cancelled drags emit neither in some browsers')
})

test('WO-518: it uses capture, so a component stopPropagation cannot swallow it', () => {
	assert.match(SRC, /capture: true/, 'scenes-compose calls stopPropagation in its own drop handler')
})

test('WO-518: installation is idempotent', () => {
	assert.match(SRC, /if \(installed/, 'every component that paints a highlight may call it')
})

test('WO-518: the class list covers the compose canvas class that leaked', () => {
	assert.match(SRC, /'scenes-layer--drag-over'/, 'the class behind the reported blue outline')
	const css = read('client/styles/07a-scenes-compose-canvas.css')
	assert.match(css, /\.scenes-layer--drag-over\s*\{[^}]*dashed/, 'and it really is the dashed rule')
})

test('WO-518: the compose canvas installs it', () => {
	const src = read('client/components/scenes-compose.js')
	assert.match(src, /installDragHighlightCleanup\(\)/, 'wired, not just written')
	assert.match(src, /import \{ installDragHighlightCleanup \}/)
})

test('WO-518: the per-element dragleave handler is KEPT', () => {
	// The sweeper is a backstop for abandoned gestures, not a replacement — dragleave still gives
	// immediate feedback when the pointer simply moves off a layer mid-drag.
	const src = read('client/components/scenes-compose.js')
	assert.match(src, /addEventListener\('dragleave'/, 'immediate feedback must survive')
})
