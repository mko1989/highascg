'use strict'

/**
 * WO-1029 plan 07 (C12) — the "channels only where cabled" switch: GET|POST /api/cluster/channels-where-cabled.
 * Dry run on the two real boxes' shapes, the refusals (O10), force, the flag surviving a config save, persisted
 * channel-keyed state remapped by role, the server dirty afterwards. Temp HOME + fake stores: nothing live is touched.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cwc-switch-'))
const HOME_BEFORE = process.env.HOME
process.env.HOME = path.join(TMP, 'home')

const dg = require('../../src/config/device-graph')
const routes = require('../../src/api/routes-channels-cabled')
const { planChannelsCabled } = require('../../src/system/channels-cabled-plan')
const { channelsWhereCabledEnabled } = require('../../src/config/screen-channels')
const { supported } = require('../../src/cluster/cluster-caps')
const { boxConfig, quiet, clone } = require('./lib/cwc-fixtures')

const ZOOM = 'dst_mw96s6pd_1'
const P1 = 'dst_mw7t9epz_1'
const P3 = 'dst_mw989wyz_1'
const STREAM = 'dst_mw9orj4o_1'

before(() => fs.mkdirSync(process.env.HOME, { recursive: true }))
after(() => {
	process.env.HOME = HOME_BEFORE
	fs.rmSync(TMP, { recursive: true, force: true })
})

function fakePersistence(initial = {}) {
	const m = new Map(Object.entries(clone(initial)))
	return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), getAll: () => Object.fromEntries(m), flushSync() {} }
}

/** Config manager like config/manager.js: save() replaces, get() returns the stored copy. */
function fakeConfigManager(cfg) {
	let stored = clone(cfg)
	return { get: () => clone(stored), save: (c) => { stored = clone(c) }, saved: () => stored }
}

function ctxFor(box, extra = {}) {
	const cfg = boxConfig(box)
	const cm = fakeConfigManager(cfg)
	return { config: cfg, configManager: cm, persistence: fakePersistence(), log: () => {}, ...extra }
}

const owners = (map) => ({ ownersOf: (id) => (map[id] || []).map((n) => ({ id: n, name: n, online: true, caps: [] })) })
const peer = (name, caps, online = true) => ({ snapshot: () => ({ peers: [{ id: name, name, online, caps }] }) })
const ALL = ['dest-actions', 'channels-cabled']
const call = async (ctx, body) => JSON.parse((await routes.handlePost(JSON.stringify(body), ctx)).body)

function withLocalUse(ctx, ...ids) {
	let g = dg.ensureConnectorsFromSuggested(ctx.config.deviceGraph, ['local_use'], dg.suggestConnectorsAndDevicesFromLive({}, ctx.config))
	for (const id of ids) g = dg.addEdgeToGraph(g, `dst_in_${id}`, 'local_use').graph
	ctx.config.deviceGraph = g
	ctx.configManager = fakeConfigManager(ctx.config)
}

