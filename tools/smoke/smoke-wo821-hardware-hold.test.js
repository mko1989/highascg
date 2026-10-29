'use strict'

/**
 * WO-821: a project loaded WITHOUT applying its hardware keeps its stored hardwareConfig on every save/autosave,
 * across a node restart, until the hardware is explicitly applied (load applyHardware:true, /api/project/apply-hardware)
 * or a save asks for `captureHardware: true`.
 *
 * Incident 29.10: frontex_big was loaded with applyHardware off; after a node restart a client autosave stamped this
 * box's screens and destinations over the show's (`injectHardwareConfigToProject` preserveWhenEmpty only covers an
 * EMPTY live config).
 *
 * Runs the real handlers against a private state file + projects dir (set before any require). The restart is a
 * second node process on the same files.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo821-'))
process.env.HIGHASCG_STATE_FILE = path.join(TMP, 'state.json')
process.env.HIGHASCG_PROJECTS_DIR = path.join(TMP, 'projects')
fs.mkdirSync(process.env.HIGHASCG_PROJECTS_DIR, { recursive: true })

const REPO = path.join(__dirname, '../..')
const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const { handleProject } = require('../../src/api/routes-data-project-handlers')
const hold = require('../../src/engine/project-hardware-hold')

/** The box's own rig and the show's rig: told apart by their destination id. */
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

/** Same shape in this process and in the "restarted" one. */
const CTX_SRC = `
const cfg = JSON.parse(JSON.stringify(require(${JSON.stringify(path.join(REPO, 'src/config/defaults'))})))
Object.assign(cfg, RIG)
const ctx = { config: cfg, configManager: { get: () => cfg, save: (n) => Object.assign(cfg, n) }, logs: [] }
ctx.log = (lvl, m) => ctx.logs.push(lvl + ' ' + m)
`
function boxCtx() {
	return new Function('require', 'RIG', CTX_SRC + 'return ctx')(require, rig('box_dst'))
}

const SHOW_HW = { version: 2, ...rig('show_dst'), fingerprint: { hostname: 'venue-box' } }
const SLUG = 'frontex_probe'
const LOOKS = [{ id: 'look_1', name: 'Look 1', layers: [] }]

function stored(slug = SLUG) {
	return projectStore.readProjectFile(slug)
}
function storedDest(slug = SLUG) {
	return stored(slug)?.hardwareConfig?.screenDestinations?.destinations?.[0]?.id
}
function autosaveDest(slug = SLUG) {
	return projectStore.readAutosaveFile(slug)?.hardwareConfig?.screenDestinations?.destinations?.[0]?.id
}
async function post(ctx, p, body) {
	const r = await handleProject(p, JSON.stringify(body), ctx)
	return { status: r.status, body: JSON.parse(r.body) }
}
/** A client payload as the web sends it: looks only, the current rev, no hardwareConfig. */
function clientProject(slug = SLUG, extra = {}) {
	const s = stored(slug)
	return { name: s.name, rev: s.rev, savedAt: new Date().toISOString(), scenes: LOOKS, ...extra }
}

const ctx = boxCtx()

test('setup: the show is stored with its own rig, the box runs another', () => {
	fs.writeFileSync(
		projectStore.projectFilePath(SLUG),
		JSON.stringify({ name: SLUG, slug: SLUG, rev: 1, savedAt: '2026-10-29T17:00:00.000Z', scenes: LOOKS, hardwareConfig: SHOW_HW }),
	)
	assert.equal(storedDest(), 'show_dst')
	assert.equal(ctx.config.screenDestinations.destinations[0].id, 'box_dst')
})

test('load without applyHardware holds the project; autosaves keep the stored hardwareConfig', async () => {
	const r = await post(ctx, '/api/project/load', { slug: SLUG })
	assert.equal(r.status, 200)
	assert.equal(hold.isProjectHardwareHeld(SLUG), true)
	assert.ok(ctx.logs.some((l) => l.includes('loaded without its hardware')))

	const a = await post(ctx, '/api/project/autosave', { project: clientProject() })
	assert.equal(a.status, 200, JSON.stringify(a.body))
	assert.equal(storedDest(), 'show_dst', 'the box rig must not replace the show rig')
	assert.equal(autosaveDest(), 'show_dst', '_autosave copy too')
	assert.equal(ctx.config.screenDestinations.destinations[0].id, 'box_dst', 'the box keeps its own screens')

	// A Godot-shaped payload carries a hardwareConfig of its own: the stored one still wins.
	const g = await post(ctx, '/api/project/autosave', { project: clientProject(SLUG, { hardwareConfig: rig('box_dst') }) })
	assert.equal(g.status, 200)
	assert.equal(storedDest(), 'show_dst')
	assert.deepEqual(stored().hardwareConfig.fingerprint, { hostname: 'venue-box' }, 'the whole slice is kept, not only destinations')
})

test('a bootstrap load ({}) and a plain explicit save keep the hold', async () => {
	assert.equal((await post(ctx, '/api/project/load', {})).status, 200)
	assert.equal(hold.isProjectHardwareHeld(SLUG), true, 'a page reload must not release the hold')
	const s = await post(ctx, '/api/project/save', { project: clientProject() })
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(storedDest(), 'show_dst', 'Ctrl+S saves looks, not this box rig')
	assert.equal(hold.isProjectHardwareHeld(SLUG), true)
})

