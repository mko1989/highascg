'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ConfigManager } = require('../../src/config/config-manager')

test('ConfigManager rejects non-string configPath', () => {
	assert.throws(
		() => new ConfigManager({ path: '/tmp/x.json' }),
		/ConfigManager configPath must be a non-empty string/,
	)
})

test('ConfigManager accepts string configPath', () => {
	const cm = new ConfigManager('/tmp/does-not-exist-highascg-test.json', {
		info() {},
		warn() {},
		error() {},
	})
	assert.equal(typeof cm.configPath, 'string')
})
