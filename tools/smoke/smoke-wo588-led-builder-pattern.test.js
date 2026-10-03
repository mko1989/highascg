'use strict'

/**
 * WO-588: "Bunny builds the wall" LED test pattern — build order / entry side helpers, the
 * full-LED-grid gate in the template, script wiring, and the modal option + its grid gate.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const BUILDER = read('template/led_grid_test-builder.js')

function loadBuilder() {
	const sandbox = {}
	vm.runInNewContext(BUILDER, sandbox)
	return sandbox
}

describe('WO-588 builder helpers', () => {
	it('builds bottom row first, left to right, every cell once', () => {
		const { ledBuilderOrder } = loadBuilder()
		const order = ledBuilderOrder(3, 2)
		assert.deepEqual(
			Array.from(order, (x) => `${x.r},${x.c}`),
			['1,0', '1,1', '1,2', '0,0', '0,1', '0,2'],
		)
		assert.equal(new Set(ledBuilderOrder(20, 10).map((x) => `${x.r},${x.c}`)).size, 200)
	})

	it('enters from the nearer edge; the middle column alternates by row', () => {
		const { ledBuilderSide } = loadBuilder()
		assert.equal(ledBuilderSide(0, 0, 4), -1)
		assert.equal(ledBuilderSide(1, 0, 4), -1)
		assert.equal(ledBuilderSide(2, 0, 4), 1)
		assert.equal(ledBuilderSide(3, 0, 4), 1)
		assert.equal(ledBuilderSide(1, 0, 3), -1)
		assert.equal(ledBuilderSide(1, 1, 3), 1)
		assert.equal(ledBuilderSide(0, 0, 1), -1)
		assert.equal(ledBuilderSide(0, 1, 1), 1)
	})

	it('cycles red → green → blue → white', () => {
		assert.match(BUILDER, /var BUILDER_COLORS = \['#ff0000', '#00ff00', '#0000ff', '#ffffff'\]/)
	})
})

describe('WO-588 template wiring', () => {
	it('loads the builder between the core and render scripts', () => {
		assert.match(
			read('template/led_grid_test.html'),
			/<script src="led_grid_test\.js"><\/script>\s*<script src="led_grid_test-builder\.js"><\/script>\s*<script src="led_grid_test-render\.js"><\/script>/,
		)
	})

	it('runs only with the full LED grid on, and stops on every pattern reset', () => {
		const render = read('template/led_grid_test-render.js')
		assert.match(render, /var builderOn = pat === 'led-builder' && data\.showLedGrid === true/)
		assert.match(render, /\} else if \(pat === 'led-builder' && builderOn\) \{\s*renderBunnyBuilder\(layer, data\)/)
		assert.match(render, /function resetPatternLayer\(layer\) \{[\s\S]*?stopBunnyBuilder\(\)/)
	})
})

describe('WO-588 modal', () => {
	const modal = read('client/components/led-test-modal.js')

	it('offers the pattern', () => {
		assert.match(modal, /<option value="led-builder">Animated: Bunny builds the wall<\/option>/)
	})

	it('disables it unless some channel has Full LED grid, and falls back to grid-white', () => {
		assert.match(modal, /builderOpt\.disabled = !anyGrid/)
		assert.match(modal, /if \(!anyGrid && patternSel\.value === 'led-builder'\) \{\s*patternSel\.value = 'grid-white'/)
		assert.match(modal, /syncBuilderAvailability\(\)\s*persistAndApply\(\)/)
	})
})
