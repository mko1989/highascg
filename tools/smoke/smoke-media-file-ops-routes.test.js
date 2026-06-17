'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	handleMediaMove,
	handleMediaCopy,
	handleMediaDelete,
} = require('../../src/api/routes-media')

describe('media file ops routes (batch bodies)', () => {
	it('handleMediaMove accepts batch sourceIds', async () => {
		const r = await handleMediaMove(
			JSON.stringify({ sourceIds: ['a.mov', 'b.mov'], targetId: 'dest' }),
			{ config: { local_media_path: '/nonexistent' }, log: () => {} },
		)
		assert.equal(r.status, 404)
		const body = JSON.parse(String(r.body))
		assert.equal(body.ok, false)
		assert.equal(body.moved, 0)
	})

	it('handleMediaCopy requires targetId', async () => {
		const r = await handleMediaCopy(JSON.stringify({ sourceId: 'a.mov' }), { config: {}, log: () => {} })
		assert.equal(r.status, 400)
	})

	it('handleMediaDelete accepts ids array', async () => {
		const r = await handleMediaDelete(
			JSON.stringify({ ids: ['x.mov', 'y.mov'] }),
			{ config: { local_media_path: '/nonexistent' }, log: () => {} },
		)
		assert.equal(r.status, 404)
		const body = JSON.parse(String(r.body))
		assert.equal(body.deleted, 0)
		assert.equal(body.ok, false)
	})
})
