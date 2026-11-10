'use strict'

/**
 * WO-603 — project media bar on the server: GET /api/media/project lists the clips the open project references outside
 * its folder; POST /api/media/gather moves them in through moveMediaFile + followMediaMoves (WO-592 links), so the
 * project's references follow. Temp media + projects dirs only — never the live media/ or projects/.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const registry = require('../../src/media/media-library-registry')
const links = require('../../src/media/media-links')
const gather = require('../../src/media/project-media-gather')
const routes = require('../../src/api/routes-media-library')

const ref = (value) => ({ type: 'media', value, label: value })
function project() {
	return {
		version: 2,
		name: 'Demo',
		scenes: {
			scenes: [
				{
					id: 's1',
					name: 'Opening',
					layers: [
						{ layerNumber: 10, source: ref('other/a.mov') }, // outside → gathered
						{ layerNumber: 20, source: ref('projects/demo/in.mov') }, // already inside
						{ layerNumber: 30, source: { type: 'media', value: 'OTHER/B', label: 'B' } }, // CLS form, no extension
						{ layerNumber: 40, source: { type: 'route', value: 'route://2' } }, // not media
						{ layerNumber: 50, source: ref('gone/missing.mov') }, // not on disk → nothing to move
					],
				},
			],
		},
		timelines: [{ id: 't1', name: 'TL', layers: [{ clips: [{ source: ref('other/a.mov') }] }] }],
	}
}

describe('WO-603 planGather (pure)', () => {
	it('referenced catalog files outside the project folder, deduped; CLS-form refs resolve; inside / missing / routes skip', () => {
		const ids = ['other/a.mov', 'other/b.mp4', 'other/unused.mov', 'projects/demo/in.mov']
		const pending = gather.planGather(project(), 'demo', ids, 'projects/demo', { projectScopedMedia: { enabled: false } })
		assert.deepEqual(pending.sort(), ['other/a.mov', 'other/b.mp4'])
	})
})

describe('WO-603 GET /api/media/project + POST /api/media/gather (temp media + projects)', () => {
	let tmp
	let ctx
	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo603-gather-'))
		const media = path.join(tmp, 'media')
		const projects = path.join(tmp, 'projects')
		fs.mkdirSync(path.join(media, 'other'), { recursive: true })
		fs.mkdirSync(path.join(media, 'projects/demo'), { recursive: true })
		fs.mkdirSync(path.join(projects, '_autosave'), { recursive: true })
		for (const n of ['other/a.mov', 'other/b.mp4', 'other/unused.mov', 'projects/demo/in.mov']) fs.writeFileSync(path.join(media, n), n)
		fs.writeFileSync(path.join(projects, 'demo.json'), JSON.stringify(project()))
		registry._setRegistryDirForTests(path.join(tmp, 'reg'))
		links._setProjectStoreForTests({
			projectsDir: () => projects,
			isSafeProjectSlug: (s) => /^[\w.-]+$/.test(s),
			getActiveSlug: () => null,
			projectFilePath: (s) => path.join(projects, `${s}.json`),
			autosaveFilePath: (s) => path.join(projects, '_autosave', `${s}.json`),
		})
		gather._setActiveProjectForTests(() => ({ slug: 'demo', project: JSON.parse(fs.readFileSync(path.join(projects, 'demo.json'), 'utf8')) }))
		ctx = { config: { local_media_path: media }, persistence: { get: () => null, set: () => {} }, log: () => {} }
	})
	after(() => {
		registry._setRegistryDirForTests(null)
		links._setProjectStoreForTests(null)
		gather._setActiveProjectForTests(null)
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('GET names the folder and the pending clips', () => {
		const r = routes.handleProjectGet(ctx)
		const body = JSON.parse(r.body)
		assert.equal(r.status, 200)
		assert.deepEqual([body.enabled, body.slug, body.folder], [true, 'demo', 'projects/demo'])
		assert.deepEqual(body.pending.sort(), ['other/a.mov', 'other/b.mp4'])
	})

	it('gather moves them in; every reference (look, CLS form, timeline) follows; then nothing is pending', async () => {
		const r = await gather.gatherProjectMedia(ctx)
		assert.equal(r.status, 200, JSON.stringify(r.body))
		assert.deepEqual(r.body.moved.map((m) => m.to).sort(), ['projects/demo/a.mov', 'projects/demo/b.mp4'])
		assert.deepEqual(r.body.failed, [])
		assert.ok(fs.existsSync(path.join(tmp, 'media/projects/demo/a.mov')))
		assert.ok(!fs.existsSync(path.join(tmp, 'media/other/a.mov')))
		assert.ok(fs.existsSync(path.join(tmp, 'media/other/unused.mov')), 'unreferenced clips stay')
		const p = JSON.parse(fs.readFileSync(path.join(tmp, 'projects/demo.json'), 'utf8'))
		const layers = p.scenes.scenes[0].layers
		assert.equal(layers[0].source.value, 'projects/demo/a.mov')
		assert.equal(layers[2].source.value.toUpperCase(), 'PROJECTS/DEMO/B', 'the CLS-form value keeps its shape')
		assert.equal(layers[3].source.value, 'route://2')
		assert.equal(p.timelines[0].layers[0].clips[0].source.value, 'projects/demo/a.mov')
		assert.deepEqual(gather.projectMediaInfo(ctx).pending, [])
	})

	it('refuses when project media folders are off or no project is open', async () => {
		const off = await gather.gatherProjectMedia({ ...ctx, config: { ...ctx.config, projectScopedMedia: { enabled: false } } })
		assert.equal(off.status, 409)
		gather._setActiveProjectForTests(() => ({ slug: '', project: null }))
		assert.equal((await gather.gatherProjectMedia(ctx)).status, 409)
	})
})

describe('Gather copy mode (temp media + projects)', () => {
	let tmp
	let ctx
	const media = () => path.join(tmp, 'media')
	const strays = () => fs.readdirSync(path.join(media(), 'projects/demo')).filter((n) => n.endsWith('.part'))
	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gather-copy-'))
		const projects = path.join(tmp, 'projects')
		fs.mkdirSync(path.join(media(), 'other'), { recursive: true })
		fs.mkdirSync(path.join(media(), 'projects/demo'), { recursive: true })
		fs.mkdirSync(path.join(projects, '_autosave'), { recursive: true })
		for (const n of ['other/a.mov', 'other/a.mov.meta', 'other/b.mp4', 'other/unused.mov', 'projects/demo/in.mov']) fs.writeFileSync(path.join(media(), n), n)
		fs.writeFileSync(path.join(projects, 'demo.json'), JSON.stringify(project()))
		registry._setRegistryDirForTests(path.join(tmp, 'reg'))
		links._setProjectStoreForTests({
			projectsDir: () => projects,
			isSafeProjectSlug: (s) => /^[\w.-]+$/.test(s),
			getActiveSlug: () => null,
			projectFilePath: (s) => path.join(projects, `${s}.json`),
			autosaveFilePath: (s) => path.join(projects, '_autosave', `${s}.json`),
		})
		gather._setActiveProjectForTests(() => ({ slug: 'demo', project: JSON.parse(fs.readFileSync(path.join(projects, 'demo.json'), 'utf8')) }))
		ctx = { config: { local_media_path: media() }, persistence: { get: () => null, set: () => {} }, log: () => {} }
	})
	after(() => {
		registry._setRegistryDirForTests(null)
		links._setProjectStoreForTests(null)
		gather._setActiveProjectForTests(null)
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('unknown mode → 400 (route too); nothing touched', async () => {
		assert.equal((await gather.gatherProjectMedia(ctx, { mode: 'link' })).status, 400)
		const r = await routes.handleGather(ctx, JSON.stringify({ mode: 'bogus' }))
		assert.equal(r.status, 400)
		assert.ok(fs.existsSync(path.join(media(), 'other/a.mov')))
	})

	it('not enough space → 507 naming needed + available, nothing copied', async () => {
		const r = await gather.gatherProjectMedia(ctx, { mode: 'copy', freeBytes: async () => 3 })
		assert.equal(r.status, 507)
		assert.match(r.body.error, /need .* MB, .* MB available/)
		assert.ok(!fs.existsSync(path.join(media(), 'projects/demo/a.mov')))
		assert.deepEqual(strays(), [])
	})

	it('a failed copy leaves no temp file and the clip is reported failed', async () => {
		const safe = require('../../src/media/media-safe-copy')
		const dest = path.join(media(), 'projects/demo/x.mov')
		await assert.rejects(safe.copyFileAtomic(path.join(media(), 'nope.mov'), dest))
		assert.deepEqual(strays(), [])
		assert.ok(!fs.existsSync(dest))
	})

	it('destination exists (any case) → that clip fails, the other is copied', async () => {
		fs.writeFileSync(path.join(media(), 'projects/demo/A.MOV'), 'mine')
		const r = await gather.gatherProjectMedia(ctx, { mode: 'copy' })
		assert.equal(r.status, 200)
		assert.equal(r.body.ok, false)
		assert.deepEqual(r.body.failed.map((f) => f.id), ['other/a.mov'])
		assert.deepEqual(r.body.copied.map((c) => c.to), ['projects/demo/b.mp4'])
		assert.equal(fs.readFileSync(path.join(media(), 'projects/demo/A.MOV'), 'utf8'), 'mine')
		fs.rmSync(path.join(media(), 'projects/demo/A.MOV'))
	})

	it('copy: originals stay, copies + sidecar land in the project folder, references follow, moved stays empty', async () => {
		const r = await gather.gatherProjectMedia(ctx, { mode: 'copy' })
		assert.equal(r.status, 200, JSON.stringify(r.body))
		assert.equal(r.body.mode, 'copy')
		assert.deepEqual(r.body.moved, [])
		assert.deepEqual(r.body.copied.map((c) => c.to), ['projects/demo/a.mov']) // b.mp4 went over in the test before
		assert.deepEqual(r.body.failed, [])
		for (const n of ['other/a.mov', 'other/a.mov.meta', 'other/b.mp4']) assert.ok(fs.existsSync(path.join(media(), n)), `${n} stays`)
		for (const n of ['a.mov', 'a.mov.meta']) assert.ok(fs.existsSync(path.join(media(), 'projects/demo', n)), `${n} copied`)
		assert.equal(fs.readFileSync(path.join(media(), 'projects/demo/a.mov'), 'utf8'), 'other/a.mov')
		assert.deepEqual(strays(), [])
		const p = JSON.parse(fs.readFileSync(path.join(tmp, 'projects/demo.json'), 'utf8'))
		assert.equal(p.scenes.scenes[0].layers[0].source.value, 'projects/demo/a.mov')
		assert.equal(p.timelines[0].layers[0].clips[0].source.value, 'projects/demo/a.mov')
		assert.deepEqual(gather.projectMediaInfo(ctx).pending, [])
	})

	it('default (no mode) still moves', async () => {
		fs.writeFileSync(path.join(media(), 'other/c.mov'), 'c')
		gather._setActiveProjectForTests(() => ({ slug: 'demo', project: { scenes: { scenes: [{ layers: [{ source: ref('other/c.mov') }] }] } } }))
		const r = await routes.handleGather(ctx, '')
		const b = JSON.parse(r.body)
		assert.equal(b.mode, 'move')
		assert.deepEqual(b.moved.map((m) => m.to), ['projects/demo/c.mov'])
		assert.ok(!fs.existsSync(path.join(media(), 'other/c.mov')))
	})
})
