'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('stream')
const { readRequestBody } = require('../../src/server/http-body')

test('readRequestBody accepts bodies under the cap', async () => {
	const req = Readable.from([Buffer.from('{"ok":true}')])
	const body = await readRequestBody(req, 1024)
	assert.equal(body, '{"ok":true}')
})

test('readRequestBody rejects bodies over the cap', async () => {
	const req = Readable.from([Buffer.alloc(2048, 0x61)])
	await assert.rejects(() => readRequestBody(req, 1024), (err) => err.code === 'BODY_TOO_LARGE')
})
