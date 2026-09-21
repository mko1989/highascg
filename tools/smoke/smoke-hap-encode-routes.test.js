'use strict'

/* WO-575: HTTP surface of the HAP encoder — validation, status codes, and that the specific routes
 * are registered BEFORE the `/api/media/*` wildcard (which requires Caspar and would swallow them). */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const H = require('../../src/api/routes-media-hap')

const body = (r) => JSON.parse(r.body)

test('validation: ids required, batch capped, cancel needs a known jobId', async () => {
	const ctx = { config: {}, log: () => {} }
	assert.strictEqual((await H.handleHapEncodeStart({}, ctx)).status, 400)
	assert.strictEqual((await H.handleHapEncodeStart({ ids: [] }, ctx)).status, 400)
	assert.strictEqual((await H.handleHapEncodeStart({ ids: ['  ', ''] }, ctx)).status, 400)
	assert.strictEqual((await H.handleHapEncodeProbe({ ids: [] }, ctx)).status, 400)
	const many = Array.from({ length: 501 }, (_, i) => `f${i}.mov`)
	assert.strictEqual((await H.handleHapEncodeStart({ ids: many }, ctx)).status, 400)
	assert.strictEqual((await H.handleHapEncodeCancel({}, ctx)).status, 400)
	assert.strictEqual((await H.handleHapEncodeCancel({ jobId: 'nope' }, ctx)).status, 404)
	assert.strictEqual(ctx._hapEncodeQueue, undefined, 'validation failures and cancel must not construct the queue')
	const state = await H.handleHapEncodeState(ctx)
	assert.deepStrictEqual(body(state), { ok: true, jobs: [] })
})

test('start returns 202 with the job; unknown files are reported skipped, not errors; toggles only honour real booleans', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-routes-'))
	const ctx = { config: { local_media_path: dir }, log: () => {} }
	try {
		const r = await H.handleHapEncodeStart(JSON.stringify({ ids: ['ghost.mov', 'ghost.mov'], alpha: 'true', hq: 1 }), ctx)
		assert.strictEqual(r.status, 202)
		const j = body(r)
		assert.strictEqual(j.ok, true)
		assert.match(j.jobId, /^hap-/)
		assert.strictEqual(j.format, 'hap', 'string/number toggles must not enable alpha/HQ')
		assert.strictEqual(j.items.length, 1, 'duplicate ids collapse')
		assert.deepStrictEqual([j.items[0].state, j.items[0].reason], ['skipped', 'file not found'])
		const state = body(await H.handleHapEncodeState(ctx))
		assert.strictEqual(state.jobs.length, 1)
		assert.strictEqual((await H.handleHapEncodeCancel({ jobId: j.jobId }, ctx)).status, 200)
	} finally {
		ctx._hapEncodeQueue?.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('router registers the hap-encode routes before the requireCaspar /api/media/* wildcard, all requireCaspar:false', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
	const wildcard = src.indexOf("routes.post('/api/media/*'")
	assert.ok(wildcard > 0)
	for (const [method, route] of [
		['post', '/api/media/hap-encode'],
		['post', '/api/media/hap-encode/probe'],
		['post', '/api/media/hap-encode/cancel'],
		['get', '/api/media/hap-encode'],
	]) {
		const at = src.indexOf(`routes.${method}('${route}'`)
		assert.ok(at > 0 && at < wildcard, `${method} ${route} must be registered before the wildcard`)
		const line = src.slice(at, src.indexOf('\n', at))
		assert.match(line, /requireCaspar: false/, `${route}: HAP encoding must work with Caspar disconnected`)
	}
})
