'use strict'

/**
 * WO-1106 B67 — the shader store and NonCommercial shaders (temp store root, never the box's data/shaders):
 *   - the 14 shipped shaders list, re-export and play by their Caspar path as before;
 *   - a withdrawn NC config a box already holds keeps working (get, list) but is marked and never exported;
 *   - a stale NC template never seeds a config; a stale NC export next to its config is dropped;
 *   - a NEW NC config saves only with allowNonCommercial; editing a held one or saving its child needs no flag;
 *   - removed ids (WO-1096) never save;
 *   - the API (raw JSON bodies) does the same.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// bind the store to a temp root before anything else requires it (routes-shaders then gets the same module)
const { store, cleanup } = require('./lib/shader-store-tmp').loadShaderStoreInTempRoot()
const routes = require('../../src/api/routes-shaders')
const lic = require('../../src/shaderfx/shader-licence')
const { buildShaderTemplateHtml } = require('../../src/shaderfx/shader-template-export')
const { configFromHtml } = require('../shaders/shader-licence-manifest')
const { isShaderCgName } = require('../../src/engine/cg-routing')

test.after(cleanup)

const D = store.SHADERS_DATA_DIR
const T = store.SHADERS_TEMPLATE_DIR
const SRC = 'void mainImage(out vec4 o, in vec2 f) { o = vec4(f.x / iResolution.x, 0.0, 0.0, 1.0); }'
const ncHeader = lic.buildShaderHeader({
	title: 'Some NC shader',
	author: 'someone',
	url: 'https://www.shadertoy.com/view/abcdef',
	licence: 'CC-BY-NC-SA-3.0',
	basis: 'Shadertoy default licence',
})
const cfgOf = (id, source = SRC, extra = {}) => ({
	id,
	name: id,
	common: '',
	passes: { image: { source, channels: [null, null, null, null] } },
	audio: { enabled: false },
	opts: { alpha: false },
	...extra,
})
const writeData = (cfg) => fs.writeFileSync(path.join(D, `${cfg.id}.json`), JSON.stringify(cfg))
const hasTpl = (id) => fs.existsSync(path.join(T, `${id}.html`))

test('B67: the 14 shipped shaders list, re-export and play by their Caspar path', async () => {
	const list = await store.listShaders()
	const shipped = list.filter((s) => !s.nonCommercial)
	assert.equal(shipped.length, 14)
	for (const s of shipped) {
		assert.equal(s.casparPath, `shaders/${s.id}`)
		assert.equal(s.local, undefined)
		assert.ok(hasTpl(s.id), `${s.id}.html`)
	}
	const tri = await store.getShader('sh-triangle')
	fs.unlinkSync(path.join(T, 'sh-triangle.html'))
	const saved = await store.saveShader(tri)
	assert.equal(saved.casparPath, 'shaders/sh-triangle')
	const back = configFromHtml(fs.readFileSync(path.join(T, 'sh-triangle.html'), 'utf8'))
	assert.equal(back.id, 'sh-triangle')
	assert.equal(lic.parseShaderHeader(back.passes.image.source).licence, 'CC0-1.0')
	// a look layer that references it still routes as a shader on the look band (WO-322)
	assert.equal(isShaderCgName(saved.casparPath), true)
})

test('B67: a withdrawn config this box already holds keeps working, marked, with no template', async () => {
	writeData(cfgOf('sh-sa-ribbons')) // no header at all — withdrawn by id
	const r = await store.reconcileShaderStore()
	assert.ok(!r.exported.includes('sh-sa-ribbons'))
	assert.equal(hasTpl('sh-sa-ribbons'), false, 'never exported into template/shaders')
	const row = (await store.listShaders()).find((s) => s.id === 'sh-sa-ribbons')
	assert.ok(row, 'still listed (saved looks keep it)')
	assert.equal(row.nonCommercial, true)
	assert.equal(row.local, true)
	assert.equal(row.licence, 'CC-BY-NC-SA-3.0')
	assert.equal(row.licenceNote, 'non-commercial licence — not part of HighAsCG')
	assert.equal(row.casparPath, null)
	assert.equal((await store.getShader('sh-sa-ribbons')).id, 'sh-sa-ribbons', 'the Visuals still load it')
	// editing it (same id, held here) and a Shader Live child need no flag; neither gets a template
	const edit = await store.saveShader({ ...cfgOf('sh-sa-ribbons'), name: 'Ribbons edited' })
	assert.equal(edit.casparPath, null)
	assert.equal(edit.nonCommercial, true)
	const child = await store.saveShader(cfgOf('sh-sa-ribbons-c2', SRC, { parentId: 'sh-sa-ribbons' }))
	assert.equal(child.casparPath, null)
	assert.equal(hasTpl('sh-sa-ribbons-c2'), false)
})

test('B67: a stale NC template never seeds a config; a stale NC export beside its config is dropped', async () => {
	const stale = store.normalizeShaderConfig(cfgOf('sh-sa-tycho-awake-album-cover'))
	fs.writeFileSync(path.join(T, `${stale.id}.html`), buildShaderTemplateHtml(stale))
	const local = store.normalizeShaderConfig(cfgOf('sh-my-nc', ncHeader + SRC))
	writeData(local)
	fs.writeFileSync(path.join(T, 'sh-my-nc.html'), buildShaderTemplateHtml(local))
	const r = await store.reconcileShaderStore()
	assert.ok(!r.recovered.includes(stale.id))
	assert.equal(fs.existsSync(path.join(D, `${stale.id}.json`)), false, 'no config seeded from a withdrawn template')
	assert.ok(!(await store.listShaders()).some((s) => s.id === stale.id), 'not offered')
	assert.deepEqual(r.unexported, ['sh-my-nc'])
	assert.equal(hasTpl('sh-my-nc'), false, 'the stale export is gone')
	assert.ok(fs.existsSync(path.join(D, 'sh-my-nc.json')), 'the config is kept')
	fs.unlinkSync(path.join(T, `${stale.id}.html`))
})

test('B67: a new NC config saves only with allowNonCommercial; removed ids never save', async () => {
	await assert.rejects(store.saveShader(cfgOf('sh-new-nc', ncHeader + SRC)), /CC-BY-NC-SA-3\.0: non-commercial use only.*allowNonCommercial/)
	assert.equal(fs.existsSync(path.join(D, 'sh-new-nc.json')), false)
	await assert.rejects(store.saveShader(cfgOf('sh-sa-warp-speed')), /non-commercial/, 'a withdrawn id is NC without a header')
	const ok = await store.saveShader({ ...cfgOf('sh-new-nc', ncHeader + SRC), allowNonCommercial: true })
	assert.equal(ok.casparPath, null)
	assert.equal(ok.config.allowNonCommercial, undefined, 'the flag is a choice, not stored')
	assert.equal(hasTpl('sh-new-nc'), false)
	const hdr = lic.buildShaderHeader({ title: 'm', author: 'me', url: 'https://example.org/m', licence: 'AGPL-3.0-or-later' })
	await assert.rejects(store.saveShader({ ...cfgOf('sh-mario', hdr + SRC), allowNonCommercial: true }), /removed from HighAsCG/)
	assert.equal(hasTpl('sh-mario'), false)
	const own = await store.saveShader(cfgOf('sh-own-work', hdr + SRC))
	assert.equal(own.casparPath, 'shaders/sh-own-work', 'a commercial-use shader still exports')
	assert.equal(hasTpl('sh-own-work'), true)
})

test('B67: the API — save refused without the flag, kept locally with it, listed with the NC fields', async () => {
	const body = cfgOf('sh-api-nc', ncHeader + SRC)
	const no = await routes.handlePost('/api/shaders', JSON.stringify(body), {})
	assert.equal(no.status, 400)
	assert.match(JSON.parse(no.body).error, /non-commercial use only/)
	const yes = await routes.handlePost('/api/shaders', JSON.stringify({ ...body, allowNonCommercial: true }), {})
	assert.equal(yes.status, 200)
	assert.equal(JSON.parse(yes.body).casparPath, null)
	const list = JSON.parse((await routes.handleGet('/api/shaders', {})).body).shaders
	const row = list.find((s) => s.id === 'sh-api-nc')
	assert.deepEqual(
		{ nonCommercial: row.nonCommercial, local: row.local, licence: row.licence, casparPath: row.casparPath },
		{ nonCommercial: true, local: true, licence: 'CC-BY-NC-SA-3.0', casparPath: null }
	)
	const fc = {
		id: 'sh-fc-nc',
		name: 'fc nc',
		dialect: 'fragcoord',
		passes: { main: { source: 'void main() { fragColor = vec4(1.0); }' } },
		source: { site: 'fragcoord', author: 'a', url: 'https://fragcoord.xyz/s/x', license: 'CC BY-NC 4.0', licenseKind: 'nc' },
	}
	await assert.rejects(store.saveShader(fc), /non-commercial/)
	assert.equal((await store.saveShader({ ...fc, allowNonCommercial: true })).casparPath, null)
})
