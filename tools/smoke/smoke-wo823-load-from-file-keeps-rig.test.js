'use strict'

/**
 * WO-823: Godot "Load from file" must restore the FILE's hardwareConfig.
 *
 * The flow is `POST /api/project/save {project}` (stores the file under its name) then `POST /api/project/load
 * {slug, applyHardware:true}`. The save used to stamp this box's live rig over the file's, so the apply that followed
 * applied the box's own rig and a show file's screens were never restored. `keepPayloadHardware: true` on the save
 * writes the payload's hardwareConfig as given. WO-821's hold, WO-311's empty-config guard and WO-614 stay intact.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo823-'))
process.env.HIGHASCG_STATE_FILE = path.join(TMP, 'state.json')
process.env.HIGHASCG_PROJECTS_DIR = path.join(TMP, 'projects')
fs.mkdirSync(process.env.HIGHASCG_PROJECTS_DIR, { recursive: true })

const REPO = path.join(__dirname, '../..')
const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const { handleProject } = require('../../src/api/routes-data-project-handlers')
const hold = require('../../src/engine/project-hardware-hold')

function rig(id) {
	return {
		deviceGraph: {
			version: 1,
			devices: [],
			connectors: [
				{ id: `dst_in_${id}`, kind: 'destination_in', externalRef: id },
				{ id: 'gpu_p0', kind: 'gpu_out' },
			],
			edges: [{ id: `e_${id}`, sourceId: `dst_in_${id}`, sinkId: 'gpu_p0' }],
		},
		screenDestinations: {
			version: 1,
			destinations: [{ id, label: id, mode: 'pgm_only', mainScreenIndex: 0, width: 1920, height: 1080, fps: 50 }],
			edidNotes: '',
		},
	}
}

function boxCtx(id = 'box_dst') {
	const cfg = JSON.parse(JSON.stringify(require('../../src/config/defaults')))
	Object.assign(cfg, id ? rig(id) : {})
	const ctx = { config: cfg, configManager: { get: () => cfg, save: (n) => Object.assign(cfg, n) }, logs: [] }
	ctx.log = (lvl, m) => ctx.logs.push(lvl + ' ' + m)
	return ctx
}

const FILE_HW = { version: 2, ...rig('file_dst'), fingerprint: { hostname: 'venue-box' } }
const LOOKS = [{ id: 'look_1', name: 'Look 1', layers: [] }]
const live = (c) => c.config.screenDestinations?.destinations?.[0]?.id
const storedDest = (slug) => projectStore.readProjectFile(slug)?.hardwareConfig?.screenDestinations?.destinations?.[0]?.id
const autoDest = (slug) => projectStore.readAutosaveFile(slug)?.hardwareConfig?.screenDestinations?.destinations?.[0]?.id

async function post(ctx, p, body) {
	const r = await handleProject(p, JSON.stringify(body), ctx)
	return { status: r.status, body: JSON.parse(r.body) }
}
/** A project file as Godot reads it from disk. */
const file = (name, extra = {}) => ({
	name,
	rev: 7,
	savedAt: '2026-10-01T10:00:00.000Z',
	scenes: LOOKS,
	hardwareConfig: FILE_HW,
	...extra,
})
const fromFile = (c, project) => post(c, '/api/project/save', { project, allowReplace: true, keepPayloadHardware: true })

test('the old Godot flow (no flag) loses the file rig: documents the bug', async () => {
	const c = boxCtx()
	const s = await post(c, '/api/project/save', { project: file('wo823_old'), allowReplace: true })
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(storedDest('wo823_old'), 'box_dst', 'without the flag the save stamps this box rig')
	await post(c, '/api/project/load', { slug: 'wo823_old', applyHardware: true })
	assert.equal(live(c), 'box_dst', 'so the apply re-applies the box rig')
})

test('load from file: stored project and live config both end up with the file rig', async () => {
	const c = boxCtx()
	projectStore.setActiveSlug(persistence, 'some_other_show')
	const s = await fromFile(c, file('wo823_show'))
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(s.body.slug, 'wo823_show')
	assert.equal(storedDest('wo823_show'), 'file_dst', 'stored project keeps the file rig')
	assert.equal(autoDest('wo823_show'), 'file_dst', '_autosave copy too')
	assert.deepEqual(projectStore.readProjectFile('wo823_show').hardwareConfig.fingerprint, { hostname: 'venue-box' })
	assert.equal(live(c), 'box_dst', 'saving alone does not touch the live config')

	const l = await post(c, '/api/project/load', { slug: 'wo823_show', applyHardware: true })
	assert.equal(l.status, 200)
	assert.equal(live(c), 'file_dst', 'the file rig is live after the apply')
	assert.equal(hold.isProjectHardwareHeld('wo823_show'), false)

	// from here on it is an ordinary applied project: a rewire on this box belongs to the show
	c.config.screenDestinations = rig('rewired_dst').screenDestinations
	c.config.deviceGraph = rig('rewired_dst').deviceGraph
	const a = await post(c, '/api/project/autosave', {
		project: { name: 'wo823_show', rev: projectStore.readProjectFile('wo823_show').rev, savedAt: new Date().toISOString(), scenes: LOOKS },
	})
	assert.equal(a.status, 200, JSON.stringify(a.body))
	assert.equal(storedDest('wo823_show'), 'rewired_dst')
})

