'use strict'

/**
 * WO-842 — sweep 29.10 data-loss findings: rename onto an existing slug (4g), deleting the last look (4h),
 * unparsable general.json (4i), atomic-write temp name (4j), custom-size multiview mode (4l).
 * Everything runs in temp dirs; the live projects/ and config/ are never touched.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo842-'))
process.env.HIGHASCG_STATE_FILE = path.join(TMP, 'state.json')
process.env.HIGHASCG_PROJECTS_DIR = path.join(TMP, 'projects')
fs.mkdirSync(process.env.HIGHASCG_PROJECTS_DIR, { recursive: true })

const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const S = require('../../src/engine/project-scenes')
const { handleProject } = require('../../src/api/routes-data-project-handlers')

function ctx() {
	const cfg = JSON.parse(JSON.stringify(require('../../src/config/defaults')))
	const c = { config: cfg, configManager: { get: () => cfg, save: (n) => Object.assign(cfg, n) }, logs: [], persistence }
	c.log = (lvl, m) => c.logs.push(lvl + ' ' + m)
	return c
}
async function post(c, p, body) {
	const r = await handleProject(p, JSON.stringify(body), c)
	return { status: r.status, body: JSON.parse(r.body) }
}
const look = (id, name = id) => ({ id, name, mainScope: '0', layers: [] })
const show = (name, ids) => ({ name, savedAt: new Date().toISOString(), scenes: { scenes: ids.map((i) => look(i)) } })

test('4g rename onto an existing project is refused (409) and neither project changes', async () => {
	const c = ctx()
	assert.equal((await post(c, '/api/project/save', { project: show('Alpha', ['a1']), allowReplace: true })).status, 200)
	assert.equal((await post(c, '/api/project/save', { project: show('Beta', ['b1', 'b2']), allowReplace: true })).status, 200)
	const betaBefore = JSON.stringify(projectStore.readProjectFile('beta'))
	const r = await post(c, '/api/project/rename', { fromSlug: 'alpha', name: 'Beta' })
	assert.equal(r.status, 409, JSON.stringify(r.body))
	assert.equal(JSON.stringify(projectStore.readProjectFile('beta')), betaBefore, 'Beta untouched')
	assert.equal(projectStore.readProjectFile('alpha').name, 'Alpha', 'Alpha still there under its own name')
	// a free name still renames
	const ok = await post(c, '/api/project/rename', { fromSlug: 'alpha', name: 'Gamma' })
	assert.equal(ok.status, 200, JSON.stringify(ok.body))
	assert.ok(projectStore.readProjectFile('gamma'))
})

test('4h deleting the last look persists when the client marks the empty deck deliberate; a bare empty deck is refused whole', () => {
	const c = ctx()
	S.persistProject(c, { version: 2, name: 'LastLook', scenes: { scenes: [look('only')] } }, { writeAutosave: true })
	// stale / blank tab: lists no looks, no allowEmpty → anti-wipe guard (WO-311/329) keeps the show, live deck untouched
	const refused = S.mergeDeckSyncIntoProject(c, { looks: [], sceneSnapshots: [] })
	assert.equal(refused, null)
	assert.equal(projectStore.readProjectFile('lastlook').scenes.scenes.length, 1)
	assert.ok(c.logs.some((l) => /scene_deck_sync ignored \(empty_over_nonempty\)/.test(l)))
	// deliberate delete
	const merged = S.mergeDeckSyncIntoProject(c, { looks: [], sceneSnapshots: [], allowEmpty: true })
	assert.ok(merged)
	S.flushDeckSyncPersist()
	assert.deepEqual(projectStore.readProjectFile('lastlook').scenes.scenes, [], 'the file no longer has the look')
})

test('4i an unparsable general.json is quarantined, never overwritten from defaults', () => {
	const { ConfigManager } = require('../../src/config/config-manager')
	const dir = path.join(TMP, 'cfg')
	fs.mkdirSync(dir, { recursive: true })
	const torn = '{"screen_count": 2, "keep_me": "yes", '
	fs.writeFileSync(path.join(dir, 'general.json'), torn)
	const errors = []
	const cm = new ConfigManager(dir, { info() {}, warn() {}, error: (m) => errors.push(String(m)), debug() {} })
	cm.load()
	cm.save({ ...cm.get(), screen_count: 3 }, { emitChange: false }) // the next save used to rewrite general.json from defaults
	const files = fs.readdirSync(dir)
	const q = files.filter((f) => f.startsWith('general.json.corrupt-'))
	assert.equal(q.length, 1, `quarantine file present: ${files.join(',')}`)
	assert.equal(fs.readFileSync(path.join(dir, q[0]), 'utf8'), torn, 'original bytes preserved')
	assert.ok(errors.some((m) => /Quarantined unparsable config/.test(m)), 'logged loudly')
})

test('4j concurrent atomic writes to one target both succeed and leave a whole file, no tmp residue', async () => {
	const { atomicWriteFile, atomicWriteFileSync, uniqueTmpPath } = require('../../src/utils/atomic-file-write')
	const dir = fs.mkdtempSync(path.join(TMP, 'atomic-'))
	const f = path.join(dir, 'casparcg.config')
	const A = 'A'.repeat(2_000_000)
	const B = 'B'.repeat(2_000_000)
	const res = await Promise.allSettled([atomicWriteFile(f, A), atomicWriteFile(f, B), atomicWriteFile(f, A), atomicWriteFile(f, B)])
	assert.deepEqual(res.map((r) => r.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
	const got = fs.readFileSync(f, 'utf8')
	assert.ok(got === A || got === B, 'whole content of one writer, not interleaved')
	assert.deepEqual(fs.readdirSync(dir), ['casparcg.config'])
	assert.notEqual(uniqueTmpPath(f), uniqueTmpPath(f))
	atomicWriteFileSync(f, 'sync')
	assert.equal(fs.readFileSync(f, 'utf8'), 'sync')
	assert.deepEqual(fs.readdirSync(dir), ['casparcg.config'])
})

test('4l a custom-size multiview gets a registered <video-mode>, not the literal "custom"', () => {
	const defaults = require('../../src/config/defaults')
	const { buildConfigXml } = require('../../src/config/config-generator')
	const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
	const app = JSON.parse(JSON.stringify(defaults))
	app.screen_count = 1
	app.casparServer = { ...app.casparServer, screen_count: 1, screen_1_mode: '1080p5000', multiview_enabled: true }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'mv', label: 'MV', mode: 'multiview', videoMode: 'custom', width: 1728, height: 960, fps: 50 },
			{ id: 'main1', label: 'PGM', mode: 'pgm_prv', mainScreenIndex: 0, videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'dst_in_main1', kind: 'destination_in', externalRef: 'main1' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{ id: 'gpu_p1', kind: 'gpu_out' },
		],
		edges: [
			{ sourceId: 'dst_in_mv', sinkId: 'gpu_p0' },
			{ sourceId: 'dst_in_main1', sinkId: 'gpu_p1' },
		],
	}
	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(app))
	assert.doesNotMatch(xml, /<video-mode>custom<\/video-mode>/)
	const mv = xml.match(/Multiview output #1[\s\S]*?<video-mode>([^<]+)<\/video-mode>/)
	assert.equal(mv[1], '1728x960')
	assert.match(xml, /<video-modes>[\s\S]*<id>1728x960<\/id>[\s\S]*<width>1728<\/width>[\s\S]*<height>960<\/height>/)
	const win = xml.match(/Multiview output #1[\s\S]*?<screen>[\s\S]*?<width>(\d+)<\/width><height>(\d+)<\/height>/)
	assert.deepEqual([win[1], win[2]], ['1728', '960'])
})

test('4l multiviewModeDimensions: aliases and standard-equivalent custom sizes resolve to standard ids', () => {
	const { multiviewModeDimensions: d } = require('../../src/config/config-generator-multiview-mode')
	assert.equal(d({ multiview_mode: '1080p50' }, 1).modeId, '1080p5000')
	assert.equal(d({ multiview_mode: 'custom', multiview_custom_width: 1920, multiview_custom_height: 1080, multiview_custom_fps: 50 }, 1).isCustom, false)
	const per = d({ multiview_mode: '1080p5000', multiview_2_mode: 'custom', multiview_2_custom_width: 1000, multiview_2_custom_height: 500, multiview_2_custom_fps: 25 }, 2)
	assert.deepEqual([per.modeId, per.width, per.height, per.fps, per.isCustom], ['1000x500', 1000, 500, 25, true])
})
