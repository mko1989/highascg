'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
	createMediaFolder,
	moveMediaFile,
	copyMediaFile,
	mediaParentId,
	isDescendantFolderPath,
} = require('../../src/media/local-media-api')

describe('media file ops', () => {
	/** @type {string} */
	let tmp
	/** @type {object} */
	let cfg

	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-media-'))
		cfg = { local_media_path: tmp }
		fs.writeFileSync(path.join(tmp, 'a.mov'), 'aaa')
		fs.writeFileSync(path.join(tmp, 'root.mov'), 'root')
	})

	after(() => {
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('mkdir creates nested folder', async () => {
		const r = await createMediaFolder(cfg, 'archive/2026')
		assert.equal(r.status, 200)
		assert.ok(fs.statSync(path.join(tmp, 'archive', '2026')).isDirectory())
	})

	it('mkdir returns 409 when folder exists', async () => {
		const r = await createMediaFolder(cfg, 'archive/2026')
		assert.equal(r.status, 409)
	})

	it('move places file in target folder', async () => {
		const r = await moveMediaFile(cfg, 'a.mov', 'archive')
		assert.equal(r.status, 200)
		assert.ok(fs.existsSync(path.join(tmp, 'archive', 'a.mov')))
		assert.ok(!fs.existsSync(path.join(tmp, 'a.mov')))
	})

	it('copy leaves source intact', async () => {
		const r = await copyMediaFile(cfg, 'root.mov', 'archive')
		assert.equal(r.status, 200)
		assert.ok(fs.existsSync(path.join(tmp, 'root.mov')))
		assert.ok(fs.existsSync(path.join(tmp, 'archive', 'root.mov')))
	})

	it('move to media root uses empty targetId', async () => {
		const r = await moveMediaFile(cfg, 'archive/a.mov', '')
		assert.equal(r.status, 200)
		assert.ok(fs.existsSync(path.join(tmp, 'a.mov')))
	})

	it('rejects move into descendant folder', () => {
		assert.equal(isDescendantFolderPath('a/b', 'a/b/c'), true)
		assert.equal(mediaParentId('clips/foo.mov'), 'clips')
	})
})
