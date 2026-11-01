'use strict'

/**
 * WO-919 — F11 (New project takes the old show off PGM / PRV and forgets what was live), N4 (a projects sync pair never
 * carries _trash; a `-replaced` backup is not a retirement), N5 (a rename moves / drops the project media folder),
 * N1 + F11 client halves (source text pins, the Godot suite has the behaviour tests).
 * Everything runs in temp dirs: the state file, the projects dir and the media root.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo919-'))
process.env.HIGHASCG_STATE_FILE = path.join(TMP, 'state.json')
process.env.HIGHASCG_PROJECTS_DIR = path.join(TMP, 'projects')
fs.mkdirSync(process.env.HIGHASCG_PROJECTS_DIR, { recursive: true })

const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const liveSceneState = require('../../src/state/live-scene-state')
const audioOnly = require('../../src/state/live-audio-only-look-state')
const { createNewProject } = require('../../src/engine/new-project')
const { showAirChannels } = require('../../src/engine/new-project-air')
const { getChannelMap } = require('../../src/config/routing')
const { validateMap, isExcluded } = require('../../src/system/exfat-sync-map')
const { moveProjectMediaOnRename } = require('../../src/media/project-media-rename')
const { retireRenamedSlug } = require('../../src/api/routes-data-project-slug')
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

function ctxWithAmcp(mediaRoot, calls) {
	const cfg = JSON.parse(JSON.stringify(require('../../src/config/defaults')))
	cfg.local_media_path = mediaRoot
	cfg.casparServer = { ...(cfg.casparServer || {}), screen_count: 2 }
	cfg.screen_count = 2
	const rec = (name) => async (...a) => void calls.push([name, ...a])
	return {
		config: cfg,
		configManager: { get: () => cfg, save: (n) => Object.assign(cfg, n) },
		persistence,
		logs: [],
		log(l, m) {
			this.logs.push(l + ' ' + m)
		},
		amcp: { clear: rec('clear'), mixerCommit: rec('commit'), raw: rec('raw'), batchSendChunked: rec('batch') },
		sceneDeck: { looks: [{ id: 'old' }] },
	}
}

test('F11: New project clears the old show off PGM / PRV and forgets what was live; operator GUI + inputs untouched', async () => {
	const media = fs.mkdtempSync(path.join(TMP, 'media-'))
	const calls = []
	const ctx = ctxWithAmcp(media, calls)
	const map = getChannelMap(ctx.config)
	const want = showAirChannels(ctx.config)
	assert.ok(want.length >= 2, 'two screens: at least two PGM channels')
	for (const ch of [...map.programChannels, ...map.previewChannels.filter(Boolean)]) assert.ok(want.includes(Number(ch)))
	for (const ch of map.operatorGuiChannels || []) assert.ok(!want.includes(Number(ch)), 'operator GUI channel is hardware')
	await liveSceneState.setChannel(want[0], { sceneId: 'old', scene: { layers: [] } })
	await audioOnly.setChannel(want[0], { sceneId: 'oldA', scene: {} })
	const sent = []
	ctx._wsBroadcast = (t, p) => sent.push(p.path)

	const { slug, air } = createNewProject(ctx)
	assert.ok(slug)
	const res = await air
	assert.deepEqual(res.channels, want)
	assert.deepEqual(calls.filter((c) => c[0] === 'clear').map((c) => c[1]).sort(), [...want].sort(), 'CLEAR once per PGM / PRV channel')
	const cleared = new Set(calls.filter((c) => c[0] === 'clear').map((c) => c[1]))
	for (const ch of [...(map.operatorGuiChannels || []), ...(map.inputChannels || [])]) assert.ok(!cleared.has(Number(ch)), `ch ${ch} not cleared`)
	assert.deepEqual(liveSceneState.getAll(), {}, 'no live look survives')
	assert.deepEqual(audioOnly.getAll(), {}, 'no live audio-only look survives')
	assert.ok(sent.includes('scene.live'), 'clients are told')
})

test('F11: the route answers, tells clients `show.cleared`, and survives a Caspar that is not connected', async () => {
	const { handleProjectNew } = require('../../src/api/routes-data-project-new')
	const media = fs.mkdtempSync(path.join(TMP, 'media-'))
	const ctx = ctxWithAmcp(media, [])
	delete ctx.amcp
	const sent = []
	ctx._wsBroadcast = (t, p) => sent.push([p.path, p.value])
	const r = await handleProjectNew(ctx)
	assert.equal(r.status, 200, r.body)
	const ev = sent.find(([p]) => p === 'show.cleared')
	assert.ok(ev, 'show.cleared broadcast')
	assert.equal(ev[1].slug, JSON.parse(r.body).slug)
})

test('N4: a projects pair of the sync map never carries _trash; other pairs keep their excludes', () => {
	const map = validateMap({
		version: 2,
		volumes: { bridge: { id: 'bridge', mount: '/b' }, usb: { id: 'usb', mount: '/u' } },
		pairs: [
			{ id: 'bridge-projects', volume: 'bridge', exfat: 'projects', project: '/home/casparcg/highascg/projects', direction: 'both' },
			{ id: 'usb-projects', volume: 'usb', exfat: 'projects', project: '/home/casparcg/highascg/projects', direction: 'both', exclude: ['x'] },
			{ id: 'bridge-modular-config', volume: 'bridge', exfat: 'configs', project: '/home/casparcg/highascg/config', direction: 'both' },
		],
	})
	const by = Object.fromEntries(map.pairs.map((p) => [p.id, p]))
	assert.deepEqual(by['bridge-projects'].exclude, ['_trash'])
	assert.deepEqual(by['usb-projects'].exclude, ['x', '_trash'])
	assert.equal(by['bridge-modular-config'].exclude, undefined)
	assert.ok(isExcluded('_trash/untitled_2-1793/untitled_2.json', by['bridge-projects'].exclude))
	assert.ok(!isExcluded('untitled_2.json', by['bridge-projects'].exclude))
	assert.ok(!isExcluded('_autosave/untitled_2.json', by['bridge-projects'].exclude), 'autosaves still sync')
})

test('N4: a -replaced backup is not a retirement; a retirement is', () => {
	projectStore.writeProjectFile('wo919_n4', { name: 'wo919_n4', savedAt: new Date().toISOString() })
	const backup = projectStore.backupProjectToTrash('wo919_n4')
	assert.match(backup, /^wo919_n4-\d+-replaced$/)
	assert.equal(projectStore.wasProjectSlugRetired('wo919_n4'), false)
	assert.equal(projectStore.retireProjectSlug('wo919_n4'), true)
	assert.equal(projectStore.wasProjectSlugRetired('wo919_n4'), true)
})

function mediaCtx() {
	const media = fs.mkdtempSync(path.join(TMP, 'media-'))
	const c = { config: { local_media_path: media }, persistence, logs: [], log(l, m) { this.logs.push(m) } }
	const dir = (slug) => path.join(media, 'projects', slug)
	return { c, dir }
}
const put = (file, text = 'x') => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, text))

test('N5: a rename moves the media folder to the new slug (the fresh empty one is replaced)', () => {
	const { c, dir } = mediaCtx()
	put(path.join(dir('old_show'), 'clip.mov'), 'video')
	put(path.join(dir('old_show'), 'sub', 'a.png'))
	fs.mkdirSync(dir('new_show'), { recursive: true }) // persistProject → ensureProjectMediaDir already made it
	const r = moveProjectMediaOnRename(c, 'old_show', 'new_show', { name: 'New show', scenes: { scenes: [{ layers: [{ source: { type: 'media', value: 'clip.mov' } }] }] } })
	assert.equal(r.action, 'moved')
	assert.equal(fs.readFileSync(path.join(dir('new_show'), 'clip.mov'), 'utf8'), 'video')
	assert.ok(fs.existsSync(path.join(dir('new_show'), 'sub', 'a.png')))
	assert.ok(!fs.existsSync(dir('old_show')))
})

test('N5: an empty old folder is removed; a missing one is nothing', () => {
	const { c, dir } = mediaCtx()
	fs.mkdirSync(path.join(dir('empty_old'), 'deep'), { recursive: true })
	assert.equal(moveProjectMediaOnRename(c, 'empty_old', 'x', {}).action, 'removed_empty')
	assert.ok(!fs.existsSync(dir('empty_old')))
	assert.equal(moveProjectMediaOnRename(c, 'never_had', 'x', {}).action, 'none')
})

test('N5: media is never deleted — both folders full, or the project names the old folder, keeps both', () => {
	const { c, dir } = mediaCtx()
	put(path.join(dir('a_old'), 'a.mov'))
	put(path.join(dir('a_new'), 'b.mov'))
	assert.equal(moveProjectMediaOnRename(c, 'a_old', 'a_new', {}).action, 'kept_both')
	assert.ok(fs.existsSync(path.join(dir('a_old'), 'a.mov')) && fs.existsSync(path.join(dir('a_new'), 'b.mov')))
	put(path.join(dir('r_old'), 'r.mov'))
	const named = { scenes: { scenes: [{ layers: [{ source: { type: 'media', value: 'projects/r_old/r.mov' } }] }] } }
	assert.equal(moveProjectMediaOnRename(c, 'r_old', 'r_new', named).action, 'kept_referenced')
	assert.ok(fs.existsSync(path.join(dir('r_old'), 'r.mov')), 'a ref that names the old slug still resolves')
})

test('N5: retireRenamedSlug moves the media with a real rename, and only for a rename', () => {
	const { c, dir } = mediaCtx()
	projectStore.writeProjectFile('rn_old', { name: 'rn_old', savedAt: new Date().toISOString() })
	put(path.join(dir('rn_old'), 'clip.mov'))
	retireRenamedSlug(c, 'rn_old', 'rn_new', 'other_show', {})
	assert.ok(fs.existsSync(dir('rn_old')), 'another show: nothing moves')
	retireRenamedSlug(c, 'rn_old', 'rn_new', 'rename', {})
	assert.ok(fs.existsSync(path.join(dir('rn_new'), 'clip.mov')))
	assert.ok(!fs.existsSync(dir('rn_old')))
	assert.ok(c.logs.some((m) => /media folder moved/.test(m)), 'never silent')
})

test('N5 + handlers: both rename call sites pass the project', () => {
	const src = read('src/api/routes-data-project-handlers.js')
	assert.equal((src.match(/retireRenamedSlug\(ctx, prevSlug, slug, prevKind, project\)/g) || []).length, 2)
})

test('N1: the notice label grows (no fixed 200 px) and elides only out of room', () => {
	const hp = read('godot/client/app/header_project.gd')
	assert.match(hp, /text_overrun_behavior = TextServer\.OVERRUN_TRIM_ELLIPSIS/)
	assert.match(hp, /custom_minimum_size\.x = HeaderModel\.NOTICE_MIN_W/)
	assert.match(hp, /HeaderModel\.notice_width\(text_w, window_w, room\)/) // N1 follow-up: capped at the room the row leaves
	assert.doesNotMatch(hp, /notice_label\.custom_minimum_size\.x = 200/)
})

test('F11 client: Visuals Send ends on `show.cleared` (visuals_air.gd) and the tab is wired to it', () => {
	assert.match(read('godot/client/features/visuals/visuals_air.gd'), /"show\.cleared"/)
	assert.match(read('godot/client/features/visuals/visuals_tab.gd'), /Air\.show_cleared\(self, d\)/)
})
