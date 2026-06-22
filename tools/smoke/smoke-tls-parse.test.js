'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { parseTlsLines } = require('../../src/utils/handlers')

describe('parseTlsLines', () => {
	it('parses plain TLS rows and strips CR', () => {
		const rows = parseTlsLines(['BLACK\r', 'COLOR_BG', 'CASPARCG-TEMPLATES-MAIN/LOOP-IO/ONE-LINER\r'])
		assert.equal(rows.length, 3)
		assert.equal(rows[0].id, 'BLACK')
		assert.equal(rows[2].id, 'CASPARCG-TEMPLATES-MAIN/LOOP-IO/ONE-LINER')
	})
})