test('the hold survives a node restart: an autosave from a fresh process keeps the show rig', () => {
	persistence.flushSync()
	const rev = stored().rev
	const script = `
const RIG = ${JSON.stringify(rig('box_dst'))}
${CTX_SRC}
const { handleProject } = require(${JSON.stringify(path.join(REPO, 'src/api/routes-data-project-handlers'))})
const project = { name: ${JSON.stringify(SLUG)}, rev: ${rev}, savedAt: new Date().toISOString(), scenes: ${JSON.stringify([{ ...LOOKS[0], name: 'Look 1 after restart' }])} }
handleProject('/api/project/autosave', JSON.stringify({ project }), ctx).then((r) => {
	require(${JSON.stringify(path.join(REPO, 'src/utils/persistence'))}).flushSync()
	process.stdout.write(JSON.stringify({ status: r.status, logs: ctx.logs }))
	process.exit(0)
})
`
	const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: REPO, env: process.env, encoding: 'utf8' }))
	assert.equal(out.status, 200, JSON.stringify(out))
	assert.ok(stored().rev > rev, 'the restarted process really wrote the project')
	assert.equal(stored().scenes[0].name, 'Look 1 after restart')
	assert.equal(storedDest(), 'show_dst', 'restart: the stored rig is still the show rig')
	assert.equal(autosaveDest(), 'show_dst')
	assert.ok(out.logs.some((l) => l.includes('kept the stored hardwareConfig')), out.logs.join('\n'))
})

test('a rename moves the hold with the project', async () => {
	const r = await post(ctx, '/api/project/autosave', { project: { ...clientProject(), name: `${SLUG}_v2` } })
	assert.equal(r.status, 200, JSON.stringify(r.body))
	assert.equal(storedDest(`${SLUG}_v2`), 'show_dst')
	assert.equal(hold.isProjectHardwareHeld(`${SLUG}_v2`), true)
})

test('load with applyHardware:true releases the hold; later autosaves take the live rig', async () => {
	const slug = `${SLUG}_v2`
	const r = await post(ctx, '/api/project/load', { slug, applyHardware: true })
	assert.equal(r.status, 200)
	assert.equal(hold.isProjectHardwareHeld(slug), false)
	assert.equal(ctx.config.screenDestinations.destinations[0].id, 'show_dst', 'the show rig is now live')

	// The operator rewires on this box after applying: that now belongs to the show.
	ctx.config.screenDestinations = rig('rewired_dst').screenDestinations
	ctx.config.deviceGraph = rig('rewired_dst').deviceGraph
	const a = await post(ctx, '/api/project/autosave', { project: clientProject(slug) })
	assert.equal(a.status, 200, JSON.stringify(a.body))
	assert.equal(storedDest(slug), 'rewired_dst')
})

test('apply-hardware releases the hold of the active project', async () => {
	const c = boxCtx()
	fs.writeFileSync(
		projectStore.projectFilePath('wo821_apply'),
		JSON.stringify({ name: 'wo821_apply', rev: 1, scenes: LOOKS, hardwareConfig: SHOW_HW }),
	)
	await post(c, '/api/project/load', { slug: 'wo821_apply' })
	assert.equal(hold.isProjectHardwareHeld('wo821_apply'), true)
	const r = await post(c, '/api/project/apply-hardware', { hardwareConfig: SHOW_HW })
	assert.equal(r.body.applied, true)
	assert.equal(hold.isProjectHardwareHeld('wo821_apply'), false)
})

test('save with captureHardware:true takes the live rig and releases the hold', async () => {
	const c = boxCtx()
	fs.writeFileSync(
		projectStore.projectFilePath('wo821_capture'),
		JSON.stringify({ name: 'wo821_capture', rev: 1, scenes: LOOKS, hardwareConfig: SHOW_HW }),
	)
	await post(c, '/api/project/load', { slug: 'wo821_capture' })
	const s = await post(c, '/api/project/save', { project: clientProject('wo821_capture'), captureHardware: true })
	assert.equal(s.status, 200, JSON.stringify(s.body))
	assert.equal(storedDest('wo821_capture'), 'box_dst')
	assert.equal(hold.isProjectHardwareHeld('wo821_capture'), false)
})

test('a project that is not held still gets the live rig (unchanged behaviour)', async () => {
	const c = boxCtx()
	fs.writeFileSync(
		projectStore.projectFilePath('wo821_free'),
		JSON.stringify({ name: 'wo821_free', rev: 1, scenes: LOOKS, hardwareConfig: SHOW_HW }),
	)
	projectStore.setActiveSlug(persistence, 'wo821_free')
	const a = await post(c, '/api/project/autosave', { project: clientProject('wo821_free') })
	assert.equal(a.status, 200, JSON.stringify(a.body))
	assert.equal(storedDest('wo821_free'), 'box_dst')
})

test('cleanup', () => {
	persistence.flushSync()
	fs.rmSync(TMP, { recursive: true, force: true })
})