describe('WO-1029 channels-where-cabled: dry run on the two boxes', () => {
	it('7579 (master): the five copy channels go, DeckLink 9/10 become 4/5, everything else stays', () => {
		const ctx = ctxFor('7579', { _destOwnerIndex: owners({ [P3]: ['5867'], [STREAM]: ['5867'] }), _cluster: peer('5867', ALL) })
		const { plan } = JSON.parse(quiet(() => routes.handleGet(ctx)).body)
		assert.equal(plan.enable, true)
		assert.deepEqual(plan.before.map((r) => r.ch), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
		assert.deepEqual(plan.after.map((r) => r.ch), [1, 2, 3, 4, 5])
		assert.deepEqual(plan.removed.map((r) => [r.label, r.reason]), [['to zoom', 'cabled nowhere'], ['PGM/PRV 3', 'cabled on 5867'], ['Stream PGM', 'cabled on 5867']])
		assert.deepEqual(plan.kept, ['PGM/PRV 1'])
		assert.deepEqual(plan.renumbered.map((r) => [r.label, r.from, r.to]), [['DeckLink 1', 9, 4], ['DeckLink 2', 10, 5]])
		assert.ok(plan.external.length >= 4)
		assert.deepEqual(plan.refusals.map((r) => r.code), ['cabled_nowhere'])
		assert.deepEqual(plan.refusals[0].destinations, ['to zoom'])
		assert.match(plan.refusals[0].message, /Local use/)
	})

	it('5867 (follower): PGM/PRV 3 and Stream PGM move to 2-5, DeckLink 3/4 to 6/7', () => {
		const ctx = ctxFor('5867', { _destOwnerIndex: owners({ [P1]: ['7579'] }), _cluster: peer('7579', ALL) })
		const plan = quiet(() => planChannelsCabled(ctx, { enable: true }))
		assert.deepEqual(plan.after.map((r) => r.ch), [1, 2, 3, 4, 5, 6, 7])
		assert.deepEqual(plan.removed.map((r) => [r.label, r.reason]), [['PGM/PRV 1', 'cabled on 7579'], ['to zoom', 'cabled nowhere']])
		assert.deepEqual(plan.renumbered.map((r) => [r.from, r.to]), [[5, 2], [6, 3], [7, 4], [8, 5], [9, 6], [10, 7]])
		assert.deepEqual(plan.kept, ['PGM/PRV 3', 'Stream PGM'])
	})

	it('after a Local use cable for "to zoom" nothing is refused; switching off again shows what comes back', () => {
		const ctx = ctxFor('7579', { _destOwnerIndex: owners({ [P3]: ['5867'], [STREAM]: ['5867'] }), _cluster: peer('5867', ALL) })
		withLocalUse(ctx, ZOOM)
		const plan = quiet(() => planChannelsCabled(ctx, { enable: true }))
		assert.deepEqual(plan.refusals, [])
		assert.deepEqual(plan.after.map((r) => r.ch), [1, 2, 3, 4, 5, 6])
		assert.deepEqual(plan.kept, ['PGM/PRV 1', 'to zoom'])
		ctx.config.cluster = { channelsWhereCabled: true }
		const off = quiet(() => planChannelsCabled(ctx, { enable: false }))
		assert.equal(off.current, true)
		assert.deepEqual(off.added.map((r) => r.label), ['PGM/PRV 3', 'Stream PGM'])
		assert.deepEqual(off.refusals, [])
	})
})

describe('WO-1029 channels-where-cabled: refusals', () => {
	const base = () => ctxFor('7579', { _destOwnerIndex: owners({ [P3]: ['5867'], [STREAM]: ['5867'] }) })

	it('an online linked server without the capabilities refuses; an offline one only warns; a new one passes', () => {
		const ctx = base()
		withLocalUse(ctx, ZOOM)
		ctx._cluster = peer('5867', ['hello', 'dest-actions'])
		let plan = quiet(() => planChannelsCabled(ctx, { enable: true }))
		assert.deepEqual(plan.refusals.map((r) => r.code), ['peer_caps'])
		assert.match(plan.refusals[0].message, /channels-cabled/)
		ctx._cluster = peer('5867', [], false)
		plan = quiet(() => planChannelsCabled(ctx, { enable: true }))
		assert.deepEqual(plan.refusals, [])
		assert.ok(plan.warnings.some((w) => w.code === 'peer_offline'))
		ctx._cluster = peer('5867', ALL)
		assert.deepEqual(quiet(() => planChannelsCabled(ctx, { enable: true })).refusals, [])
		assert.ok(supported().includes('channels-cabled'))
	})

	it('a destination cabled nowhere: 409 without force, applied with force', async () => {
		const ctx = base()
		const r = quiet(() => routes.handlePost(JSON.stringify({ enable: true, dryRun: false }), ctx))
		const res = await r
		assert.equal(res.status, 409)
		assert.equal(channelsWhereCabledEnabled(ctx.configManager.saved()), false)
		const forced = await call(ctx, { enable: true, dryRun: false, force: true })
		assert.equal(forced.ok, true)
		assert.equal(channelsWhereCabledEnabled(ctx.configManager.saved()), true)
	})

	it('content on a channel that disappears refuses (forceable)', () => {
		const ctx = base()
		withLocalUse(ctx, ZOOM)
		ctx._playbackMatrix = { c: { channel: 7, layer: 10 } }
		const plan = quiet(() => planChannelsCabled(ctx, { enable: true }))
		assert.deepEqual(plan.refusals.map((r) => [r.code, r.forceable]), [['on_air', true]])
	})

	it('a manual casparcg.config override refuses', () => {
		const ctx = base()
		withLocalUse(ctx, ZOOM)
		ctx.config.casparServer = { ...ctx.config.casparServer, casparConfigOverride: '<configuration/>' }
		assert.deepEqual(quiet(() => planChannelsCabled(ctx, { enable: true })).refusals.map((r) => r.code), ['config_override'])
	})
})

describe('WO-1029 channels-where-cabled: the switch', () => {
	it('POST dryRun (default) writes nothing; "enable" is required', async () => {
		const ctx = ctxFor('7579')
		withLocalUse(ctx, ZOOM, P3, STREAM)
		const dry = await call(ctx, { enable: true })
		assert.equal(dry.dryRun, true)
		assert.equal(channelsWhereCabledEnabled(ctx.configManager.saved()), false)
		assert.equal((await routes.handlePost('{}', ctx)).status, 400)
	})

	it('writes the flag, remaps persisted state by role, drops copy entries, marks the server dirty, never restarts Caspar', async () => {
		const ctx = ctxFor('5867', { _destOwnerIndex: owners({ [P1]: ['7579'], [ZOOM]: ['7579'] }) })
		ctx.persistence = fakePersistence({
			liveScenesByProgramChannel: { 2: { sceneId: 'copyA' }, 4: { sceneId: 'copyB' }, 5: { sceneId: 'mix' }, 7: { sceneId: 'ppt' } },
			programLayerBankByChannel: { 4: { bank: 1 }, 5: { bank: 2 }, 7: { bank: 3 } },
			scene_deck: { cells: ['route://5', 'route://9-3', 'route://2'] },
			unrelated: { 5: 'stays' },
		})
		const calls = []
		ctx._wsBroadcast = (...a) => calls.push(a)
		ctx.amcp = { sent: [] }
		const r = await call(ctx, { enable: true, dryRun: false, force: true })
		assert.equal(r.ok, true)
		assert.equal(r.restartNeeded, true)
		assert.ok(fs.existsSync(path.join(r.backupDir, 'state.json')))
		const p = ctx.persistence
		assert.deepEqual(p.get('liveScenesByProgramChannel'), { 2: { sceneId: 'mix' }, 4: { sceneId: 'ppt' } })
		assert.deepEqual(p.get('programLayerBankByChannel'), { 2: { bank: 2 }, 4: { bank: 3 } })
		assert.deepEqual(p.get('scene_deck'), { cells: ['route://2', 'route://6-3', null] })
		assert.deepEqual(p.get('unrelated'), { 5: 'stays' })
		assert.equal(channelsWhereCabledEnabled(ctx.config), true)
		assert.equal(channelsWhereCabledEnabled(ctx.configManager.saved()), true)
		assert.ok(p.get('casparRestartPending'), 'the server is dirty until the Apply')
		assert.deepEqual(ctx.amcp.sent, [])
		assert.ok(calls.some((c) => c[1]?.path === 'cluster.channelsWhereCabled'))
		// again: a no-op
		assert.equal((await call(ctx, { enable: true, dryRun: false })).noop, true)
	})

	it('the flag survives a settings save (the save spreads the stored config)', async () => {
		const ctx = ctxFor('7579', { _destOwnerIndex: owners({ [P3]: ['5867'], [STREAM]: ['5867'] }) })
		withLocalUse(ctx, ZOOM)
		await call(ctx, { enable: true, dryRun: false })
		const cur = ctx.configManager.get()
		// settings-post.js builds newConfig = { ...cur, <hand-listed slices> } and saves it
		ctx.configManager.save({ ...cur, screen_count: cur.screen_count, ui: cur.ui })
		assert.equal(channelsWhereCabledEnabled(ctx.configManager.get()), true)
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/settings-post.js'), 'utf8')
		assert.match(src, /const newConfig = \{ \.\.\.cur,/)
	})

	it('switching off remaps back by role and clears the flag', async () => {
		const ctx = ctxFor('7579', { _destOwnerIndex: owners({ [P3]: ['5867'], [STREAM]: ['5867'] }) })
		withLocalUse(ctx, ZOOM)
		ctx.persistence = fakePersistence({ liveScenesByProgramChannel: { 2: { sceneId: 'a' } } })
		await call(ctx, { enable: true, dryRun: false })
		const r = await call(ctx, { enable: false, dryRun: false })
		assert.equal(r.ok, true)
		assert.equal(channelsWhereCabledEnabled(ctx.config), false)
		assert.deepEqual(ctx.persistence.get('liveScenesByProgramChannel'), { 2: { sceneId: 'a' } })
	})

	it('the route is registered next to the WO-868 one', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
		assert.match(src, /routes\.get\('\/api\/cluster\/channels-where-cabled'/)
		assert.match(src, /routes\.post\('\/api\/cluster\/channels-where-cabled'/)
	})
})
