'use strict'

/**
 * WO-846: work orders stay organized — canonical headers, a current INDEX.md, deprecated/ holds only DEPRECATED WOs,
 * and no reference points at a missing WO file. The mover rewrites links and path mentions when a WO moves.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { checkAll } = require('../wo/check-wos')
const { parseHeader, canonicalStatusOf } = require('../wo/wo-lib')
const { rewriteText } = require('../wo/wo-move')

describe('WO-846 work-order hygiene', () => {
	it('every WO header, the index and every WO reference are valid', () => {
		const problems = checkAll()
		assert.deepEqual(problems, [], `${problems.length} problems — run node tools/wo/check-wos.js`)
	})

	it('reads both status-line forms and the area line', () => {
		const a = parseHeader('# WO-1 — x\n\n**Area:** audio, media\n**Status: DONE (30.10) — tests**\n')
		assert.equal(a.status, 'DONE')
		assert.deepEqual(a.area, ['audio', 'media'])
		assert.equal(parseHeader('# t\n**Status:** In progress — phase 2\n').status, 'IN PROGRESS')
		assert.equal(canonicalStatusOf('OPENED by'), null)
		assert.equal(canonicalStatusOf('ROOT CAUSE FIXED'), null)
	})

	it('a move rewrites sibling links, path mentions and the moved file’s own links', () => {
		// built by concatenation so check-wos does not read these fixture paths as references to missing WOs
		const W = 'work/work-' + 'orders'
		const moves = new Map([[`${W}/12_WO_a.md`, `${W}/deprecated/12_WO_a.md`]])
		const sibling = rewriteText(
			'see [WO-12](./12_WO_a.md#x) and [b](13_WO_b.md)',
			`${W}/13_WO_b.md`,
			`${W}/13_WO_b.md`,
			moves
		)
		assert.equal(sibling, 'see [WO-12](./deprecated/12_WO_a.md#x) and [b](13_WO_b.md)')
		const code = rewriteText(`// ${W}/12_WO_a.md §2`, 'src/x.js', 'src/x.js', moves)
		assert.equal(code, `// ${W}/deprecated/12_WO_a.md §2`)
		const own = rewriteText(
			'[b](./13_WO_b.md) [top](../OPEN_ISSUES.md)',
			`${W}/12_WO_a.md`,
			`${W}/deprecated/12_WO_a.md`,
			moves
		)
		assert.equal(own, '[b](../13_WO_b.md) [top](../../OPEN_ISSUES.md)')
	})
})
