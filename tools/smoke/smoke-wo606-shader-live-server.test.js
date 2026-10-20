'use strict'

/**
 * WO-606 — Shader Live on the node (directive D): instance resolution (bank B, PGM first, playlists on air),
 * literal rewrite + CG UPDATE to every live instance, the 403 → CG ADD re-host, macro / preset / reset-all,
 * curation persisted without the live edits, Save-as-child. The shader store is stubbed — nothing writes to data/.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const store = require('../../src/shaderfx/shader-store')

const SRC = 'const float SPEED = 0.5;\nvoid mainImage(out vec4 o, in vec2 f) { o = vec4(vec3(sin(iTime * SPEED)), 1.0); }\n'
const lib = { 'sh-test': { id: 'sh-test', name: 'Test', common: '', passes: { image: { source: SRC } } } }
const saved = []
store.getShader = async (id) => (lib[id] ? JSON.parse(JSON.stringify(lib[id])) : null)
store.listShaders = async () => Object.values(lib).map((x) => ({ id: x.id }))
store.saveShader = async (cfg) => {
	saved.push(JSON.parse(JSON.stringify(cfg)))
	return { config: cfg, casparPath: `shaders/${cfg.id}` }
}

const liveSceneState = require('../../src/state/live-scene-state')
const LIVE = {
	1: { scene: { id: 'a', name: 'Look A', layers: [{ layerNumber: 3, source: { value: 'shaders/sh-test' } }, { layerNumber: 4, source: { value: 'clip.mp4' } }] } },
	2: { scene: { id: 'a', name: 'Look A', layers: [{ layerNumber: 3, source: { value: 'shaders/sh-test' } }] } },
	5: {
		scene: {
			id: 'pl',
			name: 'Playlist look',
			layers: [{ layerNumber: 7, sourceMode: 'list', source: { value: 'shaders/sh-other' }, playlist: [{ value: 'shaders/sh-other' }, { value: 'shaders/sh-test' }] }],
		},
	},
}
liveSceneState.getAll = () => LIVE

const { liveShaderInstances } = require('../../src/shaderfx/shader-live-instances')
const { playlistRuntimeKey } = require('../../src/engine/scene-take-lbg-playlist')
const S = require('../../src/shaderfx/shader-live-session')
const Ops = require('../../src/shaderfx/shader-live-ops')

function makeCtx(fail403 = new Set()) {
	const sent = []
	return {
		sent,
		config: {},
		programLayerBankByChannel: { 1: 'b' },
		playlistActiveIndices: { [playlistRuntimeKey(5, 'pl', 7)]: 1 },
		amcp: {
			raw: async (line) => {
				sent.push(line)
				const m = /^CG (\d+-\d+) UPDATE/.exec(line)
				if (m && fail403.has(m[1])) {
					fail403.delete(m[1])
					throw new Error('PARAMETER_ILLEGAL: 403 CG UPDATE FAILED')
				}
				return { ok: true }
			},
		},
	}
}

test('instances: PGM first, bank B offset, PRV stays bank A, playlist resolves to the item on air', () => {
	const list = liveShaderInstances(makeCtx())
	assert.deepEqual(
		list.map((i) => [i.key, i.isPrv]),
		[
			['sh-test@1-103', false],
			['sh-test@5-7', false],
			['sh-test@2-3', true],
		],
	)
})

test('set rewrites the literal and CG UPDATEs every live instance; 403 re-hosts once', async () => {
	S.sessions.clear()
	const ctx = makeCtx(new Set(['5-7']))
	const s = await S.open('sh-test')
	const v0 = await S.view('sh-test', s)
	const speed = v0.params.find((p) => p.name === 'SPEED')
	assert.ok(speed, 'the declared const is a param')
	const r = await Ops.run('set', { key: speed.key, values: [0.75] }, s, { ctx, id: 'sh-test' })
	const passes = await S.applyBatch(s, r.items)
	assert.deepEqual(passes, ['image'])
	const push = await S.pushLive(ctx, 'sh-test', s, passes)
	assert.equal(push.targets, 3)
	assert.deepEqual(push.errors, [])
	assert.match(s.cfg.passes.image.source, /SPEED = 0\.75;/)
	const updates = ctx.sent.filter((l) => / UPDATE 0 /.test(l))
	assert.equal(updates.length, 4, '3 targets + the retry after the re-host')
	assert.ok(ctx.sent.includes('CG 5-7 ADD 0 "shaders/sh-test" 1 "{}"'), 're-host with the on-air template path')
	assert.match(updates[0], /^CG 1-103 UPDATE 0 "\{\\"passes\\":\{\\"image\\":\{\\"source\\":\\"const float SPEED = 0\.75;\\\\n/, 'AMCP escaping: \\\\n survives')
	const v1 = await S.view('sh-test', s)
	assert.equal(v1.dirty, true)
	assert.equal(v1.params.find((p) => p.key === speed.key).changed, true)
	assert.equal((await S.open('sh-test')) === s, true, 'an edited session survives a reopen')
})

test('preset save/apply, reset all, curation persists the pristine source, save lands as a child', async () => {
	S.sessions.clear()
	saved.length = 0
	const ctx = makeCtx()
	const s = await S.open('sh-test')
	const key = (await S.view('sh-test', s)).params.find((p) => p.name === 'SPEED').key
	await S.applyBatch(s, (await Ops.run('set', { items: [{ key, values: [2] }] }, s, { ctx, id: 'sh-test' })).items)
	const ps = await Ops.run('preset-save', { name: 'Fast' }, s, { ctx, id: 'sh-test' })
	assert.deepEqual(ps.manifest.presets, [{ name: 'Fast', v: { [key]: [2] } }])
	s.cfg.controls = ps.manifest
	await S.persistCuration(s)
	assert.match(saved[0].passes.image.source, /SPEED = 0\.5;/, 'curation save keeps the library source')
	assert.equal(saved[0].controls.presets[0].name, 'Fast')
	lib['sh-test'].controls = saved[0].controls
	const reset = await Ops.run('reset', {}, s, { ctx, id: 'sh-test' })
	assert.deepEqual(reset.passes, ['common', 'image'])
	assert.match(s.cfg.passes.image.source, /SPEED = 0\.5;/)
	await S.applyBatch(s, (await Ops.run('preset', { name: 'Fast' }, s, { ctx, id: 'sh-test' })).items)
	assert.match(s.cfg.passes.image.source, /SPEED = 2;|SPEED = 2\.0;/)
	const child = await Ops.run('save', {}, s, { ctx, id: 'sh-test' })
	assert.equal(child.extra.savedAs, 'sh-test-c2')
	assert.equal(saved.at(-1).parentId, 'sh-test')
	assert.equal((await Ops.run('nope', {}, s, { ctx, id: 'sh-test' })).status, 404)
})

test('bad input is rejected; wiggle needs a preview instance', async () => {
	S.sessions.clear()
	const ctx = makeCtx()
	const s = await S.open('sh-test')
	assert.equal((await Ops.run('set', { key: 'nope', values: [1] }, s, { ctx, id: 'sh-test' })).status, 400)
	const key = (await S.view('sh-test', s)).params.find((p) => p.name === 'SPEED').key
	assert.equal((await Ops.run('set', { key, values: ['x'] }, s, { ctx, id: 'sh-test' })).status, 400)
	const saveLive = LIVE[2]
	delete LIVE[2]
	assert.equal((await Ops.run('wiggle', { key }, s, { ctx, id: 'sh-test' })).status, 409)
	LIVE[2] = saveLive
})

test('router registers the Shader Live routes (500-line router: one register line)', () => {
	const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/api/router.js'), 'utf8')
	assert.match(src, /require\('\.\/routes-shader-live'\)\.register\(routes\)/)
})
