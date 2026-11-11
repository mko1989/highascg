'use strict'

/**
 * WO-1037 smoke — a clear of a layer followed by a CG ADD on it in the same BEGIN…COMMIT batch loses the add on
 * Caspar (the PIP border of a PGM-only screen never showed). The batch leaves such a clear out.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { dropClearsBeforeCgAdd } = require('../../src/caspar/amcp-batch-cg-clear')

describe('WO-1037 batch: clear before CG ADD', () => {
	it('the take\'s border sequence keeps everything but the CG CLEAR', () => {
		const lines = [
			'LOADBG 4-11 #00000000 MIX 25 linear',
			'MIXER 4-11 FILL 0.04 0.11 0.45 0.76 25 linear',
			'CG 4-264 CLEAR',
			'MIXER 4-264 CLEAR',
			'CG 4-264 ADD 0 "pip_border" 1 "{}"',
			'CG 4-264 PLAY 0',
			'MIXER 4-264 FILL 0.03 0.08 0.47 0.82 0',
		]
		assert.deepEqual(dropClearsBeforeCgAdd(lines), lines.filter((l) => l !== 'CG 4-264 CLEAR'))
	})

	it('a whole-layer CLEAR before the add goes too; clears of other layers, or after the add, stay', () => {
		const lines = ['CLEAR 4-264', 'CG 4-268 CLEAR', 'cg 4-264 add 0 "pip_border" 1 "{}"', 'CG 4-264 CLEAR', 'CLEAR 4', 'CG 2-264 CLEAR']
		assert.deepEqual(dropClearsBeforeCgAdd(lines), ['CG 4-268 CLEAR', 'cg 4-264 add 0 "pip_border" 1 "{}"', 'CG 4-264 CLEAR', 'CLEAR 4', 'CG 2-264 CLEAR'])
	})

	it('no CG ADD in the batch: the very same array back', () => {
		const lines = ['CG 4-264 CLEAR', 'MIXER 4-264 CLEAR']
		assert.equal(dropClearsBeforeCgAdd(lines), lines)
	})

	it('the batch runner applies it before the payload is built', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/caspar/amcp-batch.js'), 'utf8')
		const at = src.indexOf("require('./amcp-batch-cg-clear').dropClearsBeforeCgAdd(lines)")
		assert.ok(at > 0 && at < src.indexOf("const payload = ['BEGIN'"))
	})
})
