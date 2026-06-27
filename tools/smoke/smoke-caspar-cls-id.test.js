'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	toCasparClsMediaId,
	resolveCasparCinfMediaId,
	stripMediaFileExtension,
} = require('../../src/media/caspar-cls-id')

test('toCasparClsMediaId: lowercase path + extension → uppercase CLS id', () => {
	assert.equal(toCasparClsMediaId('bridge/exfat/MAIN SCREEN.png'), 'BRIDGE/EXFAT/MAIN SCREEN')
	assert.equal(toCasparClsMediaId('bridge/Fidelity Brand Film - PL.mp4'), 'BRIDGE/FIDELITY BRAND FILM - PL')
})

test('toCasparClsMediaId: already CLS id is unchanged', () => {
	assert.equal(toCasparClsMediaId('BRIDGE/EXFAT/MAIN SCREEN'), 'BRIDGE/EXFAT/MAIN SCREEN')
})

test('stripMediaFileExtension: nested wav path', () => {
	assert.equal(
		stripMediaFileExtension('testowe/foo/PK BACK TRACK.wav'),
		'testowe/foo/PK BACK TRACK',
	)
})

test('resolveCasparCinfMediaId: prefers exact CLS catalog row', () => {
	const ctx = {
		CHOICES_MEDIAFILES: [{ id: 'BRIDGE/EXFAT/MAIN SCREEN', label: 'BRIDGE/EXFAT/MAIN SCREEN' }],
	}
	assert.equal(resolveCasparCinfMediaId('bridge/exfat/MAIN SCREEN.png', ctx), 'BRIDGE/EXFAT/MAIN SCREEN')
})

test('resolveCasparCinfMediaId: templates and routes pass through', () => {
	assert.equal(resolveCasparCinfMediaId('route://1', null), 'route://1')
	assert.equal(
		resolveCasparCinfMediaId('CASPARCG-TEMPLATES-MAIN/LOOP', null),
		'CASPARCG-TEMPLATES-MAIN/LOOP',
	)
})
