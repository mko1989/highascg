'use strict'

/**
 * WO-837 (b): the web client knows the `light` flag type that the Godot client authors. Before, `isValidFlagType`
 * rejected it, so ANY web edit of a light flag (`updateFlag`, even a label change) turned it into a 'pause' flag, and
 * the canvas drew it as a red pause triangle.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** FLAG_TYPES, isValidFlagType and lightFlagSummary from the real model, without its imports. */
function loadModel() {
	const src = read('client/lib/timeline-state-model.js')
	const pick = (re) => re.exec(src)?.[0] || assert.fail(`not found: ${re}`)
	const body = [
		pick(/export const FLAG_TYPES = \[[^\]]*\]/),
		pick(/export function isValidFlagType\(type\) \{[\s\S]*?\n\}/),
		pick(/export function lightFlagSummary\(f\) \{[\s\S]*?\n\}/),
	]
		.join('\n')
		.replace(/export /g, '')
	return new Function(`${body}; return { FLAG_TYPES, isValidFlagType, lightFlagSummary }`)()
}

describe('WO-837 web light flags', () => {
	const m = loadModel()

	it('light is a valid flag type, so updateFlag keeps it', () => {
		assert.ok(m.isValidFlagType('light'))
		assert.ok(m.FLAG_TYPES.includes('light'))
		assert.match(read('client/lib/timeline-state.js'), /if \(f\.type && !isValidFlagType\(f\.type\)\) f\.type = 'pause'/)
	})

	it('summaries match the Godot chip text', () => {
		assert.equal(m.lightFlagSummary({ action: 'go', list: 1, cue: 3 }), 'Go 1 / cue 3')
		assert.equal(m.lightFlagSummary({ list: 2 }), 'Go 2')
		assert.equal(m.lightFlagSummary({ action: 'fader', fader: 4, level: 80 }), 'Fader 4 to 80%')
		assert.equal(m.lightFlagSummary({ action: 'release', list: 2 }), 'Release 2')
		assert.equal(m.lightFlagSummary({ action: 'command', command: 'Go+ Sequence 1' }), 'Cmd: Go+ Sequence 1')
	})

	it('the canvas colours light flags teal and the inspector offers the type', () => {
		assert.match(read('client/components/timeline-canvas-render.js'), /if \(t === 'light'\) return '#2dd4bf'/)
		assert.match(read('client/components/inspector-panel-timeline-flag.js'), /<option value="light">Lighting console cue<\/option>/)
	})
})
