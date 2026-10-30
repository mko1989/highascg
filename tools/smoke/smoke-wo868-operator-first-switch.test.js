'use strict'

/**
 * WO-868 — the "Operator GUI first" plan, switch and route against a temp projects dir + temp state file (never the
 * box's). The full apply (config write + Caspar restart) is skipped here (`apply: false`); the GUI e2e scenario
 * 14_wo868_operator_first runs it against the sandbox server.
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo868-switch-'))
process.env.HIGHASCG_PROJECTS_DIR = path.join(TMP, 'projects')
process.env.HIGHASCG_STATE_FILE = path.join(TMP, 'state.json')
const HOME_BEFORE = process.env.HOME
process.env.HOME = path.join(TMP, 'home')

const og = require('../../src/config/operator-gui-first')
const persistence = require('../../src/utils/persistence')
const { planOperatorFirst } = require('../../src/system/operator-first-plan')
const { runOperatorFirstSwitch } = require('../../src/system/operator-first-switch')
const routes = require('../../src/api/routes-operator-first')

const rig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wo868', 'rig.config.json'), 'utf8'))
const PROJ = process.env.HIGHASCG_PROJECTS_DIR
const BANKS = { 1: 'b', 2: 'a', 3: 'b', 4: 'a' }
const MV = { cells: [{ source: 'route://1' }, { source: 'route://2' }, { source: 'route://6-1' }] }

const looked = {
	version: 1,
	name: 'Show',
	rev: 7,
	scenes: { scenes: [{ id: 's1', layers: [{ source: { value: 'route://1-10' } }, { source: { value: 'route://5' } }] }] },
}
const plain = { version: 1, name: 'Plain', rev: 2, scenes: { scenes: [] } }

function snapshot() {
	const out = {}
	for (const sub of ['', '_autosave']) {
		for (const n of fs.readdirSync(path.join(PROJ, sub)).filter((x) => x.endsWith('.json'))) out[path.join(sub, n)] = fs.readFileSync(path.join(PROJ, sub, n), 'utf8')
	}
	return out
}
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(PROJ, rel), 'utf8'))
const quiet = { config: null, persistence, log: () => {} }

before(() => {
	fs.mkdirSync(path.join(PROJ, '_autosave'), { recursive: true })
	fs.writeFileSync(path.join(PROJ, 'show.json'), JSON.stringify(looked, null, 2))
	fs.writeFileSync(path.join(PROJ, '_autosave', 'show.json'), JSON.stringify(looked, null, 2))
	fs.writeFileSync(path.join(PROJ, 'plain.json'), JSON.stringify(plain, null, 2))
	fs.writeFileSync(path.join(PROJ, 'broken.json'), '{ nope')
	persistence.set('programLayerBankByChannel', { ...BANKS })
	persistence.set('multiviewLayout', MV)
	persistence.flushSync()
})

after(() => {
	process.env.HOME = HOME_BEFORE
	fs.rmSync(TMP, { recursive: true, force: true })
})

test('WO-868 GET: off, no refusals, the after-table starts with the operator GUI on channel 1', () => {
	const ctx = { ...quiet, config: rig() }
	const r = routes.handleGet(ctx)
	assert.equal(r.status, 200)
	const b = JSON.parse(r.body)
	assert.equal(b.enabled, false)
	assert.deepEqual(b.refusals, [])
	assert.deepEqual(b.channels.before.find((c) => c.role === 'operator_gui'), { ch: 5, role: 'operator_gui', label: 'Operator GUI' })
	assert.deepEqual(b.channels.after[0], { ch: 1, role: 'operator_gui', label: 'Operator GUI' })
})

test('WO-868 POST dryRun (default) plans everything and writes nothing', async () => {
	const ctx = { ...quiet, config: rig() }
	const files = snapshot()
	const state = JSON.stringify(persistence.getAll())
	assert.equal((await routes.handlePost('{}', ctx)).status, 400, 'enable is required')
	const r = await routes.handlePost(JSON.stringify({ enable: true }), ctx)
	assert.equal(r.status, 200)
	const b = JSON.parse(r.body)
	assert.equal(b.dryRun, true)
	assert.deepEqual(b.remap, { 1: 2, 2: 3, 3: 4, 4: 5, 5: 1, 6: 6, 7: 7, 8: 8 })
	assert.deepEqual(b.refusals, [])
	assert.deepEqual(b.persistence.keys.sort(), ['multiviewLayout', 'programLayerBankByChannel'])
	assert.equal(b.projects.files, 4)
	assert.equal(b.projects.stamped, 3)
	assert.equal(b.projects.renumbered, 2)
	assert.equal(b.projects.references, 4)
	assert.equal(b.projects.unreadable, 1)
	const gui = (rows) => rows.find((x) => x.kind === 'operator_gui')
	const wall = (rows) => rows.find((x) => x.kind === 'screen' && x.n === 1)
	assert.equal(gui(b.layout.after).x, 0)
	assert.equal(wall(b.layout.after).x, gui(b.layout.after).width)
	assert.equal(wall(b.layout.before).x, 0)
	assert.ok(Array.isArray(b.external) && b.external.length > 0)
	assert.equal('_remap' in b, false)
	assert.deepEqual(snapshot(), files)
	assert.equal(JSON.stringify(persistence.getAll()), state)
	assert.equal(og.isOperatorGuiFirst(ctx.config), false)
})

test('WO-868 refusals: no GUI, virtual mains, config override; on-air is forceable', () => {
	const noGui = rig()
	noGui.screenDestinations.destinations = noGui.screenDestinations.destinations.filter((d) => d.mode !== 'operator_gui')
	const codes = (cfg) => planOperatorFirst({ ...quiet, config: cfg }, { enable: true, includeProjects: false }).refusals.map((r) => r.code)
	assert.deepEqual(codes(noGui), ['no_operator_gui'])
	const virt = rig()
	virt.casparServer.virtual_main_channels = [{ pgm: 1, prv: 2 }]
	assert.ok(codes(virt).includes('virtual_main_channels'))
	const ovr = rig()
	ovr.casparServer.casparConfigOverride = '<configuration/>'
	assert.deepEqual(codes(ovr), ['config_override'])
	const rep = planOperatorFirst({ ...quiet, config: { ...rig(), replication: { enabled: true } } }, { enable: true, includeProjects: false })
	assert.ok(rep.warnings.some((w) => w.code === 'hot_backup'))
	// disabling never refuses for a missing GUI
	assert.deepEqual(planOperatorFirst({ ...quiet, config: noGui }, { enable: false, includeProjects: false }).refusals, [])
})

test('WO-868 switch ON then OFF: refuses on air without force, renumbers every store, round-trips', async () => {
	const ctx = { ...quiet, config: rig() }
	const original = snapshot()
	persistence.set('liveScenesByProgramChannel', { 1: { sceneId: 's1', name: 'Show look' } })
	const refused = await runOperatorFirstSwitch(ctx, { enable: true, apply: false })
	assert.equal(refused.ok, false)
	assert.equal(refused.status, 409)
	assert.ok(refused.plan.refusals.some((r) => r.code === 'on_air' && r.forceable))
	assert.deepEqual(snapshot(), original, 'a refusal writes nothing')

	const on = await runOperatorFirstSwitch(ctx, { enable: true, apply: false, force: true })
	assert.equal(on.ok, true, on.error)
	assert.equal(og.isOperatorGuiFirst(ctx.config), true)
	assert.equal(ctx.config.casparServer.operator_gui_first, true)
	assert.ok(fs.existsSync(path.join(on.backupDir, 'projects', 'show.json')))
	assert.ok(fs.existsSync(path.join(on.backupDir, 'state.json')))
	assert.ok(on.backupDir.startsWith(path.join(TMP, 'home', '.highascg', 'backup', 'wo868-')))
	const show = readJson('show.json')
	assert.equal(show.channelScheme, og.CHANNEL_SCHEME_FIRST)
	assert.equal(show.rev, 8, 'rev bumped so a stale client gets a 409')
	assert.deepEqual(show.scenes.scenes[0].layers.map((l) => l.source.value), ['route://2-10', 'route://1'])
	assert.deepEqual(readJson('_autosave/show.json').scenes, show.scenes)
	const pl = readJson('plain.json')
	assert.equal(pl.channelScheme, og.CHANNEL_SCHEME_FIRST)
	assert.equal(pl.rev, 2, 'stamp-only files keep their rev')
	assert.deepEqual(persistence.get('programLayerBankByChannel'), { 2: 'b', 3: 'a', 4: 'b', 5: 'a' })
	assert.deepEqual(Object.keys(persistence.get('liveScenesByProgramChannel')), ['2'])
	assert.deepEqual(persistence.get('multiviewLayout').cells.map((c) => c.source), ['route://2', 'route://3', 'route://6-1'])

	const noop = await runOperatorFirstSwitch(ctx, { enable: true, apply: false })
	assert.equal(noop.noop, true)

	persistence.set('liveScenesByProgramChannel', {})
	const off = await runOperatorFirstSwitch(ctx, { enable: false, apply: false })
	assert.equal(off.ok, true, off.error)
	assert.equal('operator_gui_first' in ctx.config.casparServer, false, 'off removes the key')
	const back = snapshot()
	for (const [f, text] of Object.entries(original)) {
		const strip = (t) => {
			try {
				const j = JSON.parse(t)
				delete j.rev
				return JSON.stringify(j)
			} catch {
				return t
			}
		}
		assert.equal(strip(back[f]), strip(text), `${f} round-trips (rev aside)`)
	}
	assert.equal(readJson('show.json').rev, 9)
	assert.equal('channelScheme' in readJson('plain.json'), false)
	assert.deepEqual(persistence.get('programLayerBankByChannel'), BANKS)
	assert.deepEqual(persistence.get('multiviewLayout'), MV)
})
