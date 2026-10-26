'use strict'

/**
 * WO-592 B — media version control: new version keeps the path, old ones are kept until purged,
 * restore swaps (nothing lost), purge/final-delete remove files; a version may change the container
 * (previz .mp4 → show .mov) — only the extension of the path moves. Temp dirs only.
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

	describe('another container (previz .mp4 → show .mov)', () => {
		const MP4 = 'clips/show.mp4'
		const MOV = 'clips/show.mov'
		const at = (p) => path.join(media, p)
		const stageAs = (p, ext, txt) => {
			const s = versions.stagingPathFor(registry.getEntryByPath(p).id, ext)
			fs.mkdirSync(path.dirname(s), { recursive: true })
			fs.writeFileSync(s, txt)
			return s
		}
		before(() => {
			fs.writeFileSync(at(MP4), 'PREVIZ')
			registry.reconcileWithDisk(config)
		})

		it('a .mov version replaces the .mp4: the path changes extension only, the entry follows', () => {
			const id = registry.getEntryByPath(MP4).id
			const r = versions.installNewVersion(config, MP4, stageAs(MP4, '.mov', 'HAP'))
			assert.ok(r.ok, r.error)
			assert.deepEqual(r.renamed, { from: MP4, to: MOV })
			assert.ok(!fs.existsSync(at(MP4)))
			assert.equal(fs.readFileSync(at(MOV), 'utf8'), 'HAP')
			assert.equal(registry.getEntryByPath(MOV)?.id, id)
			assert.equal(registry.getEntryByPath(MP4), null)
			assert.deepEqual(r.entry.versions.map((v) => v.file), ['v1.mp4'])
		})

		it('a same-container version reports no rename', () => {
			const r = versions.installNewVersion(config, MOV, stageAs(MOV, '.mov', 'PRORES'))
			assert.ok(r.ok, r.error)
			assert.equal(r.renamed, null)
			assert.equal(fs.readFileSync(at(MOV), 'utf8'), 'PRORES')
		})

		it('going back to the .mp4 version moves the path back', () => {
			const r = versions.restoreVersion(config, MOV, 1)
			assert.ok(r.ok, r.error)
			assert.deepEqual(r.renamed, { from: MOV, to: MP4 })
			assert.equal(fs.readFileSync(at(MP4), 'utf8'), 'PREVIZ')
			assert.ok(!fs.existsSync(at(MOV)))
			assert.deepEqual(r.entry.versions.map((v) => v.file).sort(), ['v2.mov', 'v3.mov'])
		})

		it('refuses to land on another file with that name — nothing moved', () => {
			fs.writeFileSync(at(MOV), 'SOMEONE ELSE')
			const staged = stageAs(MP4, '.mov', 'NEW')
			const r = versions.installNewVersion(config, MP4, staged)
			assert.equal(r.status, 409)
			assert.equal(fs.readFileSync(at(MP4), 'utf8'), 'PREVIZ')
			assert.equal(fs.readFileSync(at(MOV), 'utf8'), 'SOMEONE ELSE')
			assert.equal(versions.restoreVersion(config, MP4, 2).status, 409)
			fs.rmSync(staged)
		})

		it('looks and timelines follow the extension change like a rename', () => {
			const { rewriteProjectMediaRefs } = require('../../src/media/media-reference-rewrite')
			const proj = {
				scenes: { scenes: [{ id: 's1', name: 'Show', layers: [{ source: { type: 'media', value: MP4 } }, { source: { type: 'media', value: 'CLIPS/SHOW' } }] }] },
				timelines: { timelines: [{ id: 't1', name: 'T', layers: [{ clips: [{ source: { type: 'media', value: MP4 } }] }] }] },
			}
			const { project: p, changed } = rewriteProjectMediaRefs(proj, 'demo', [{ from: MP4, to: MOV }], {})
			assert.equal(changed, 3)
			assert.equal(p.scenes.scenes[0].layers[0].source.value, MOV)
			assert.equal(p.scenes.scenes[0].layers[1].source.value, 'CLIPS/SHOW', 'CLS id has no extension — unchanged')
			assert.equal(p.timelines.timelines[0].layers[0].clips[0].source.value, MOV)
		})
	})
})

