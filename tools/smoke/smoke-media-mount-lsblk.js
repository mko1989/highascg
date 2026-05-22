'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseLsblkJsonForPartitionPicker } = require('../../src/system/block-devices')

const fixturePath = path.join(__dirname, 'fixtures', 'lsblk-w38-partitions.json')

test('WO-38 parseLsblkJsonForPartitionPicker: mocked lsblk JSON → partition rows', () => {
	const raw = fs.readFileSync(fixturePath, 'utf8')
	const parsed = JSON.parse(raw)
	const rows = parseLsblkJsonForPartitionPicker(parsed)
	const uuids = new Set(rows.map(r => r.uuid))
	assert.equal(rows.length, 4, 'internal + USB + crypt + legacy-uppercase row')
	assert.ok(uuids.has('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))
	assert.ok(uuids.has('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))
	assert.ok(uuids.has('cccccccc-cccc-cccc-cccc-cccccccccccc'))
	assert.ok(uuids.has('dddddddd-dddd-dddd-dddd-dddddddddddd'))
	const usb = rows.find(r => r.uuid === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
	assert.ok(usb)
	assert.equal(usb.removable, true)
	assert.equal(usb.mountpoint, '/media/live/STICK')
	const internal = rows.find(r => r.uuid === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
	assert.ok(internal)
	assert.equal(internal.removable, false)
	assert.equal(internal.label, 'INTERNAL_LIB')
})
