'use strict'

/**
 * WO-287: No modal backdrop blur
 * WO-289: Looks editor checkerboard canvas
 * Offline CSS stylesheet regression tests.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '../..')

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

describe('WO-287: No modal backdrop blur', () => {
	// WO-287 requires removing all backdrop-filter: blur() from modal overlays

	it('modal-overlay (07b1-modal-shell-base.css) has no backdrop-filter blur', () => {
		const css = src('client/styles/07b1-modal-shell-base.css')
		// Check that .modal-overlay block exists but does NOT have backdrop-filter: blur
		assert.match(css, /\.modal-overlay \{[^}]*?\}/, 'modal-overlay selector must exist')
		// Verify no blur in modal-overlay
		const modalOverlay = css.match(/\.modal-overlay \{[^}]*?\}/s)?.[0] || ''
		assert.doesNotMatch(modalOverlay, /backdrop-filter:\s*blur/,
			'modal-overlay must not have backdrop-filter: blur')
	})

	it('ingest drag overlay (03b-ingest-drag-upload-progress.css) has no backdrop-filter blur', () => {
		const css = src('client/styles/03b-ingest-drag-upload-progress.css')
		// Verify no blur in sources-drag-overlay
		const dragOverlay = css.match(/\.sources-drag-overlay \{[^}]*?\}/s)?.[0] || ''
		assert.doesNotMatch(dragOverlay, /backdrop-filter:\s*blur/,
			'sources-drag-overlay must not have backdrop-filter: blur')
	})

	it('logs modal override (08a-modals-logs.css) keeps backdrop-filter: none', () => {
		const css = src('client/styles/08a-modals-logs.css')
		assert.match(css, /#logs-modal\.modal-overlay \{[^}]*?backdrop-filter:\s*none/s,
			'logs-modal must override with backdrop-filter: none')
	})

	it('settings modal override (08b-modals-settings.css) keeps backdrop-filter: none', () => {
		const css = src('client/styles/08b-modals-settings.css')
		assert.match(css, /#settings-modal\.modal-overlay \{[^}]*?backdrop-filter:\s*none/s,
			'settings-modal must override with backdrop-filter: none')
	})

	it('no backdrop-filter blur exists anywhere in modal/overlay stylesheets', () => {
		const modalFiles = [
			'client/styles/07b1-modal-shell-base.css',
			'client/styles/08a-modals-logs.css',
			'client/styles/08b-modals-settings.css',
			'client/styles/08c-modals-misc.css',
			'client/styles/08c2-modals-header-audio-usb-import.css',
			'client/styles/08c3-modals-hardware-reconcile-banners.css',
			'client/styles/03b-ingest-drag-upload-progress.css',
		]

		for (const file of modalFiles) {
			const fullPath = path.join(REPO, file)
			if (!fs.existsSync(fullPath)) {
				continue // Skip if file doesn't exist
			}
			const css = fs.readFileSync(fullPath, 'utf8')
			// Count occurrences of backdrop-filter with blur values
			const blurMatches = css.match(/backdrop-filter:\s*blur\s*\(/g) || []
			assert.equal(blurMatches.length, 0,
				`${file} must not contain any backdrop-filter: blur() - found ${blurMatches.length}`)
		}
	})
})

describe('WO-289: Looks editor checkerboard canvas', () => {
	// WO-289 requires adding a checkerboard pattern to .scenes-compose

	it('scenes-compose canvas has checkerboard background', () => {
		const css = src('client/styles/07a-scenes-compose-canvas.css')
		// Verify that .scenes-compose has a background with linear-gradient (checkerboard pattern)
		assert.match(css, /\.scenes-compose \{[\s\S]*?linear-gradient[\s\S]*?\}/,
			'.scenes-compose must have linear-gradient for checkerboard')
		assert.match(css, /\.scenes-compose \{[\s\S]*?45deg[\s\S]*?\}/,
			'.scenes-compose gradient must use 45deg for checkerboard pattern')
		assert.match(css, /\.scenes-compose \{[\s\S]*?background-size:[\s\S]*?\}/,
			'.scenes-compose must have background-size defined')
		assert.match(css, /\.scenes-compose \{[\s\S]*?background-position:[\s\S]*?\}/,
			'.scenes-compose must have background-position defined')
	})

	it('scenes-compose background pattern is low-opacity', () => {
		const css = src('client/styles/07a-scenes-compose-canvas.css')
		// Verify opacity is low (rgba with alpha < 0.1)
		assert.match(css, /\.scenes-compose \{[\s\S]*?rgba\(255,\s*255,\s*255,\s*0\.0[0-9]\)[\s\S]*?\}/,
			'.scenes-compose checkerboard pattern must have low opacity (< 0.1)')
	})

	it('scenes-compose retains dark background base color', () => {
		const css = src('client/styles/07a-scenes-compose-canvas.css')
		assert.match(css, /\.scenes-compose \{[\s\S]*?#0d1117[\s\S]*?\}/,
			'.scenes-compose must retain the dark base background color #0d1117')
	})

	it('operator-compose-tiles remain fully transparent', () => {
		const css = src('client/styles/10b-operator-compose-tiles.css')
		const operatorTiles = css.match(/\.operator-tile \{[^}]*?\}/s)?.[0] || ''
		assert.match(operatorTiles, /background:\s*transparent/,
			'.operator-tile must have fully transparent background (not checkerboard)')
	})

	it('operator-compose-tiles mount has dark background (not checkerboard)', () => {
		const css = src('client/styles/10b-operator-compose-tiles.css')
		// The preview-panel mount should have a solid dark background
		const mount = css.match(/\.preview-panel__operator-tiles-mount \{[^}]*?\}/s)?.[0] || ''
		// It should NOT have linear-gradient checkerboard
		assert.doesNotMatch(mount, /linear-gradient/,
			'operator-tiles mount must not have checkerboard pattern')
	})
})

describe('WO-287b: modal overlays carry no scrim tint at all', () => {
	it('.modal-overlay has no rgba tint — the UI behind a dialog stays fully readable', () => {
		const css = fs.readFileSync(
			path.join(__dirname, '..', '..', 'client', 'styles', '07b1-modal-shell-base.css'),
			'utf8',
		)
		const block = css.slice(css.indexOf('.modal-overlay'), css.indexOf('.modal-overlay') + 600)
		assert.doesNotMatch(
			block,
			/background:\s*rgba\(/,
			'.modal-overlay must not paint a translucent scrim (owner: "should be nothing, 100% alpha bg")',
		)
		assert.match(block, /background:\s*none/, '.modal-overlay should declare background: none')
	})
})
