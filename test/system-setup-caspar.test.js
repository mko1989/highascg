'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	parseCasparControlOutput,
	detectCalamaresStatus,
} = require('../src/api/routes-system-setup')

test('parseCasparControlOutput reads key=value lines', () => {
	const parsed = parseCasparControlOutput('scanner=active\nserver=inactive\ninhibited=1\n')
	assert.equal(parsed.scanner, 'active')
	assert.equal(parsed.server, 'inactive')
	assert.equal(parsed.inhibited, '1')
})

test('detectCalamaresStatus returns structured object', () => {
	const st = detectCalamaresStatus()
	assert.equal(typeof st.installed, 'boolean')
	assert.equal(typeof st.eggsAvailable, 'boolean')
	assert.equal(typeof st.launchable, 'boolean')
})