test('importing over a held project of the same name writes the file rig; the hold ends at the apply', async () => {
	const c = boxCtx()
	const slug = 'wo823_held'
	fs.writeFileSync(
		projectStore.projectFilePath(slug),
		JSON.stringify({ name: slug, slug, rev: 1, savedAt: '2026-10-01T09:00:00.000Z', scenes: LOOKS, hardwareConfig: { version: 2, ...rig('old_dst') } }),
	)
	await post(c, '/api/project/load', { slug })
	assert.equal(hold.isProjectHardwareHeld(slug), true)

	const s = await fromFile(c, file(slug))
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(storedDest(slug), 'file_dst', 'the hold does not swap the file rig for the old stored one')
	assert.equal(hold.isProjectHardwareHeld(slug), true, 'the save does not end the hold: only the apply does')

	// an autosave between the save and the load must not stamp the box rig
	const a = await post(c, '/api/project/autosave', {
		project: { name: slug, rev: projectStore.readProjectFile(slug).rev, savedAt: new Date().toISOString(), scenes: LOOKS },
	})
	assert.equal(a.status, 200, JSON.stringify(a.body))
	assert.equal(storedDest(slug), 'file_dst')

	await post(c, '/api/project/load', { slug, applyHardware: true })
	assert.equal(live(c), 'file_dst')
	assert.equal(hold.isProjectHardwareHeld(slug), false)
})

test('WO-311: an empty live config does not matter, the file rig is stored', async () => {
	const c = boxCtx(null)
	assert.equal(live(c), undefined)
	const s = await fromFile(c, file('wo823_factory'))
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(storedDest('wo823_factory'), 'file_dst')
	await post(c, '/api/project/load', { slug: 'wo823_factory', applyHardware: true })
	assert.equal(live(c), 'file_dst')
})

test('a file without hardwareConfig stores none and leaves the box rig alone', async () => {
	const c = boxCtx()
	const p = file('wo823_nohw')
	delete p.hardwareConfig
	const s = await fromFile(c, p)
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(projectStore.readProjectFile('wo823_nohw').hardwareConfig, undefined, 'nothing is invented from this box')
	await post(c, '/api/project/load', { slug: 'wo823_nohw', applyHardware: true })
	assert.equal(live(c), 'box_dst')
})

test('only an explicit save honours the flag: autosave ignores it, capture beats it, a plain save still stamps', async () => {
	const c = boxCtx()
	const slug = 'wo823_guard'
	fs.writeFileSync(
		projectStore.projectFilePath(slug),
		JSON.stringify({ name: slug, slug, rev: 1, savedAt: '2026-10-01T09:00:00.000Z', scenes: LOOKS, hardwareConfig: FILE_HW }),
	)
	await post(c, '/api/project/load', { slug }) // held
	const body = { name: slug, rev: 1, savedAt: new Date().toISOString(), scenes: LOOKS, hardwareConfig: rig('payload_dst') }
	const a = await post(c, '/api/project/autosave', { project: body, keepPayloadHardware: true })
	assert.equal(a.status, 200, JSON.stringify(a.body))
	assert.equal(storedDest(slug), 'file_dst', 'autosave never takes the payload rig')

	const k = await post(c, '/api/project/save', {
		project: { ...body, rev: projectStore.readProjectFile(slug).rev },
		captureHardware: true,
		keepPayloadHardware: true,
	})
	assert.equal(k.status, 200, JSON.stringify(k.body))
	assert.equal(storedDest(slug), 'box_dst', 'captureHardware wins')

	const p = await post(c, '/api/project/save', { project: { ...body, rev: projectStore.readProjectFile(slug).rev } })
	assert.equal(p.status, 200, JSON.stringify(p.body))
	assert.equal(storedDest(slug), 'box_dst', 'a plain save without the flag still stamps the live rig')
})

test('Godot sends the flag on Load from file only', () => {
	const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
	const model = read('godot/client/app/header_model.gd')
	assert.match(model, /"keepPayloadHardware": true/)
	const proj = read('godot/client/app/header_project.gd')
	assert.match(proj, /post_json\("\/api\/project\/save", HeaderModel\.file_import_body\(parsed\.project\)\)/)
	assert.equal(proj.split('keepPayloadHardware').length - 1, 0, 'the flag lives in the model, not at call sites')
	assert.doesNotMatch(read('godot/client/core/project_sync.gd'), /keepPayloadHardware/, 'normal saves never send it')
})

test('cleanup', () => {
	persistence.flushSync()
	fs.rmSync(TMP, { recursive: true, force: true })
})
