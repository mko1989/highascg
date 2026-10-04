'use strict'

/**
 * WO-592 B — media version control: new version keeps the path, old ones are kept until purged,
 * restore swaps (nothing lost), purge/final-delete remove files. Temp dirs only.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const registry = require('../../src/media/media-library-registry')
const versions = require('../../src/media/media-versions')

describe('WO-592 B media versions', () => {
	let tmp
	let media
	let config
	const P = 'clips/loop.mov'
	const read = () => fs.readFileSync(path.join(media, P), 'utf8')
	const stage = (txt) => {
		const e = registry.getEntryByPath(P)
		const s = versions.stagingPathFor(e.id, '.mov')
		fs.mkdirSync(path.dirname(s), { recursive: true })
		fs.writeFileSync(s, txt)
		return s
	}

	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo592v-'))
		media = path.join(tmp, 'media')
		fs.mkdirSync(path.join(media, 'clips'), { recursive: true })
		fs.writeFileSync(path.join(media, P), 'ONE')
		registry._setRegistryDirForTests(path.join(tmp, 'reg'))
		versions._setVersionsRootForTests(path.join(tmp, 'versions'))
		config = { local_media_path: media }
		registry.reconcileWithDisk(config)
	})
	after(() => {
		registry._setRegistryDirForTests(null)
		versions._setVersionsRootForTests(null)
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('a new version takes over the SAME path; the old one is listed and kept', () => {
		const r = versions.installNewVersion(config, P, stage('TWO'))
		assert.ok(r.ok)
		assert.equal(read(), 'TWO')
		assert.equal(r.entry.currentV, 2)
		assert.deepEqual(r.entry.versions.map((v) => v.v), [1])
		versions.installNewVersion(config, P, stage('THREE'))
		assert.equal(read(), 'THREE')
		assert.deepEqual(registry.getEntryByPath(P).versions.map((v) => v.v).sort(), [1, 2])
	})

	it('restore goes back to the chosen version; the current one becomes a version (nothing lost)', () => {
		const r = versions.restoreVersion(config, P, 1)
		assert.ok(r.ok, r.error)
		assert.equal(read(), 'ONE')
		assert.equal(r.entry.currentV, 1)
		assert.deepEqual(r.entry.versions.map((v) => v.v).sort(), [2, 3])
		const back = versions.restoreVersion(config, P, 3)
		assert.ok(back.ok)
		assert.equal(read(), 'THREE')
		assert.deepEqual(back.entry.versions.map((v) => v.v).sort(), [1, 2])
	})

	it('purge removes one old version for good; final delete removes the whole store', () => {
		const e = registry.getEntryByPath(P)
		const r = versions.purgeVersion(P, 2)
		assert.ok(r.ok)
		assert.deepEqual(r.entry.versions.map((v) => v.v), [1])
		assert.ok(!fs.existsSync(path.join(tmp, 'versions', e.id, 'v2.mov')))
		assert.ok(fs.existsSync(path.join(tmp, 'versions', e.id, 'v1.mov')))
		versions.removeAllVersions([e.id])
		assert.ok(!fs.existsSync(path.join(tmp, 'versions', e.id)))
	})

	it('unknown version / file → clean errors, nothing moved', () => {
		assert.equal(versions.restoreVersion(config, P, 99).status, 404)
		assert.equal(versions.installNewVersion(config, 'clips/nope.mov', '/nonexistent').status, 404)
		assert.equal(read(), 'THREE')
	})
})
