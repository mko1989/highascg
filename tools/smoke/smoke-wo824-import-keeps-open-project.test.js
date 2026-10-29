'use strict'

/**
 * WO-824: bringing another show in must not retire (trash) the project that was open.
 *
 * A save/autosave under a new name used to retire the previously active slug unconditionally (it was treated as a
 * rename). Godot "Load from file" saves the file under its own name, and the web import autosaves it under its own
 * name, so opening a show file moved the open show to the trash. Now: an import (keepPayloadHardware) never retires,
 * and a save/autosave only retires when the payload's looks overlap the previous project's (a real rename).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo824-'))
process.env.HIGHASCG_STATE_FILE = path.join(TMP, 'state.json')
process.env.HIGHASCG_PROJECTS_DIR = path.join(TMP, 'projects')
fs.mkdirSync(process.env.HIGHASCG_PROJECTS_DIR, { recursive: true })

const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const { handleProject } = require('../../src/api/routes-data-project-handlers')
const hold = require('../../src/engine/project-hardware-hold')

function ctx() {
	const cfg = JSON.parse(JSON.stringify(require('../../src/config/defaults')))
	const c = { config: cfg, configManager: { get: () => cfg, save: (n) => Object.assign(cfg, n) }, logs: [] }
	c.log = (lvl, m) => c.logs.push(lvl + ' ' + m)
	return c
}
async function post(c, p, body) {
	const r = await handleProject(p, JSON.stringify(body), c)
	return { status: r.status, body: JSON.parse(r.body) }
}
const looks = (...ids) => ids.map((id) => ({ id, name: id, layers: [] }))
const show = (name, ids, extra = {}) => ({ name, savedAt: new Date().toISOString(), scenes: { scenes: looks(...ids) }, ...extra })
const exists = (slug) => !!projectStore.readProjectFile(slug)

async function openShow(c, name, ids) {
	const s = await post(c, '/api/project/save', { project: show(name, ids), allowReplace: true })
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(projectStore.getActiveSlug(persistence), s.body.slug)
	return s.body.slug
}

test('Godot Load from file (keepPayloadHardware) keeps the open show in the list', async () => {
	const c = ctx()
	const open = await openShow(c, 'wo824_open_a', ['a1', 'a2', 'a3'])
	const r = await post(c, '/api/project/save', {
		project: show('wo824_file_a', ['a1', 'a2', 'a3']), // even a copy of the same show: an import never retires
		allowReplace: true,
		keepPayloadHardware: true,
	})
	assert.equal(r.status, 200, JSON.stringify(r.body))
	assert.ok(exists(open), 'the previously open show is still there')
	assert.ok(exists('wo824_file_a'))
	assert.equal(projectStore.wasProjectSlugRetired(open), false)
})

test('web import: an autosave of a different show under its own name keeps the open show', async () => {
	const c = ctx()
	const open = await openShow(c, 'wo824_open_b', ['b1', 'b2', 'b3'])
	assert.equal(c.sceneDeck?.sceneSnapshots?.length, 3, 'the live deck still holds the open show (deck sync not in yet)')
	const r = await post(c, '/api/project/autosave', { project: show('wo824_file_b', ['x1', 'x2', 'x3']) })
	assert.equal(r.status, 200, JSON.stringify(r.body))
	assert.ok(exists(open), 'no looks in common: another show, not a rename')
	assert.equal(projectStore.wasProjectSlugRetired(open), false)
	assert.ok(c.logs.some((l) => l.includes('not a rename')))
})

test('a real rename (same looks, new name) still retires the old slug — save and autosave', async () => {
	const c = ctx()
	const old1 = await openShow(c, 'wo824_rename_1', ['r1', 'r2', 'r3'])
	await post(c, '/api/project/save', { project: show('wo824_renamed_1', ['r1', 'r2', 'r3']) })
	assert.equal(exists(old1), false, 'save rename retires the old name')
	assert.equal(projectStore.wasProjectSlugRetired(old1), true)

	const old2 = await openShow(c, 'wo824_rename_2', ['s1', 's2', 's3'])
	await post(c, '/api/project/autosave', { project: show('wo824_renamed_2', ['s1', 's2', 's3', 's4']) })
	assert.equal(exists(old2), false, 'autosave rename retires the old name')
})

test('an import keeps the open show held under WO-821 (the hold stays with the project that still exists)', async () => {
	const c = ctx()
	const open = await openShow(c, 'wo824_held', ['h1'])
	hold.holdProjectHardware(open, 'load')
	await post(c, '/api/project/save', { project: show('wo824_file_h', ['z1']), allowReplace: true, keepPayloadHardware: true })
	assert.ok(exists(open))
	assert.equal(hold.isProjectHardwareHeld(open), true)
})

test('another show autosaved under its own name does not inherit the held open show rig (WO-821 hold stays put)', async () => {
	const c = ctx()
	const open = 'wo824_held_rig'
	const heldHw = { version: 2, screenDestinations: { version: 1, destinations: [{ id: 'held_dst', label: 'held', mode: 'pgm_only' }] } }
	fs.writeFileSync(
		projectStore.projectFilePath(open),
		JSON.stringify({ name: open, slug: open, rev: 1, savedAt: '2026-10-01T09:00:00.000Z', scenes: { scenes: looks('q1', 'q2', 'q3') }, hardwareConfig: heldHw }),
	)
	await post(c, '/api/project/load', { slug: open }) // loaded without its hardware → held
	assert.equal(hold.isProjectHardwareHeld(open), true)
	const r = await post(c, '/api/project/autosave', { project: show('wo824_other_rig', ['w1', 'w2', 'w3']) })
	assert.equal(r.status, 200, JSON.stringify(r.body))
	const other = projectStore.readProjectFile('wo824_other_rig')
	assert.notEqual(other?.hardwareConfig?.screenDestinations?.destinations?.[0]?.id, 'held_dst', 'not a rename: the hold does not move')
	assert.equal(hold.isProjectHardwareHeld('wo824_other_rig'), false)
	assert.ok(exists(open))
	assert.equal(hold.isProjectHardwareHeld(open), true)

	// a real rename of the held project still carries the hold and its stored rig (WO-821)
	await post(c, '/api/project/load', { slug: open })
	const n = await post(c, '/api/project/autosave', { project: show('wo824_held_renamed', ['q1', 'q2', 'q3']) })
	assert.equal(n.status, 200, JSON.stringify(n.body))
	assert.equal(projectStore.readProjectFile('wo824_held_renamed')?.hardwareConfig?.screenDestinations?.destinations?.[0]?.id, 'held_dst')
	assert.equal(hold.isProjectHardwareHeld('wo824_held_renamed'), true)
	assert.equal(exists(open), false)
})

test('cleanup', () => {
	persistence.flushSync()
	fs.rmSync(TMP, { recursive: true, force: true })
})
