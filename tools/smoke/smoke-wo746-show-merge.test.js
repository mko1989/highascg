'use strict'

/**
 * WO-746 — the shared show as data (src/cluster/show-merge.js): what is shared (G9: device-local slices and stream
 * keys never travel), item-level deltas, and the 3-way merge that lets two operators edit one show (G7).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const M = require('../../src/cluster/show-merge')
const { sampleProject } = require('../e2e/shared-show-harness')

const show = (box = 'a') => M.showOf(sampleProject('Show', undefined, box))
const looks = (s) => s.scenes.scenes

test('G9: the show has no device-local slice, no stream key, no stamps; two boxes share one hash', () => {
	const s = show('a')
	assert.equal(s.hardwareConfig.deviceGraph, undefined)
	assert.equal(s.hardwareConfig.casparServer, undefined)
	assert.deepEqual(s.hardwareConfig.screenDestinations, [{ id: 'dst_pgm1', label: 'PGM/PRV 1' }], 'destinations ARE show data')
	for (const k of ['streaming', 'rev', 'savedAt', 'slug']) assert.equal(s[k], undefined, k)
	assert.equal(M.hashShow(show('a')), M.hashShow(show('b')), 'cables, Caspar and stream keys differ, the show does not')
	const p = sampleProject('Show', undefined, 'a')
	p.rev = 99
	p.savedAt = 'later'
	assert.equal(M.hashShow(M.showOf(p)), M.hashShow(show('a')), 'a re-save is not a change')
})

test('intoProject: the shared show lands in this box\'s project with its own cables, Caspar, stream key and rev', () => {
	const mineP = sampleProject('Mine', ['x'], 'b')
	mineP.rev = 7
	const s = show('a')
	looks(s)[0].name = 'from a'
	const out = M.intoProject(mineP, s)
	assert.equal(out.scenes.scenes[0].name, 'from a')
	assert.equal(out.hardwareConfig.deviceGraph.box, 'b')
	assert.equal(out.hardwareConfig.casparServer.box, 'b')
	assert.equal(out.streaming.credentials.streamingChannel.streamKey, 'key-of-b')
	assert.equal(out.rev, 7)
	assert.equal(M.hashShow(M.showOf(out)), M.hashShow(s), 'and its show is exactly the shared one')
})

test('diff / apply: one look renamed is one small op, and applying gives the same hash', () => {
	const a = show()
	const b = structuredClone(a)
	looks(b)[1].name = 'renamed'
	const ops = M.diff(a, b)
	assert.deepEqual(ops, [{ p: ['scenes', 'scenes', { id: 'look_2' }, 'name'], v: 'renamed' }])
	assert.equal(M.hashShow(M.apply(a, ops).doc), M.hashShow(b))
	assert.equal(M.pathText(ops[0].p), 'scenes.scenes[look_2].name')
})

test('diff / apply: adds, deletes, reorders and key removal round-trip', () => {
	const a = show()
	const b = structuredClone(a)
	looks(b).splice(0, 1)
	looks(b).unshift({ id: 'look_new', name: 'New', layers: [] })
	looks(b).reverse()
	delete b.multiview.showOverlay
	b.timelines.activeId = null
	const ops = M.diff(a, b)
	assert.ok(ops.some((o) => o.o), 'an order op')
	assert.deepEqual(M.apply(a, ops).doc, b)
	assert.deepEqual(M.diff(a, a), [])
})

test('merge3: two operators on two different looks — both edits stay, no conflict', () => {
	const base = show()
	const ours = structuredClone(base)
	looks(ours)[0].name = 'master edit'
	const theirs = structuredClone(base)
	looks(theirs)[2].layers[0].clip = 'their clip'
	const { merged, conflicts } = M.merge3(base, ours, theirs)
	assert.deepEqual(conflicts, [])
	assert.equal(looks(merged)[0].name, 'master edit')
	assert.equal(looks(merged)[2].layers[0].clip, 'their clip')
})

test('merge3: both add a look — both kept; both rename the same look — the master wins, the path is reported', () => {
	const base = show()
	const ours = structuredClone(base)
	looks(ours).push({ id: 'look_m', name: 'M', layers: [] })
	looks(ours)[1].name = 'M name'
	const theirs = structuredClone(base)
	looks(theirs).push({ id: 'look_t', name: 'T', layers: [] })
	looks(theirs)[1].name = 'T name'
	const { merged, conflicts } = M.merge3(base, ours, theirs)
	assert.deepEqual(looks(merged).map((l) => l.id), ['look_1', 'look_2', 'look_3', 'look_m', 'look_t'])
	assert.equal(looks(merged)[1].name, 'M name')
	assert.deepEqual(conflicts, ['scenes.scenes[look_2].name'])
})

test('merge3: one deletes a look the other edited — the master\'s side stays, reported', () => {
	const base = show()
	const ours = structuredClone(base)
	looks(ours).splice(0, 1) // the master deleted look_1
	const theirs = structuredClone(base)
	looks(theirs)[0].name = 'edited'
	const r1 = M.merge3(base, ours, theirs)
	assert.equal(looks(r1.merged).some((l) => l.id === 'look_1'), false)
	assert.deepEqual(r1.conflicts, ['scenes.scenes[look_1].name'])
	const r2 = M.merge3(base, theirs, ours) // the other way round: the master edited, the proposal deletes
	assert.equal(looks(r2.merged)[0].name, 'edited')
	assert.deepEqual(r2.conflicts, ['scenes.scenes[look_1]'])
})

test('merge3: the same change on both sides is not a conflict; a proposal on an unchanged master is taken whole', () => {
	const base = show()
	const ours = structuredClone(base)
	looks(ours)[0].name = 'same'
	const theirs = structuredClone(ours)
	assert.deepEqual(M.merge3(base, ours, theirs).conflicts, [])
	const t2 = structuredClone(base)
	looks(t2).reverse()
	t2.multiview.cells = [{ id: 'c1' }]
	const r = M.merge3(base, base, t2)
	assert.deepEqual(r.conflicts, [])
	assert.deepEqual(r.merged, t2)
})

test('merge3: one reorders, the other adds — order taken, the add kept at the end', () => {
	const base = show()
	const ours = structuredClone(base)
	looks(ours).push({ id: 'look_m', name: 'M', layers: [] })
	const theirs = structuredClone(base)
	looks(theirs).reverse()
	const { merged, conflicts } = M.merge3(base, ours, theirs)
	assert.deepEqual(conflicts, [])
	assert.deepEqual(looks(merged).map((l) => l.id), ['look_3', 'look_2', 'look_1', 'look_m'])
})
