'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const defaults = require('../../src/config/defaults')
const { routeRequest } = require('../../src/api/router')

describe('media browser API (router, no AMCP)', () => {
	/** @type {string} */
	let tmp
	/** @type {object} */
	let ctx

	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-router-media-'))
		const cfg = JSON.parse(JSON.stringify(defaults))
		cfg.local_media_path = tmp
		fs.writeFileSync(path.join(tmp, 'a.mov'), 'aaa')
		fs.writeFileSync(path.join(tmp, 'b.mov'), 'bbb')
		ctx = {
			config: cfg,
			amcp: null,
			state: { getState: () => ({ media: [] }) },
			log: () => {},
		}
	})

	after(() => {
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	async function post(path, body) {
		return routeRequest('POST', path, JSON.stringify(body), ctx, null)
	}

	it('POST /api/media/mkdir works without Caspar', async () => {
		const r = await post('/api/media/mkdir', { path: 'testdir' })
		assert.equal(r.status, 200)
		assert.ok(fs.statSync(path.join(tmp, 'testdir')).isDirectory())
	})

	it('POST /api/media/move batch returns moved count', async () => {
		const r = await post('/api/media/move', { sourceIds: ['a.mov', 'b.mov'], targetId: 'testdir' })
		assert.equal(r.status, 200)
		const body = JSON.parse(String(r.body))
		assert.equal(body.ok, true)
		assert.equal(body.moved, 2)
		assert.ok(fs.existsSync(path.join(tmp, 'testdir', 'a.mov')))
	})

	it('POST /api/media/copy works without Caspar', async () => {
		const r = await post('/api/media/copy', { sourceId: 'testdir/a.mov', targetId: '' })
		assert.equal(r.status, 200)
		assert.ok(fs.existsSync(path.join(tmp, 'a.mov')))
		assert.ok(fs.existsSync(path.join(tmp, 'testdir', 'a.mov')))
	})

	it('POST /api/media/copy collision returns 409', async () => {
		fs.mkdirSync(path.join(tmp, 'dest'), { recursive: true })
		fs.writeFileSync(path.join(tmp, 'dest', 'c.mov'), 'exists')
		fs.writeFileSync(path.join(tmp, 'c.mov'), 'source')
		const r = await post('/api/media/copy', { sourceId: 'c.mov', targetId: 'dest' })
		assert.equal(r.status, 409)
	})

	it('POST /api/media/delete batch removes files', async () => {
		const r = await post('/api/media/delete', { ids: ['testdir/a.mov', 'testdir/b.mov'] })
		assert.equal(r.status, 200)
		const body = JSON.parse(String(r.body))
		assert.equal(body.deleted, 2)
	})

	it('POST /api/media/delete folder is recursive', async () => {
		fs.writeFileSync(path.join(tmp, 'testdir', 'left.mov'), 'x')
		const r = await post('/api/media/delete', { id: 'testdir' })
		assert.equal(r.status, 200)
		assert.ok(!fs.existsSync(path.join(tmp, 'testdir')))
	})

	it('POST /api/media/refresh returns ok without AMCP', async () => {
		const r = await post('/api/media/refresh', {})
		assert.equal(r.status, 200)
		const body = JSON.parse(String(r.body))
		assert.equal(body.ok, true)
	})
})
