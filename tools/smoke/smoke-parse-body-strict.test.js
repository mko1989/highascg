'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseBodyStrict } = require('../../src/api/response')

test('parseBodyStrict parses valid JSON', () => {
	const r = parseBodyStrict('{"a":1}')
	assert.equal(r.ok, true)
	assert.deepEqual(r.value, { a: 1 })
})

test('parseBodyStrict rejects invalid JSON', () => {
	const r = parseBodyStrict('{not json')
	assert.equal(r.ok, false)
	assert.match(String(r.error), /JSON|Unexpected/i)
})
