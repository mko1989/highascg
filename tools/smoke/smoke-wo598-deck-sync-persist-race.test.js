'use strict'

/**
 * WO-598 (found 2026-10-18 on the box): a scene_deck_sync schedules a disk write 750 ms later of the
 * project AS IT WAS when the sync arrived. An autosave persisted in between (rev N+1, other fields
 * changed) was then overwritten by the stale snapshot (rev N, old fields) — journal + file mtimes proved
 * it. The flush must re-read the stored project and apply only the deck part. Runs in the test runner's
 * private projects dir (projects-root.js).
 */

const { test } = require('node:test')
const assert = require('node:assert')

const S = require('../../src/engine/project-scenes')
const projectStore = require('../../src/engine/project-store')

/* The merge reads the active slug from the persistence MODULE (loadFullProject), so the ctx must use the
 * same one — under the test runner it is a private scratch file (src/utils/persistence.js). */
function mkCtx() {
	return { persistence: require('../../src/utils/persistence'), config: {}, log: () => {} }
}
const look = (id, name, extra = {}) => ({ id, name, mainScope: '0', layers: [], ...extra })

test('a deck-sync flush keeps an autosave that landed after the sync (rev + non-deck fields)', () => {
	const ctx = mkCtx()
	S.persistProject(ctx, { version: 2, name: 'RaceShow', scenes: { scenes: [look('a', 'A'), look('b', 'B')] }, timelines: [] }, { writeAutosave: true })
	const rev0 = S.projectRevOf(projectStore.readProjectFile('raceshow'))
	// 1) deck sync: look b renamed (disk write deferred)
	const merged = S.mergeDeckSyncIntoProject(ctx, { looks: [], sceneSnapshots: [look('a', 'A'), look('b', 'B renamed')] })
	assert.ok(merged, 'deck sync accepted')
	// 2) autosave lands before the flush: same looks + a timeline + previs
	const auto = { ...projectStore.readProjectFile('raceshow'), scenes: { scenes: [look('a', 'A'), look('b', 'B renamed')] }, timelines: [{ id: 't1' }], previs: { stage: { objects: [1] } } }
	const r = S.persistProject(ctx, auto, { writeAutosave: true })
	assert.ok(r.rev > rev0, 'autosave bumped the rev')
	// 3) the deferred deck-sync write fires
	S.flushDeckSyncPersist()
	const stored = projectStore.readProjectFile('raceshow')
	assert.equal(stored.rev, r.rev, 'rev not regressed by the stale deck snapshot')
	assert.deepEqual(stored.timelines, [{ id: 't1' }], 'autosave timeline kept')
	assert.deepEqual(stored.previs, { stage: { objects: [1] } }, 'autosave previs kept')
	assert.equal(stored.scenes.scenes[1].name, 'B renamed', 'deck edit kept')
})

test('a deck edit newer than the stored looks is still written at flush', () => {
	const ctx = mkCtx()
	S.persistProject(ctx, { version: 2, name: 'RaceShow2', scenes: { scenes: [look('x', 'X')] } }, { writeAutosave: true })
	S.mergeDeckSyncIntoProject(ctx, { looks: [], sceneSnapshots: [look('x', 'X edited')] })
	S.flushDeckSyncPersist()
	assert.equal(projectStore.readProjectFile('raceshow2').scenes.scenes[0].name, 'X edited')
})

test('project switched before the flush → the old deck is NOT written into the new show', () => {
	const ctx = mkCtx()
	S.persistProject(ctx, { version: 2, name: 'OldShow', scenes: { scenes: [look('o', 'O')] } }, { writeAutosave: true })
	S.mergeDeckSyncIntoProject(ctx, { looks: [], sceneSnapshots: [look('o', 'O edited')] })
	S.persistProject(ctx, { version: 2, name: 'NewShow', scenes: { scenes: [look('n', 'N')] } }, { writeAutosave: true })
	S.flushDeckSyncPersist()
	assert.deepEqual(projectStore.readProjectFile('newshow').scenes.scenes.map((s) => s.name), ['N'], 'new show untouched')
})
