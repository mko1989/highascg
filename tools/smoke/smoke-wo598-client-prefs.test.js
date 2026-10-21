'use strict'

/**
 * WO-598 D — /api/client-prefs: multiview presets (every multiviewer) and multiviewer 2+ layouts live on the node,
 * not in one client's storage. Per-multiviewer writes (two clients editing different multiviewers never clobber
 * each other), strict value shapes, a WS broadcast per write. Persistence is an in-memory stub.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { register, handlePost } = require('../../src/api/routes-client-prefs')

function makeCtx() {
	const mem = {}
	const sent = []
	return {
		sent,
		mem,
		persistence: { get: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : null), set: (k, v) => (mem[k] = JSON.parse(JSON.stringify(v))) },
		_wsBroadcast: (type, data) => sent.push([type, data]),
	}
}
const post = (ctx, b) => {
	const r = handlePost(JSON.stringify(b), ctx)
	return { status: r.status, body: JSON.parse(r.body) }
}
const snap = (x) => ({ cells: [{ id: 'cell_a', x, y: 0, w: 10, h: 10 }], canvasWidth: 1920, canvasHeight: 1080 })

test('presets and layouts are stored per multiviewer and broadcast', () => {
	const ctx = makeCtx()
	assert.equal(post(ctx, { key: 'multiviewPresets', n: 1, value: [snap(1), null, null, null] }).status, 200)
	assert.equal(post(ctx, { key: 'multiviewPresets', n: 2, value: [null, snap(2), null, null] }).status, 200)
	assert.equal(post(ctx, { key: 'multiviewLayouts', n: 2, value: snap(3) }).status, 200)
	assert.deepEqual(Object.keys(ctx.mem.clientPrefs.multiviewPresets), ['1', '2'], 'a write to n=2 kept n=1')
	assert.equal(ctx.mem.clientPrefs.multiviewLayouts['2'].cells[0].x, 3)
	assert.deepEqual(ctx.sent[2], ['client_prefs', { key: 'multiviewLayouts', n: 2, value: snap(3) }])
	assert.equal(post(ctx, { key: 'multiviewPresets', n: 1, value: null }).status, 200)
	assert.deepEqual(Object.keys(ctx.mem.clientPrefs.multiviewPresets), ['2'], 'null removes')
})

test('bad writes are refused and change nothing', () => {
	const ctx = makeCtx()
	const bad = [
		{ key: 'other', n: 1, value: null },
		{ key: 'multiviewPresets', n: 0, value: null },
		{ key: 'multiviewPresets', n: 17, value: null },
		{ key: 'multiviewPresets', n: 1, value: [snap(1)] },
		{ key: 'multiviewPresets', n: 1, value: [1, null, null, null] },
		{ key: 'multiviewLayouts', n: 2, value: { cells: 'x' } },
		{ key: 'multiviewLayouts', n: 1, value: snap(1) },
	]
	for (const b of bad) assert.equal(post(ctx, b).status, 400, JSON.stringify(b))
	const huge = { cells: [{ id: 'x'.repeat(600 * 1024) }] }
	assert.equal(post(ctx, { key: 'multiviewLayouts', n: 2, value: huge }).status, 413)
	assert.deepEqual(ctx.mem, {})
	assert.deepEqual(ctx.sent, [])
})

test('GET returns every key, empty when nothing is stored; routes need no Caspar', () => {
	const h = {}
	register({ get: (p, fn, o) => (h[`GET ${p}`] = { fn, o }), post: (p, fn, o) => (h[`POST ${p}`] = { fn, o }) })
	const ctx = makeCtx()
	assert.deepEqual(JSON.parse(h['GET /api/client-prefs'].fn({ ctx }).body), { prefs: { multiviewPresets: {}, multiviewLayouts: {} } })
	assert.equal(h['GET /api/client-prefs'].o.requireCaspar, false)
	assert.equal(h['POST /api/client-prefs'].o.requireCaspar, false)
	h['POST /api/client-prefs'].fn({ ctx, body: JSON.stringify({ key: 'multiviewLayouts', n: 3, value: snap(9) }) })
	assert.equal(JSON.parse(h['GET /api/client-prefs'].fn({ ctx }).body).prefs.multiviewLayouts['3'].cells[0].x, 9)
	const router = require('fs').readFileSync(require('path').join(__dirname, '../../src/api/router.js'), 'utf8')
	assert.match(router, /require\('\.\/routes-client-prefs'\)\.register\(routes\)/)
})

test('web mirror: node copy wins, browser-only entries are pushed up once, own echoes are ignored', async () => {
	const mem = new Map()
	const posts = []
	let served = { multiviewPresets: { 2: [snap(7), null, null, null] }, multiviewLayouts: {} }
	globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
	globalThis.fetch = async (url, opts = {}) => {
		if (opts.method === 'POST') posts.push(JSON.parse(opts.body))
		const body = opts.method === 'POST' ? { ok: true } : { prefs: served }
		return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
	}
	mem.set('casparcg_multiview_presets_v1', JSON.stringify([snap(1), null, null, null])) // multiviewer 1, this browser only
	mem.set('casparcg_multiview_layout_3', JSON.stringify(snap(3))) // multiviewer 3 layout, this browser only
	const path = require('path')
	const P = await import(path.join(__dirname, '../../client/lib/client-prefs.js'))
	const { multiviewState: mv } = await import(path.join(__dirname, '../../client/lib/multiview-state.js'))
	assert.equal(mv.getPresetSlots()[0].cells[0].x, 1, 'before the node answers: local fallback')
	let changes = 0
	mv.on('change', () => changes++)
	assert.equal(await P.loadClientPrefs(), true)
	assert.deepEqual(
		posts.map((p) => [p.key, p.n]),
		[['multiviewPresets', 1], ['multiviewLayouts', 3]],
		'only the entries the node lacked were pushed',
	)
	mv.switchTo(2)
	assert.equal(mv.getPresetSlots()[0].cells[0].x, 7, "the node's presets for multiviewer 2")
	mv.switchTo(3)
	assert.equal(mv.cells[0].x, 3)
	posts.length = 0
	mv.savePresetSlot(1, mv.snapshotForPreset())
	assert.deepEqual(posts.map((p) => [p.key, p.n, p.value[1].cells[0].x]), [['multiviewPresets', 3, 3]])
	changes = 0
	P.applyClientPrefsBroadcast({ key: 'multiviewPresets', n: 3, value: posts[0].value })
	assert.equal(changes, 0, 'own echo: no redraw / autosave')
	P.applyClientPrefsBroadcast({ key: 'multiviewLayouts', n: 3, value: snap(42) })
	assert.equal(mv.cells[0].x, 42, "another client's layout for the open multiviewer reloads it")
	assert.equal(changes, 1)
	P.applyClientPrefsBroadcast({ key: 'multiviewLayouts', n: 4, value: snap(5) })
	assert.equal(changes, 1, 'another multiviewer: no redraw')
	served = null
})
