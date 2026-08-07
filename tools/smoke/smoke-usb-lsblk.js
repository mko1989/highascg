'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseLsblkJson, parseRemovableCandidates } = require('../../src/media/usb-drives')

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

test('parseRemovableCandidates finds unmounted USB partition', () => {
	const raw = fs.readFileSync(fixturePath, 'utf8')
	const tree = JSON.parse(raw)
	tree.blockdevices[1].children[0].mountpoint = null
	const candidates = parseRemovableCandidates(JSON.stringify(tree))
	assert.equal(candidates.length, 1)
	assert.equal(candidates[0].blockDevice, '/dev/sdb1')
	assert.equal(candidates[0].label, 'STICK')
})
