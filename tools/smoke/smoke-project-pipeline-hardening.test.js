'use strict'

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')

const projectStore = require('../../src/engine/project-store')
const { persistProject } = require('../../src/engine/project-scenes')
const { finalizeProjectCatalog } = require('../../src/engine/project-volume-sync')

describe('WO-106 project slug parity', () => {
	it('projectSlugFromName normalizes diacritics consistently', () => {
		const server = projectStore.projectSlugFromName('Zażółć #1')
		const { projectFileIdFromName } = require('../../client/lib/project-files.js')
		assert.equal(server, projectFileIdFromName('Zażółć #1'))
	})
})

describe('WO-106 persistProject failure semantics', () => {
	it('does not update web_project mirror when main write fails', () => {
		const persistence = {
			_data: {},
			get(k) {
				return this._data[k] ?? null
			},
			set(k, v) {
				this._data[k] = v
			},
		}
		const ctx = { persistence, config: {} }
		const project = {
			version: 2,
			name: 'Fail Test',
			savedAt: new Date().toISOString(),
			scenes: { scenes: [{ id: 'a', name: 'a', layers: [] }] },
		}
		const origWrite = projectStore.writeProjectFile
		projectStore.writeProjectFile = () => {
			throw new Error('disk full')
		}
		try {
			assert.throws(() => persistProject(ctx, project, { writeAutosave: false, pushVolumes: false }))
			assert.equal(persistence.get('web_project'), null)
		} finally {
			projectStore.writeProjectFile = origWrite
		}
	})
})

describe('WO-106 corrupt quarantine', () => {
	const slug = `__wo106_corrupt_${Date.now()}`
	const filePath = projectStore.projectFilePath(slug)

	after(() => {
		try {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
		} catch {}
		for (const ent of fs.readdirSync(projectStore.projectsDir())) {
			if (ent.startsWith(`${slug}.json.corrupt-`)) {
				try {
					fs.unlinkSync(projectStore.projectFilePath(ent.slice(0, -5).replace(/\.corrupt-.*/, '') + ent.slice(ent.indexOf('.corrupt'))))
				} catch {}
			}
			if (ent.includes(slug) && ent.includes('corrupt')) {
				try {
					fs.unlinkSync(require('path').join(projectStore.projectsDir(), ent))
				} catch {}
			}
		}
	})

	it('quarantines unreadable JSON on read', () => {
		projectStore.ensureProjectsDir()
		fs.writeFileSync(filePath, '{not json', 'utf8')
		const result = projectStore.readProjectFile(slug)
		assert.equal(result, null)
		assert.equal(fs.existsSync(filePath), false)
		const quarantined = fs
			.readdirSync(projectStore.projectsDir())
			.some((n) => n.startsWith(`${slug}.json.corrupt-`))
		assert.equal(quarantined, true)
	})
})

describe('WO-106 sync-conflict catalog dedup', () => {
	it('groups conflict copies under base slug', () => {
		const merged = finalizeProjectCatalog([
			{
				slug: 'untitled777',
				baseSlug: 'untitled777',
				name: 'Main',
				savedAt: '2026-06-27T10:00:00.000Z',
				path: '/p/untitled777.json',
				source: 'local',
				sizeBytes: 1000,
			},
			{
				slug: 'untitled777.sync-conflict-20260627-163733-ED7RF3B',
				baseSlug: 'untitled777',
				name: 'Conflict',
				savedAt: '2026-06-28T10:00:00.000Z',
				path: '/p/untitled777.sync-conflict.json',
				source: 'local',
				sizeBytes: 2000,
				isSyncConflict: true,
			},
		])
		assert.equal(merged.length, 1)
		assert.equal(merged[0].slug, 'untitled777')
		assert.equal(merged[0].conflict, true)
		assert.ok(merged[0].conflictSlugs?.length >= 1)
	})
})

describe('WO-106 autosave + live deck merge', () => {
	it('enrichProjectScenesFromLiveDeck prefers ctx.sceneDeck snapshots', () => {
		const { enrichProjectScenesFromLiveDeck } = require('../../src/engine/project-scenes')
		const project = {
			version: 2,
			name: 'Show',
			scenes: { scenes: [{ id: 'stale', name: 'stale', layers: [] }], layerPresets: [], lookPresets: [] },
		}
		const ctx = {
			sceneDeck: {
				sceneSnapshots: [{ id: 'live', name: 'live', layers: [{ source: { value: '1' } }] }],
				previewSceneId: 'live',
				layerPresets: [{ id: 'p1' }],
				lookPresets: [],
			},
		}
		const merged = enrichProjectScenesFromLiveDeck(project, ctx)
		assert.equal(merged.scenes.scenes[0].id, 'live')
		assert.equal(merged.scenes.previewSceneId, 'live')
		assert.equal(merged.scenes.layerPresets[0].id, 'p1')
	})
})

describe('WO-106 replication project tombstone', () => {
	it('receiveProjectTombstoneFromPeer retires non-active slug', async () => {
		const fs = require('fs')
		const projectStore = require('../../src/engine/project-store')
		const { receiveProjectTombstoneFromPeer } = require('../../src/replication/project-tombstone')
		const slug = `__wo106_tomb_${Date.now()}`
		const persistence = {
			_data: { web_project_active_slug: 'other_active' },
			get(k) {
				return this._data[k] ?? null
			},
			set(k, v) {
				this._data[k] = v
			},
		}
		projectStore.ensureProjectsDir()
		projectStore.writeProjectFile(slug, { version: 2, name: 'Tomb', scenes: { scenes: [] } })
		const ctx = {
			persistence,
			config: { replication: { enabled: true, pairId: 'pair-a', peer: { host: '127.0.0.1', port: 1, token: 't' } } },
			log: () => {},
		}
		const out = await receiveProjectTombstoneFromPeer(ctx, { pairId: 'pair-a', slug, reason: 'delete' })
		assert.equal(out.ok, true)
		assert.equal(projectStore.readProjectFile(slug), null)
		try {
			fs.rmSync(projectStore.projectFilePath(slug), { force: true })
		} catch {}
		for (const ent of fs.readdirSync(projectStore.projectsDir())) {
			if (ent.includes(slug)) {
				try {
					fs.rmSync(require('path').join(projectStore.projectsDir(), ent), { force: true, recursive: true })
				} catch {}
			}
		}
	})

	it('rejects tombstone for active slug', async () => {
		const { receiveProjectTombstoneFromPeer } = require('../../src/replication/project-tombstone')
		const slug = 'active_show'
		const persistence = {
			_data: { web_project_active_slug: slug },
			get(k) {
				return this._data[k] ?? null
			},
			set(k, v) {
				this._data[k] = v
			},
		}
		const ctx = {
			persistence,
			config: { replication: { enabled: true, pairId: 'pair-a', peer: { host: '127.0.0.1', port: 1, token: 't' } } },
		}
		const out = await receiveProjectTombstoneFromPeer(ctx, { pairId: 'pair-a', slug, reason: 'delete' })
		assert.equal(out.ok, false)
	})
})
