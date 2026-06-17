'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	parseCasparLogHardware,
	probeDecklinkFromCasparLog,
	probeDecklinkFromOs,
	probeDecklinkDriverHealth,
} = require('../../src/utils/decklink-enum')

const sampleLog = `
[info]    Decklink devices found:
[info]     - DeckLink 8K Pro [1] (35844960)
[info]     - DeckLink 8K Pro [2] (35844961)
[info]    Initialized decklink module.
[info]    Screen consumer [4|1080p5000] Initialized.
`

const screensOnlyLog = `
[info]    Initialized decklink module.
[info]    Screen consumer [4|1080p5000] Initialized.
`

test('parseCasparLogHardware extracts decklinks and screens', () => {
	const r = parseCasparLogHardware(sampleLog)
	assert.equal(r.decklinks.length, 2)
	assert.equal(r.decklinks[0].index, 1)
	assert.equal(r.decklinks[0].externalRef, '35844960')
	assert.equal(r.screens[0].index, 4)
})

test('probeDecklinkFromOs finds PCI model and io nodes on this host', () => {
	const r = probeDecklinkFromOs()
	assert.ok(Array.isArray(r.connectors))
	if (r.connectors.length > 0) {
		assert.match(r.connectors[0].label, /DeckLink/i)
		assert.equal(r.source, 'os_probe')
	}
})

test('probeDecklinkDriverHealth reports firmware mismatch when present in kernel log', () => {
	const h = probeDecklinkDriverHealth()
	if (h.firmwareMismatch) {
		assert.ok(h.warning)
		assert.ok(h.detail)
	}
})
