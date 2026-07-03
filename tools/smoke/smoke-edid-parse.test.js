'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { parseEdidHex } = require('../../src/utils/edid-parse')

const FIXTURE = path.join(__dirname, 'fixtures/edid-acer-k222hql.hex')

describe('edid-parse', () => {
	it('parses monitor name, PNP id, serial, and preferred mode from captured EDID', () => {
		const raw = fs.readFileSync(FIXTURE, 'utf8').trim()
		const parsed = parseEdidHex(raw)
		assert.ok(parsed)
		assert.equal(parsed.pnpId, 'ACR')
		assert.equal(parsed.monitorName, 'k222HQL')
		assert.equal(parsed.serial, 'T5XEE0132455')
		assert.ok(parsed.preferredMode)
		assert.match(parsed.preferredMode, /^\d+x\d+@\d+(\.\d+)?Hz$/)
	})

	it('returns null for invalid blobs', () => {
		assert.equal(parseEdidHex(''), null)
		assert.equal(parseEdidHex('00ff'), null)
		assert.equal(parseEdidHex('ff'.repeat(64)), null)
	})
})
