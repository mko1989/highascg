'use strict'

/**
 * WO-921 — a new media version takes its own file name (owner 01.11: the media browser and every look must show the
 * latest version's name). The upload route carries the multipart file name through; Go back restores the old name;
 * references (path, CLS id, label, a look named after its clip) follow like a rename. Temp dirs only.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')

const registry = require('../../src/media/media-library-registry')
const versions = require('../../src/media/media-versions')
const links = require('../../src/media/media-links')
const { handleVersionUpload } = require('../../src/api/routes-media-versions')
const { rewriteProjectMediaRefs } = require('../../src/media/media-reference-rewrite')

/** A multipart POST like stream_upload.gd / the web FormData send. */
function multipartReq(filename, content) {
	const b = 'wo921boundary'
	const body = Buffer.from(
		`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${b}--\r\n`,
	)
	const req = Readable.from([body])
	req.headers = { 'content-type': `multipart/form-data; boundary=${b}`, 'content-length': String(body.length) }
	return req
}

describe('WO-921 a new version takes its own name', () => {
	let tmp
	let media
	let config
	let ctx
	const OLD = 'show/intro_v2.mov'
	const NEW = 'show/intro_v3.mov'
	const at = (p) => path.join(media, p)

	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo921-'))
		media = path.join(tmp, 'media')
		fs.mkdirSync(path.join(media, 'show'), { recursive: true })
		fs.writeFileSync(at(OLD), 'V2')
		registry._setRegistryDirForTests(path.join(tmp, 'reg'))
		versions._setVersionsRootForTests(path.join(tmp, 'versions'))
		// no projects on disk: the reference rewrite is covered by the pure test below
		links._setProjectStoreForTests({ projectsDir: () => path.join(tmp, 'no-projects'), getActiveSlug: () => null })
		config = { local_media_path: media }
		registry.reconcileWithDisk(config)
		ctx = { config, persistence: {}, log: () => {} }
	})
	after(() => {
		registry._setRegistryDirForTests(null)
		versions._setVersionsRootForTests(null)
		links._setProjectStoreForTests(null)
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('versionFileName keeps one safe path segment with an extension', () => {
		assert.equal(versions.versionFileName('C:\\Users\\op\\intro_v3.mov'), 'intro_v3.mov')
		assert.equal(versions.versionFileName('../../etc/x.mov'), 'x.mov')
		assert.equal(versions.versionFileName('.hidden.mov'), '')
		assert.equal(versions.versionFileName('noext'), '')
	})

	it('the upload route installs the file under its own name; the entry and the old version keep track', async () => {
		const id = registry.getEntryByPath(OLD).id
		const res = await handleVersionUpload(multipartReq('intro_v3.mov', 'V3'), ctx, { path: OLD })
		const body = JSON.parse(res.body)
		assert.equal(res.status, 200, body.error)
		assert.deepEqual(body.renamed, { from: OLD, to: NEW })
		assert.equal(body.entry.path, NEW)
		assert.ok(!fs.existsSync(at(OLD)))
		assert.equal(fs.readFileSync(at(NEW), 'utf8'), 'V3')
		assert.equal(registry.getEntryByPath(NEW)?.id, id)
		assert.deepEqual(body.entry.versions.map((v) => [v.v, v.name]), [[1, 'intro_v2.mov']])
	})

	it('the same name again is a plain new version (no rename)', async () => {
		const res = await handleVersionUpload(multipartReq('intro_v3.mov', 'V3b'), ctx, { path: NEW })
		const body = JSON.parse(res.body)
		assert.equal(res.status, 200, body.error)
		assert.equal(body.renamed, null)
		assert.equal(fs.readFileSync(at(NEW), 'utf8'), 'V3b')
	})

	it('a name another file already has is refused — nothing moved', async () => {
		fs.writeFileSync(at('show/other.mov'), 'OTHER')
		const res = await handleVersionUpload(multipartReq('other.mov', 'X'), ctx, { path: NEW })
		assert.equal(res.status, 409)
		assert.equal(fs.readFileSync(at(NEW), 'utf8'), 'V3b')
		assert.equal(fs.readFileSync(at('show/other.mov'), 'utf8'), 'OTHER')
	})

	it('Go back restores that version under its own name', () => {
		const r = versions.restoreVersion(config, NEW, 1)
		assert.ok(r.ok, r.error)
		assert.deepEqual(r.renamed, { from: NEW, to: OLD })
		assert.equal(fs.readFileSync(at(OLD), 'utf8'), 'V2')
		assert.ok(!fs.existsSync(at(NEW)))
		assert.equal(registry.getEntryByPath(OLD).path, OLD)
	})

	it('a version stashed before WO-921 (no name) goes back under the current stem', () => {
		const e = registry.getEntryByPath(OLD)
		for (const v of e.versions) delete v.name
		const r = versions.restoreVersion(config, OLD, 3)
		assert.ok(r.ok, r.error)
		assert.equal(r.renamed, null)
		assert.equal(fs.readFileSync(at(OLD), 'utf8'), 'V3b')
	})

	it('looks, CLS ids and labels follow the new name', () => {
		const proj = {
			scenes: {
				scenes: [{ id: 's1', name: 'Show', layers: [
					{ source: { type: 'media', value: OLD, label: 'intro_v2.mov' } },
					{ source: { type: 'media', value: 'SHOW/INTRO_V2', label: 'intro_v2' } },
				] }],
			},
		}
		const { project: p, changed } = rewriteProjectMediaRefs(proj, 'demo', [{ from: OLD, to: NEW }], {})
		assert.equal(changed, 2)
		const [a, b] = p.scenes.scenes[0].layers.map((l) => l.source)
		assert.deepEqual([a.value, a.label], [NEW, 'intro_v3.mov'])
		assert.deepEqual([b.value, b.label], ['SHOW/INTRO_V3', 'intro_v3'])
	})

	it('a look named after its clip follows the new name; a look with its own name keeps it', () => {
		const look = (id, name) => ({ id, name, layers: [{ source: { type: 'media', value: OLD } }] })
		const proj = { scenes: { scenes: [look('a', 'intro_v2'), look('b', 'Opener'), look('c', 'intro_v2.mov')] } }
		const { project: p } = rewriteProjectMediaRefs(proj, 'demo', [{ from: OLD, to: NEW }], {})
		assert.deepEqual(p.scenes.scenes.map((s) => s.name), ['intro_v3', 'Opener', 'intro_v3.mov'])
	})

	it('the on-air look snapshot follows, so the next take flips a playable look onto PRV', async () => {
		const live = require('../../src/state/live-scene-state') // node:test → temp persistence file
		const scene = { id: 's1', name: 'intro_v2', layers: [{ layer: 10, source: { type: 'media', value: OLD } }] }
		await live.setChannel(2, { sceneId: 's1', scene, updatedAt: 123 })
		const sent = []
		const n = await links.applyRenamesToLiveLooks({ config: {}, _wsBroadcast: (t, d) => sent.push(d.path) }, null, [{ from: OLD, to: NEW }])
		assert.equal(n, 1)
		const e = live.getChannel(2)
		assert.deepEqual([e.scene.layers[0].source.value, e.scene.name, e.updatedAt], [NEW, 'intro_v3', 123])
		assert.ok(sent.includes('scene.live'), 'clients hear the new snapshot')
		await live.clearChannel(2)
	})
})
