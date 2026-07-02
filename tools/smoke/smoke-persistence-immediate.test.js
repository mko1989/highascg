'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const persistence = require('../../src/utils/persistence')

test('persistence exports setImmediate for on-air keys', () => {
	assert.equal(typeof persistence.setImmediate, 'function')
	assert.equal(typeof persistence.flushSync, 'function')
})
