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

test('stripMediaFileExtension: QuickTime .qt container', () => {
	assert.equal(stripMediaFileExtension('clips/intro.qt'), 'clips/intro')
	assert.equal(toCasparClsMediaId('clips/intro.qt'), 'CLIPS/INTRO')
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

test('resolveClipForAmcpLoad: basename at media root stays root CLS id when not in project folder', () => {
	const ctx = {
		config: {
			projectScopedMedia: { enabled: true },
			local_media_path: require('path').join(__dirname, '../../media'),
		},
		persistence: { get: (k) => (k === 'web_project_active_slug' ? 'no_such_project_folder' : null) },
	}
	assert.equal(resolveClipForAmcpLoad('3825579625-preview.mp4', ctx), '3825579625-PREVIEW')
})

test('resolveClipForAmcpLoad: prefers CLS catalog row when clip is not in active project folder', () => {
	const ctx = {
		CHOICES_MEDIAFILES: [{ id: 'PROJECTS/EVENING/CLIP', label: 'PROJECTS/EVENING/CLIP' }],
		config: { projectScopedMedia: { enabled: true } },
		persistence: { get: () => 'untitled777' },
	}
	assert.equal(resolveClipForAmcpLoad('clip.mov', ctx), 'PROJECTS/EVENING/CLIP')
})

test('resolveClipForAmcpLoad: active project folder wins over CLS basename match elsewhere', () => {
	const ctx = {
		CHOICES_MEDIAFILES: [{ id: 'BRIDGE/FIDELITY BRAND FILM - PL', label: 'BRIDGE/FIDELITY BRAND FILM - PL' }],
		config: {
			projectScopedMedia: { enabled: true },
			local_media_path: require('path').join(__dirname, '../../media'),
		},
		persistence: { get: (k) => (k === 'web_project_active_slug' ? 'tetst' : null) },
	}
	assert.equal(
		resolveClipForAmcpLoad('Fidelity Brand Film - PL.mp4', ctx),
		'PROJECTS/TETST/FIDELITY BRAND FILM - PL',
	)
})

test('resolveClipForAmcpLoad: project basename without extension expands to CLS id', () => {
	const ctx = {
		config: {
			projectScopedMedia: { enabled: true },
			local_media_path: require('path').join(__dirname, '../../media'),
		},
		persistence: { get: (k) => (k === 'web_project_active_slug' ? 'tetst' : null) },
	}
	assert.equal(resolveClipForAmcpLoad('02_BUMPER', ctx), 'PROJECTS/TETST/02_BUMPER')
})

	test('resolveClipForAmcpLoad: CLS catalog basename match returns uppercase CLS id', () => {
		const ctx = {
			CHOICES_MEDIAFILES: [{ id: 'projects/tetst/02_BUMPER.mp4', label: 'projects/tetst/02_BUMPER.mp4' }],
			config: { projectScopedMedia: { enabled: true } },
			persistence: { get: () => 'other_project' },
		}
		assert.equal(resolveClipForAmcpLoad('02_BUMPER', ctx), 'PROJECTS/TETST/02_BUMPER')
	})

	test('resolveClipForAmcpLoad: disk layout wins when active slug mismatches project folder', () => {
		const ctx = {
			config: {
				projectScopedMedia: { enabled: true },
				local_media_path: require('path').join(__dirname, '../../media'),
			},
			persistence: { get: (k) => (k === 'web_project_active_slug' ? 'untitled' : null) },
			CHOICES_MEDIAFILES: [],
		}
		assert.equal(resolveClipForAmcpLoad('02_BUMPER.mp4', ctx), 'PROJECTS/TETST/02_BUMPER')
		assert.equal(resolveClipForAmcpLoad('02_BUMPER', ctx), 'PROJECTS/TETST/02_BUMPER')
	})

const { normalizeClipPlayAmcpLine } = require('../../src/caspar/amcp-clip-resolve')

test('normalizeClipPlayAmcpLine: expands project basename in PLAY', () => {
	const ctx = {
		config: {
			projectScopedMedia: { enabled: true },
			local_media_path: require('path').join(__dirname, '../../media'),
		},
		persistence: { get: (k) => (k === 'web_project_active_slug' ? 'tetst' : null) },
	}
	const line = normalizeClipPlayAmcpLine('PLAY 2-10 "02_BUMPER"', ctx)
	assert.equal(line, 'PLAY 2-10 "PROJECTS/TETST/02_BUMPER"')
})

test('normalizeClipPlayAmcpLine: expands quoted basename with extension in PLAY', () => {
	const ctx = {
		config: { projectScopedMedia: { enabled: true } },
		persistence: { get: (k) => (k === 'web_project_active_slug' ? 'untitled888' : null) },
	}
	const line = normalizeClipPlayAmcpLine('PLAY 2-10 "MAIN SCREEN.png"', ctx)
	assert.equal(line, 'PLAY 2-10 "PROJECTS/UNTITLED888/MAIN SCREEN"')
})

test('normalizeClipPlayAmcpLine: leaves route clips unchanged', () => {
	const line = normalizeClipPlayAmcpLine('PLAY 2-20 route://1-10', null)
	assert.equal(line, 'PLAY 2-20 route://1-10')
})
