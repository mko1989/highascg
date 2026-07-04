'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
	handleLiveThumbnailGet,
	handleLiveThumbnailCapturePost,
	cachePngPath,
} = require('../../src/media/live-thumbnail-cache')

function tmpCtx(overrides = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-thumb-'))
	return {
		config: { live_thumbnail_cache_path: dir },
		amcp: null,
		...overrides,
	}
}

test('GET live thumbnail — 404 JSON when no cache (JSON_HEADERS defined)', async () => {
	const ctx = tmpCtx()
	const res = await handleLiveThumbnailGet(ctx, 3, {})
	assert.equal(res.status, 404)
	assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
	const body = JSON.parse(String(res.body))
	assert.equal(body.error, 'No cached live thumbnail')
	assert.equal(body.channel, 3)
})

test('POST capture — 400 without channel', async () => {
	const ctx = tmpCtx()
	const res = await handleLiveThumbnailCapturePost({}, ctx)
	assert.equal(res.status, 400)
	const body = JSON.parse(res.body)
	assert.match(body.error, /channel/i)
})

test('POST capture — 503 when Caspar not connected', async () => {
	const ctx = tmpCtx()
	const res = await handleLiveThumbnailCapturePost({ channel: 2, force: true }, ctx)
	assert.equal(res.status, 503)
	const body = JSON.parse(res.body)
	assert.match(body.error, /Caspar not connected/i)
})

test('GET live thumbnail — 200 serves cached PNG', async () => {
	const ctx = tmpCtx()
	const png = Buffer.from(
		'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
			'0d0a2db40000000049454e44ae426082',
		'hex',
	)
	const dest = cachePngPath(ctx.config, 5)
	const metaDest = path.join(path.dirname(dest), 'ch-5.json')
	await fs.promises.mkdir(path.dirname(dest), { recursive: true })
	await fs.promises.writeFile(dest, png)
	await fs.promises.writeFile(metaDest, JSON.stringify({ channel: 5, capturedAt: new Date().toISOString() }))
	const res = await handleLiveThumbnailGet(ctx, 5, {})
	assert.equal(res.status, 200)
	assert.equal(res.headers['Content-Type'], 'image/png')
	assert.match(res.headers['Cache-Control'], /max-age=86400/)
	assert.ok(Buffer.isBuffer(res.body))
})
