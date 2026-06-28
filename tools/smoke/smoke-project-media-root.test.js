'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const {
	getDefaultIngestSubdir,
	getProjectMediaRoot,
	getProjectMediaRelId,
	ensureProjectMediaDir,
	normalizeMediaIdForProject,
	expandMediaIdToMediaRoot,
	buildProjectMediaManifest,
	isProjectScopedMediaEnabled,
} = require('../../src/media/project-media-root')
const { resolveMediaFileOnDisk } = require('../../src/media/local-media-paths')

describe('project-scoped media root', () => {
	/** @type {string} */
	let tmp
	/** @type {object} */
	let cfg
	const slug = 'evening_news'

	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-proj-media-'))
		cfg = { local_media_path: tmp, projectScopedMedia: { enabled: true } }
		projectStore.setActiveSlug(persistence, slug)
	})

	after(() => {
		projectStore.setActiveSlug(persistence, '')
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('maps slug to projects/<slug> paths', () => {
		assert.equal(getProjectMediaRelId(slug), 'projects/evening_news')
		assert.equal(getDefaultIngestSubdir(cfg), 'projects/evening_news')
		assert.equal(getProjectMediaRoot(cfg, persistence, slug), path.join(tmp, 'projects', slug))
	})

	it('maps slug to exfat/projects/<slug> when location is exfat', () => {
		const exfatCfg = { ...cfg, projectScopedMedia: { enabled: true, location: 'exfat' } }
		assert.equal(getProjectMediaRelId(slug, exfatCfg), 'exfat/projects/evening_news')
		assert.equal(getDefaultIngestSubdir(exfatCfg), 'exfat/projects/evening_news')
		assert.equal(getProjectMediaRoot(exfatCfg, persistence, slug), path.join(tmp, 'exfat', 'projects', slug))
	})

	it('maps slug to bridge/projects/<slug> when location is bridge', () => {
		const bridgeCfg = { ...cfg, projectScopedMedia: { enabled: true, location: 'bridge' } }
		assert.equal(getProjectMediaRelId(slug, bridgeCfg), 'bridge/projects/evening_news')
		assert.equal(getDefaultIngestSubdir(bridgeCfg), 'bridge/projects/evening_news')
		assert.equal(getProjectMediaRoot(bridgeCfg, persistence, slug), path.join(tmp, 'bridge', 'projects', slug))
	})

	it('ensureProjectMediaDir creates folder', () => {
		const dir = ensureProjectMediaDir(cfg, slug)
		assert.ok(dir)
		assert.ok(fs.statSync(dir).isDirectory())
	})

	it('normalize and expand media ids', () => {
		assert.equal(normalizeMediaIdForProject('projects/evening_news/open.mxf', slug), 'open.mxf')
		assert.equal(normalizeMediaIdForProject('exfat/projects/evening_news/open.mxf', slug, { projectScopedMedia: { location: 'exfat' } }), 'open.mxf')
		assert.equal(expandMediaIdToMediaRoot('open.mxf', slug), 'projects/evening_news/open.mxf')
		assert.equal(
			expandMediaIdToMediaRoot('open.mxf', slug, { projectScopedMedia: { location: 'bridge' } }),
			'bridge/projects/evening_news/open.mxf',
		)
	})

	it('resolveMediaFileOnDisk finds project-relative clip', () => {
		const clipPath = path.join(tmp, 'projects', slug, 'clip.mov')
		fs.mkdirSync(path.dirname(clipPath), { recursive: true })
		fs.writeFileSync(clipPath, 'video')
		const resolved = resolveMediaFileOnDisk(cfg, 'clip.mov')
		assert.equal(resolved, clipPath)
	})

	it('buildProjectMediaManifest includes project folder only when enabled', () => {
		fs.writeFileSync(path.join(tmp, 'shared.mov'), 'shared')
		fs.writeFileSync(path.join(tmp, 'projects', slug, 'show.mov'), 'show')
		const project = {
			name: 'Evening News',
			scenes: { scenes: [{ layers: [{ source: { type: 'media', value: 'show.mov' } }] }] },
		}
		const manifest = buildProjectMediaManifest(cfg, persistence, project)
		const paths = manifest.map((m) => m.path)
		assert.ok(paths.includes('projects/evening_news/show.mov'))
		assert.ok(!paths.includes('shared.mov'))
	})

	it('resolveMediaFileOnDisk still finds shared library paths', () => {
		fs.mkdirSync(path.join(tmp, 'stock'), { recursive: true })
		fs.writeFileSync(path.join(tmp, 'stock', 'loop.mp4'), 'shared')
		const resolved = resolveMediaFileOnDisk(cfg, 'stock/loop.mp4')
		assert.equal(resolved, path.join(tmp, 'stock', 'loop.mp4'))
	})

	it('disabled mode uses flat media root for ingest subdir', () => {
		const off = { ...cfg, projectScopedMedia: { enabled: false } }
		assert.equal(isProjectScopedMediaEnabled(off), false)
		assert.equal(getDefaultIngestSubdir(off), '')
	})
})
