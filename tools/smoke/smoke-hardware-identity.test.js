'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	deriveHardwareIdFromMac,
	hardwareIdToHostname,
	deriveHardwareIdentity,
	isLegacyHighascgHostname,
} = require('../../src/system/hardware-identity')

test('deriveHardwareIdFromMac uses last two octets mod 10000 (variant A)', () => {
	assert.equal(deriveHardwareIdFromMac('52:54:00:12:34:56'), '3398')
	assert.equal(hardwareIdToHostname('3398'), 'highascg3398')
})

test('deriveHardwareIdFromMac rejects invalid MAC', () => {
	assert.equal(deriveHardwareIdFromMac('not-a-mac'), null)
	assert.equal(deriveHardwareIdFromMac('00:00:00:00:00:00'), null)
})

test('deriveHardwareIdentity falls back when no usable MAC', () => {
	const id = deriveHardwareIdentity({ primaryInterface: 'en9999' })
	assert.match(id.hardwareId, /^\d{4}$/)
	assert.equal(id.hostname, hardwareIdToHostname(id.hardwareId))
	assert.ok(id.source)
})

test('isLegacyHighascgHostname detects clone ISO hostnames', () => {
	assert.equal(isLegacyHighascgHostname('highascg-nvidia-595'), true)
	assert.equal(isLegacyHighascgHostname('highascg3398'), false)
})
