'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseLsblkJson } = require('../src/media/usb-drives')

const fixturePath = path.join(__dirname, 'fixtures', 'lsblk-ubuntu-usb.json')

test('parseLsblkJson finds USB stick under /media', () => {
	const raw = fs.readFileSync(fixturePath, 'utf8')
	const drives = parseLsblkJson(raw)
	assert.equal(drives.length, 1)
	assert.equal(drives[0].label, 'STICK')
	assert.equal(drives[0].mountpoint, path.resolve('/media/operator/STICK'))
	assert.equal(drives[0].fsType, 'vfat')
	assert.ok(drives[0].device === '/dev/sdb1' || drives[0].device.endsWith('sdb1'))
})
