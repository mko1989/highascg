'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { isAllowedEthernetIface } = require('../src/config/network-settings')

test('network reset rejects invalid interface names', () => {
	assert.equal(isAllowedEthernetIface('eno1'), true)
	assert.equal(isAllowedEthernetIface('eth0'), true)
	assert.equal(isAllowedEthernetIface('wlan0'), false)
	assert.equal(isAllowedEthernetIface('../../../etc/passwd'), false)
})
