'use strict'

/**
 * WO-592 A — media links: references follow renames (all three value shapes), registry reconcile
 * re-links externally moved files, batch rename is all-or-nothing. Uses temp dirs only — never
 * the live media/ or projects/.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { rewriteProjectMediaRefs, findProjectMediaUsage } = require('../../src/media/media-reference-rewrite')
const registry = require('../../src/media/media-library-registry')
const links = require('../../src/media/media-links')

const scoped = { project_scoped_media: true }

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
						{ source: { type: 'media', value: 'intro.mov', label: 'projects/demo/intro.mov' } },
						{
							source: { type: 'media', value: 'testowe/loop.mp4', label: 'loop.mp4' },
							playlist: [
								{ id: 'a', type: 'media', value: 'testowe/loop.mp4', label: 'testowe/loop.mp4' },
								{ id: 'b', type: 'media', value: 'testowe/loop.mov', label: 'other' },
								{ id: 'c', type: 'media', value: 'TESTOWE/LOOP', label: 'LOOP' },
							],
						},
						{ source: { type: 'template', value: 'testowe/loop.mp4' } },
					],
				},
			],
		},
		timelines: { timelines: [{ id: 't1', name: 'Show', layers: [{ clips: [{ source: { type: 'media', value: 'testowe/loop.mp4' } }] }] }] },
	}
}

describe('WO-592 reference rewrite', () => {
	it('rewrites root-relative, CLS and timeline refs in their own shape; leaves other extensions + templates', () => {
		const { project: p, changed } = rewriteProjectMediaRefs(project(), 'demo', [{ from: 'testowe/loop.mp4', to: 'clips/Loop A.mp4' }], scoped)
		const L = p.scenes.scenes[0].layers
		assert.equal(changed, 4)
		assert.deepEqual(L[1].source, { type: 'media', value: 'clips/Loop A.mp4', label: 'Loop A.mp4' })
		assert.equal(L[1].playlist[0].value, 'clips/Loop A.mp4')
		assert.equal(L[1].playlist[0].label, 'clips/Loop A.mp4')
		assert.equal(L[1].playlist[1].value, 'testowe/loop.mov', 'a value WITH extension only matches its exact path')
		assert.equal(L[1].playlist[2].value, 'CLIPS/LOOP A', 'CLS-shaped value stays CLS-shaped')
		assert.equal(L[1].playlist[2].label, 'Loop A', 'ext-less basename label follows')
		assert.equal(L[2].source.value, 'testowe/loop.mp4', 'non-media refs untouched')
		assert.equal(p.timelines.timelines[0].layers[0].clips[0].source.value, 'clips/Loop A.mp4')
	})

	it('project-relative values stay project-relative while the file stays in the project folder', () => {
		const { project: p } = rewriteProjectMediaRefs(project(), 'demo', [{ from: 'projects/demo/intro.mov', to: 'projects/demo/sub/Intro.mov' }], scoped)
		assert.deepEqual(p.scenes.scenes[0].layers[0].source, { type: 'media', value: 'sub/Intro.mov', label: 'projects/demo/sub/Intro.mov' })
		const { project: q } = rewriteProjectMediaRefs(project(), 'demo', [{ from: 'projects/demo/intro.mov', to: 'shared/intro.mov' }], scoped)
		assert.equal(q.scenes.scenes[0].layers[0].source.value, 'shared/intro.mov', 'moved out of the project → full path')
	})

	it('usage lists each look/timeline once with a ref count', () => {
		const rows = findProjectMediaUsage(project(), 'demo', 'testowe/loop.mp4', scoped)
		assert.deepEqual(rows.map((r) => [r.kind, r.name, r.count]), [['look', 'Opening', 3], ['timeline', 'Show', 1]])
	})
})

describe('WO-592 registry reconcile', () => {
	const f = (p, ino, size = 10, mtimeMs = 1000) => ({ path: p, dev: 1, ino, size, mtimeMs })

	it('adopts new files, re-links by inode, then by unique size+mtime, else marks missing', () => {
		const reg = { version: 1, items: {} }
		registry.reconcileRegistry(reg, [f('a.mov', 1), f('b.mov', 2, 20, 2000), f('c.mov', 3, 30, 3000), f('d.mov', 4, 40, 4000)])
		assert.equal(Object.keys(reg.items).length, 4)
		const idA = Object.values(reg.items).find((e) => e.path === 'a.mov').id
		const r = registry.reconcileRegistry(reg, [f('x/a.mov', 1), f('y.mov', 99, 20, 2000), f('c.mov', 3, 30, 3000), f('new.mov', 5)])
		assert.deepEqual(r.relinked.map((x) => [x.from, x.to]), [['a.mov', 'x/a.mov'], ['b.mov', 'y.mov']])
		assert.equal(reg.items[idA].path, 'x/a.mov', 'the link (id) survives the move')
		assert.equal(r.added, 1)
		assert.equal(r.missing, 1)
		assert.ok(Object.values(reg.items).find((e) => e.path === 'd.mov').missingSince)
	})

	it('an ambiguous size+mtime match is NOT re-linked', () => {
		const reg = { version: 1, items: {} }
		registry.reconcileRegistry(reg, [f('a.mov', 1), f('b.mov', 2)])
		const r = registry.reconcileRegistry(reg, [f('z.mov', 7)])
		assert.equal(r.relinked.length, 0)
		assert.equal(r.added, 1)
	})
})

describe('WO-592 renameMediaFiles (temp media + projects)', () => {
	let tmp
	let ctx
	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo592-'))
		const media = path.join(tmp, 'media')
		const projects = path.join(tmp, 'projects')
		fs.mkdirSync(path.join(media, 'testowe'), { recursive: true })
		fs.mkdirSync(path.join(projects, '_autosave'), { recursive: true })
		for (const n of ['loop.mp4', 'a.mov', 'b.mov']) fs.writeFileSync(path.join(media, 'testowe', n), n)
		fs.writeFileSync(path.join(projects, 'demo.json'), JSON.stringify(project()))
		fs.writeFileSync(path.join(projects, '_autosave', 'demo.json'), JSON.stringify(project()))
		registry._setRegistryDirForTests(path.join(tmp, 'reg'))
		links._setProjectStoreForTests({
			projectsDir: () => projects,
			isSafeProjectSlug: (s) => /^[\w.-]+$/.test(s),
			getActiveSlug: () => null,
			projectFilePath: (s) => path.join(projects, `${s}.json`),
			autosaveFilePath: (s) => path.join(projects, '_autosave', `${s}.json`),
		})
		ctx = { config: { local_media_path: media, ...scoped }, persistence: { get: () => null, set: () => {} }, log: () => {} }
	})
	after(() => {
		registry._setRegistryDirForTests(null)
		links._setProjectStoreForTests(null)
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('renames on disk, and the project file AND its autosave follow', async () => {
		const r = await links.renameMediaFiles(ctx, [{ from: 'testowe/loop.mp4', to: 'testowe/Loop Final.mp4' }])
		assert.equal(r.status, 200, JSON.stringify(r.body))
		assert.ok(fs.existsSync(path.join(tmp, 'media/testowe/Loop Final.mp4')))
		for (const f of ['projects/demo.json', 'projects/_autosave/demo.json']) {
			const p = JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'))
			assert.equal(p.scenes.scenes[0].layers[1].playlist[0].value, 'testowe/Loop Final.mp4', f)
		}
		assert.equal(registry.getEntryByPath('testowe/Loop Final.mp4')?.path, 'testowe/Loop Final.mp4')
	})

	it('is all-or-nothing: a conflict anywhere refuses the whole batch before touching disk', async () => {
		const r = await links.renameMediaFiles(ctx, [
			{ from: 'testowe/a.mov', to: 'testowe/c.mov' },
			{ from: 'testowe/b.mov', to: 'testowe/c.mov' },
		])
		assert.equal(r.status, 409)
		assert.ok(fs.existsSync(path.join(tmp, 'media/testowe/a.mov')))
		assert.ok(!fs.existsSync(path.join(tmp, 'media/testowe/c.mov')))
	})

	it('refuses extension changes and traversal', async () => {
		assert.equal((await links.renameMediaFiles(ctx, [{ from: 'testowe/a.mov', to: 'testowe/a.mp4' }])).status, 400)
		assert.equal((await links.renameMediaFiles(ctx, [{ from: 'testowe/a.mov', to: '../a.mov' }])).status, 400)
	})
})
