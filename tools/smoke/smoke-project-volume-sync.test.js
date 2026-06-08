'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { mergeProjectCatalogs } = require('../../src/engine/project-volume-sync')

describe('project-volume-sync catalog merge', () => {
	it('prefers USB catalog when mounted and timestamps tie', () => {
		const merged = mergeProjectCatalogs(
			[
				[{ slug: 'show_a', name: 'Stick Show', savedAt: '2026-06-01T10:00:00.000Z', path: '/exfat/projects/show_a.json', source: 'usb' }],
				[{ slug: 'show_a', name: 'Local Show', savedAt: '2026-06-01T10:00:00.000Z', path: '/highascg/projects/show_a.json', source: 'local' }],
			],
			{ usbMounted: true },
		)
		assert.equal(merged.length, 1)
		assert.equal(merged[0].source, 'usb')
		assert.equal(merged[0].name, 'Stick Show')
	})

	it('keeps newest savedAt across sources', () => {
		const merged = mergeProjectCatalogs([
			[{ slug: 'show_b', name: 'Older', savedAt: '2026-06-01T09:00:00.000Z', path: '/bridge/projects/show_b.json', source: 'bridge' }],
			[{ slug: 'show_b', name: 'Newer', savedAt: '2026-06-01T11:00:00.000Z', path: '/highascg/projects/show_b.json', source: 'local' }],
		])
		assert.equal(merged[0].name, 'Newer')
		assert.equal(merged[0].source, 'local')
	})
})
