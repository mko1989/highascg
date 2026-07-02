'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

test('applyX11Layout source has no undefined xcmd / xrandrParts regressions', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/utils/os-config.js'), 'utf8')
	assert.doesNotMatch(src, /\bxcmd\b/)
	assert.doesNotMatch(src, /\bxrandrParts\b/)
	assert.match(src, /!live && xrandrCommand/)
	assert.match(src, /xrandrHeads\.length === 0/)
})
