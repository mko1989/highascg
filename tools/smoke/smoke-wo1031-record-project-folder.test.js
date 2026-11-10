'use strict'

/**
 * WO-1031 — a record output with `folder: 'project'` writes into the active show's media folder
 * (media/projects/<slug>/), given to Caspar as a path under its media folder; anything else stays in the media root.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { recordRelativeName } = require('../../src/api/routes-streaming-channel-record')

test('record file name: in the show folder for a project row, the media root otherwise', () => {
	const ctx = { config: {}, log() {} }
	const inside = { ensureProjectMediaDir: () => '/srv/media/projects/narvil' }
	assert.strictEqual(recordRelativeName(ctx, { folder: 'project' }, '/srv/media', 'Rec_1.mp4', inside), 'projects/narvil/Rec_1.mp4')
	assert.strictEqual(recordRelativeName(ctx, { folder: 'project' }, '/srv/media/', 'Rec_1.mp4', inside), 'projects/narvil/Rec_1.mp4')
	assert.strictEqual(recordRelativeName(ctx, { folder: 'media' }, '/srv/media', 'Rec_1.mp4', inside), 'Rec_1.mp4')
	assert.strictEqual(recordRelativeName(ctx, {}, '/srv/media', 'Rec_1.mp4', inside), 'Rec_1.mp4')
})

test('record file name: a project folder outside the media folder, none, or a throwing lookup falls back to the root', () => {
	const warned = []
	const ctx = { config: {}, log: (l, m) => warned.push(m) }
	assert.strictEqual(recordRelativeName(ctx, { folder: 'project' }, '/srv/media', 'a.mp4', { ensureProjectMediaDir: () => '/elsewhere/narvil' }), 'a.mp4')
	assert.strictEqual(recordRelativeName(ctx, { folder: 'project' }, '/srv/media', 'a.mp4', { ensureProjectMediaDir: () => null }), 'a.mp4')
	assert.strictEqual(recordRelativeName(ctx, { folder: 'project' }, '/srv/media', 'a.mp4', { ensureProjectMediaDir: () => { throw new Error('x') } }), 'a.mp4')
	assert.strictEqual(warned.length, 3, 'each fallback is logged')
})

test('settings keep the folder choice on a record row; the start uses the relative name for Caspar and for the reported path', () => {
	const post = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'api', 'settings-post.js'), 'utf8')
	assert.ok(post.includes("folder: String(x.folder || '').trim().toLowerCase() === 'project' ? 'project' : 'media'"))
	const rec = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'api', 'routes-streaming-channel-record.js'), 'utf8')
	assert.ok(rec.includes('const absPath = joinCasparMediaFile(dir, relName)'))
	assert.ok(rec.includes('const paramsAfterPath = `${param(relName)} ${args}`'))
})
