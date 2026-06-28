'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	toCasparClsMediaId,
	resolveCasparCinfMediaId,
	resolveClipForAmcpLoad,
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

test('resolveClipForAmcpLoad: project basename expands to CLS id', () => {
	const ctx = {
		config: { projectScopedMedia: { enabled: true } },
		persistence: { get: (k) => (k === 'web_project_active_slug' ? 'untitled777' : null) },
	}
	assert.equal(resolveClipForAmcpLoad('252166.mp4', ctx), 'PROJECTS/UNTITLED777/252166')
})

test('resolveClipForAmcpLoad: basename at media root stays root CLS id', () => {
	const ctx = {
		config: {
			projectScopedMedia: { enabled: true },
			local_media_path: require('path').join(__dirname, '../../media'),
		},
		persistence: { get: (k) => (k === 'web_project_active_slug' ? 'untitled777' : null) },
	}
	assert.equal(resolveClipForAmcpLoad('3825579625-preview.mp4', ctx), '3825579625-PREVIEW')
})

test('resolveClipForAmcpLoad: prefers CLS catalog row over expansion', () => {
	const ctx = {
		CHOICES_MEDIAFILES: [{ id: 'PROJECTS/EVENING/CLIP', label: 'PROJECTS/EVENING/CLIP' }],
		config: { projectScopedMedia: { enabled: true } },
		persistence: { get: () => 'untitled777' },
	}
	assert.equal(resolveClipForAmcpLoad('clip.mov', ctx), 'PROJECTS/EVENING/CLIP')
})
