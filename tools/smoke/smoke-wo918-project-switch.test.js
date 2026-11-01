'use strict'

/**
 * WO-918 F27/F28/F10/F23/F9: a save/autosave under another name may only retire the open show when it is a RENAME.
 *
 * F27: an EMPTY show autosaved under another name retired the open show (an empty payload shares no looks, so the
 * stale-replace heuristic said "not stale"). F28: a client that missed a Load kept autosaving its old show and stole
 * the active slug. The Godot client now sends `editingSlug`: editing the active slug = rename, any other = refused
 * (not_active). F10: a rename onto a stored show's name is refused (name_taken). F23: Load from file of an older copy
 * may replace the stored show only on request, with a backup. F9: New project never reuses a stored Untitled.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo918-'))
process.env.HIGHASCG_STATE_FILE = path.join(TMP, 'state.json')
process.env.HIGHASCG_PROJECTS_DIR = path.join(TMP, 'projects')
fs.mkdirSync(process.env.HIGHASCG_PROJECTS_DIR, { recursive: true })

const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const { handleProject } = require('../../src/api/routes-data-project-handlers')
const { freeUntitledName } = require('../../src/engine/new-project')

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
const active = () => projectStore.getActiveSlug(persistence)

async function openShow(c, name, ids) {
	const s = await post(c, '/api/project/save', { project: show(name, ids), allowReplace: true })
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(active(), s.body.slug)
	return s.body.slug
}

test('F27: an empty show autosaved under another name (legacy client) does not retire the open show', async () => {
	const c = ctx()
	const open = await openShow(c, 'wo918_open_a', ['a1', 'a2'])
	const r = await post(c, '/api/project/autosave', { project: show('wo918_empty', []) })
	assert.equal(r.status, 200, JSON.stringify(r.body))
	assert.ok(exists(open), 'shares no looks: another show, never a rename')
	assert.equal(projectStore.wasProjectSlugRetired(open), false)
})

test('F28: a client still editing a show the server switched away from is refused — nothing forked, nothing retired', async () => {
	const c = ctx()
	const a = await openShow(c, 'wo918_show_a', ['x1', 'x2'])
	const b = await openShow(c, 'wo918_show_b', ['y1', 'y2'])
	const own = await post(c, '/api/project/autosave', { project: show('wo918_show_a', ['x1', 'x2', 'x3']), editingSlug: a })
	assert.equal(own.status, 409, 'even under its own name: the stale copy would overwrite A and steal the active slug')
	assert.equal(own.body.reason, 'not_active')
	assert.equal(projectStore.readProjectFile(a).scenes.scenes.length, 2, 'A untouched')
	const stale = await post(c, '/api/project/autosave', { project: show('wo918_show_a_renamed', ['x1', 'x2']), editingSlug: a })
	assert.equal(stale.status, 409)
	assert.equal(stale.body.reason, 'not_active')
	assert.equal(stale.body.activeSlug, b)
	assert.equal(active(), b, 'the server keeps its show')
	assert.equal(exists('wo918_show_a_renamed'), false, 'no fork')
	assert.ok(exists(a) && exists(b))
})

test('F27: with editingSlug a rename is exact — even of an empty show — and is logged', async () => {
	const c = ctx()
	const open = await openShow(c, 'wo918_rename_me', [])
	const r = await post(c, '/api/project/autosave', { project: show('wo918_renamed', []), editingSlug: open })
	assert.equal(r.status, 200, JSON.stringify(r.body))
	assert.equal(r.body.slug, 'wo918_renamed')
	assert.equal(exists(open), false, 'the old name went to the trash')
	assert.equal(projectStore.wasProjectSlugRetired(open), true)
	assert.ok(c.logs.some((l) => l.includes('renamed "wo918_rename_me"')), 'a rename is never silent')
})

test('F10: a rename onto a stored show is refused (name_taken) and changes nothing', async () => {
	const c = ctx()
	const taken = await openShow(c, 'wo918_taken', ['t1'])
	const open = await openShow(c, 'wo918_fresh', [])
	const r = await post(c, '/api/project/autosave', { project: show('wo918_taken', []), editingSlug: open })
	assert.equal(r.status, 409)
	assert.equal(r.body.reason, 'name_taken')
	assert.equal(projectStore.readProjectFile(taken).scenes.scenes.length, 1, 'the stored show is untouched')
	assert.ok(exists(open))
	assert.equal(active(), open)
	const s = await post(c, '/api/project/save', { project: show('wo918_taken', []), editingSlug: open })
	assert.equal(s.status, 409, 'Save refuses it too')
	assert.equal(s.body.reason, 'name_taken')
})

test('F23: Load from file of an older copy is refused, then Replace keeps a backup that is not a retirement record', async () => {
	const c = ctx()
	const slug = await openShow(c, 'wo918_file_show', ['f1'])
	for (let i = 0; i < 3; i++) await post(c, '/api/project/autosave', { project: { ...projectStore.readProjectFile(slug), name: 'wo918_file_show' }, editingSlug: slug })
	const stored = projectStore.readProjectFile(slug)
	assert.ok(stored.rev > 1)
	const file = { ...show('wo918_file_show', ['f1', 'f2']), rev: 1 }
	const body = { project: file, allowReplace: true, keepPayloadHardware: true }
	const refused = await post(c, '/api/project/save', body)
	assert.equal(refused.status, 409)
	assert.equal(refused.body.reason, 'stale_rev')
	const ok = await post(c, '/api/project/save', { ...body, project: { ...file }, replaceExisting: true })
	assert.equal(ok.status, 200, JSON.stringify(ok.body))
	assert.match(ok.body.replacedBackup, /^wo918_file_show-\d+-replaced$/)
	assert.equal(projectStore.readProjectFile(slug).scenes.scenes.length, 2, 'the file won')
	const bak = path.join(process.env.HIGHASCG_PROJECTS_DIR, '_trash', ok.body.replacedBackup, `${slug}.json`)
	assert.equal(JSON.parse(fs.readFileSync(bak, 'utf8')).scenes.scenes.length, 1, 'the stored version is kept')
	assert.equal(projectStore.wasProjectSlugRetired(slug), false, 'a backup is not a delete')
})

test('F9: New project takes the first free Untitled name', () => {
	assert.equal(freeUntitledName(), 'Untitled')
	fs.writeFileSync(projectStore.projectFilePath('untitled'), JSON.stringify({ name: 'Untitled', slug: 'untitled', rev: 3 }))
	assert.equal(freeUntitledName(), 'Untitled 2')
	fs.mkdirSync(path.dirname(projectStore.autosaveFilePath('untitled_2')), { recursive: true })
	fs.writeFileSync(projectStore.autosaveFilePath('untitled_2'), '{}')
	assert.equal(freeUntitledName(), 'Untitled 3', 'an autosave alone holds the name too')
})

test('F28: Godot clients follow a Load made elsewhere (project.activated), not their own (settle window)', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../godot/client/core/project_sync.gd'), 'utf8')
	assert.match(src, /Ws\.on\("change", _on_activated\)/)
	assert.match(src, /"project\.activated"/)
	assert.match(src, /func settle\(\) -> void:\n\t_own_switch_until = Time\.get_ticks_msec\(\) \+ OWN_SWITCH_MS/)
	const hdr = fs.readFileSync(path.join(__dirname, '../../godot/client/app/header_project.gd'), 'utf8')
	assert.equal(hdr.split('await ProjectSync.settle()').length - 1, 3, 'Load, New and Load from file settle first')
})

test('cleanup', () => {
	persistence.flushSync()
	fs.rmSync(TMP, { recursive: true, force: true })
})
