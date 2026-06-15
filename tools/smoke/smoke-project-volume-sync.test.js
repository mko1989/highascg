'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { mergeProjectCatalogs, copyIfSrcNewer } = require('../../src/engine/project-volume-sync')

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

	it('copyIfSrcNewer updates when source is newer', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-vol-'))
		const src = path.join(dir, 'src.json')
		const dst = path.join(dir, 'dst.json')
		fs.writeFileSync(dst, '{"v":1}', 'utf8')
		const old = Date.now() - 60_000
		fs.utimesSync(dst, old / 1000, old / 1000)
		fs.writeFileSync(src, '{"v":2}', 'utf8')
		assert.equal(copyIfSrcNewer(src, dst), true)
		assert.equal(fs.readFileSync(dst, 'utf8'), '{"v":2}')
		fs.rmSync(dir, { recursive: true, force: true })
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
