'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	parseCompanionLocationInput,
	formatCompanionLocation,
	parseCompanionCoordField,
} = require('../../client/lib/companion-location-parse.js')

describe('companion-location-parse', () => {
	it('parses space-separated location', () => {
		assert.deepEqual(parseCompanionLocationInput('1 2 1'), { page: 1, row: 2, column: 1 })
	})

	it('parses slash and dash separators', () => {
		assert.deepEqual(parseCompanionLocationInput('12/0/15'), { page: 12, row: 0, column: 15 })
		assert.deepEqual(parseCompanionLocationInput('3-1-7'), { page: 3, row: 1, column: 7 })
	})

	it('rejects invalid input', () => {
		assert.equal(parseCompanionLocationInput('1 2'), null)
		assert.equal(parseCompanionLocationInput('0 0 0'), null)
		assert.equal(parseCompanionLocationInput(''), null)
	})

	it('formatCompanionLocation round-trips', () => {
		assert.equal(formatCompanionLocation(1, 0, 2), '1 0 2')
	})

	it('parseCompanionCoordField allows multi-digit and negative row', () => {
		assert.equal(parseCompanionCoordField('12', { min: 1 }), 12)
		assert.equal(parseCompanionCoordField('-1', { allowNegative: true }), -1)
	})
})
