'use strict'

/**
 * WO-833 (3i) — media delete / move / copy must touch the file the operator NAMED.
 *
 * resolveMediaFileOnDisk (a READER) tries the active project's copy of a bare id first and then falls back to any file
 * anywhere whose stem matches, case-folded. Used by the file manager that meant: delete `B/INTRO` -> `a/intro.mp4`
 * gone; delete `intro.mp4` -> the project's copy gone instead of the root one. Data-destructive.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const { resolveMediaFileOnDisk, resolveMediaFileOnDiskExact } = require('../../src/media/local-media-paths')
const { unlinkMediaById, moveMediaFile, copyMediaFile } = require('../../src/media/local-media-api')

describe('WO-833 3i: media file ops resolve the id given', () => {
	let tmp
	let cfg
	const slug = 'evening_news'
	const put = (rel, body) => {
		const fp = path.join(tmp, ...rel.split('/'))
		fs.mkdirSync(path.dirname(fp), { recursive: true })
		fs.writeFileSync(fp, body)
	}
	const body = (rel) => {
		try {
			return fs.readFileSync(path.join(tmp, ...rel.split('/')), 'utf8')
		} catch {
			return null
		}
	}

	before(() => {
		projectStore.setActiveSlug(persistence, slug)
	})
	after(() => {
		projectStore.setActiveSlug(persistence, '')
	})

	function fixture() {
		if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-wo833-media-'))
		cfg = { local_media_path: tmp, projectScopedMedia: { enabled: true } }
		put('intro.mp4', 'ROOT')
		put(`projects/${slug}/intro.mp4`, 'PROJECT')
		put('a/intro.mp4', 'A-FOLDER')
		fs.mkdirSync(path.join(tmp, 'B'), { recursive: true })
	}
	after(() => tmp && fs.rmSync(tmp, { recursive: true, force: true }))

	it('readers keep the project-first order (scene refs are project-relative) — unchanged', () => {
		fixture()
		assert.equal(fs.readFileSync(resolveMediaFileOnDisk(cfg, 'intro.mp4'), 'utf8'), 'PROJECT')
	})

	it('exact resolver: the id given wins over the active project copy', () => {
		fixture()
		assert.equal(fs.readFileSync(resolveMediaFileOnDiskExact(cfg, 'intro.mp4'), 'utf8'), 'ROOT')
		assert.equal(fs.readFileSync(resolveMediaFileOnDiskExact(cfg, `projects/${slug}/intro.mp4`), 'utf8'), 'PROJECT')
		assert.equal(fs.readFileSync(resolveMediaFileOnDiskExact(cfg, 'MEDIA/a/intro.mp4'), 'utf8'), 'A-FOLDER')
	})

	it('delete: `B/INTRO` (no such file) is a 404 — it must not delete a/intro.mp4 by stem', async () => {
		fixture()
		const r = await unlinkMediaById(cfg, 'B/INTRO')
		assert.equal(r.status, 404, r.body)
		assert.deepEqual([body('intro.mp4'), body('a/intro.mp4'), body(`projects/${slug}/intro.mp4`)], ['ROOT', 'A-FOLDER', 'PROJECT'])
	})

	it('delete: a different-case id does not case-collide with another file', async () => {
		fixture()
		const r = await unlinkMediaById(cfg, 'a/INTRO.mp4')
		assert.equal(r.status, 404, r.body)
		assert.equal(body('a/intro.mp4'), 'A-FOLDER')
	})

	it('delete: `intro.mp4` removes the root file, not the active project copy', async () => {
		fixture()
		const r = await unlinkMediaById(cfg, 'intro.mp4')
		assert.equal(r.status, 200, r.body)
		assert.equal(body('intro.mp4'), null)
		assert.equal(body(`projects/${slug}/intro.mp4`), 'PROJECT')
	})

	it('delete: an extension-less id deletes only an unambiguous same-folder match', async () => {
		fixture()
		put('a/solo.mov', 'S')
		put('a/dup.mov', '1')
		put('a/dup.mp4', '2')
		assert.equal((await unlinkMediaById(cfg, 'a/dup')).status, 404, 'ambiguous -> refuse')
		assert.deepEqual([body('a/dup.mov'), body('a/dup.mp4')], ['1', '2'])
		assert.equal((await unlinkMediaById(cfg, 'a/solo')).status, 200)
		assert.equal(body('a/solo.mov'), null)
	})

	it('delete: a folder id removes the folder, never a same-stem file elsewhere', async () => {
		fixture()
		put('clips/x.mp4', 'X')
		put('other/clips.mp4', 'STEM')
		const r = await unlinkMediaById(cfg, 'clips')
		assert.equal(r.status, 200, r.body)
		assert.equal(fs.existsSync(path.join(tmp, 'clips')), false)
		assert.equal(body('other/clips.mp4'), 'STEM')
	})

	it('move: moves the file named, not the project copy', async () => {
		fixture()
		fs.mkdirSync(path.join(tmp, 'archive'))
		const r = await moveMediaFile(cfg, 'intro.mp4', 'archive')
		assert.equal(r.status, 200, r.body)
		assert.equal(body('archive/intro.mp4'), 'ROOT')
		assert.equal(body(`projects/${slug}/intro.mp4`), 'PROJECT')
		assert.equal(body('intro.mp4'), null)
	})

	it('copy: copies the file named; a stem-only match is a 404', async () => {
		fixture()
		fs.mkdirSync(path.join(tmp, 'archive'))
		assert.equal((await copyMediaFile(cfg, 'B/INTRO', 'archive')).status, 404)
		assert.equal((await copyMediaFile(cfg, 'intro.mp4', 'archive')).status, 200)
		assert.equal(body('archive/intro.mp4'), 'ROOT')
	})
})
