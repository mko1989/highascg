'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const dirty = require('../../src/preview/compose-preview-dirty')
const {
	handleComposePreviewMetaGet,
	handleComposePreviewPngGet,
} = require('../../src/preview/compose-preview-cache')
const { normalizeComposePreviewSettings } = require('../../src/preview/compose-preview-mode')

describe('compose-preview-dirty', () => {
	it('starts clean — shouldCapture false until bump', () => {
		dirty.reset()
		assert.equal(dirty.shouldCapture(1), false)
		dirty.bumpDirty(1, 'test')
		assert.equal(dirty.shouldCapture(1), true)
	})

	it('clearDirty prevents capture until next bump', () => {
		dirty.reset()
		dirty.bumpDirty(2, 'test')
		dirty.markCaptureStart(2)
		dirty.clearDirty(2, 'abc')
		assert.equal(dirty.shouldCapture(2), false)
		dirty.bumpDirty(2, 'again')
		assert.equal(dirty.shouldCapture(2), true)
	})

	it('inFlight blocks shouldCapture', () => {
		dirty.reset()
		dirty.bumpDirty(3, 'test')
		dirty.markCaptureStart(3)
		assert.equal(dirty.shouldCapture(3), false)
	})

	it('minIntervalMs rate limit', () => {
		dirty.reset()
		dirty.bumpDirty(4, 'test')
		dirty.markCaptureStart(4)
		dirty.clearDirty(4, 'x')
		dirty.bumpDirty(4, 'test2')
		assert.equal(dirty.shouldCapture(4, { minIntervalMs: 60_000 }), false)
	})
})

describe('compose-preview API', () => {
	it('GET meta — 404 when no PNG', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-prev-'))
		const ctx = {
			config: {
				local_media_path: dir,
				composePreview: { basenamePrefix: 'highascg_preview' },
			},
		}
		const res = await handleComposePreviewMetaGet(ctx, 991)
		assert.equal(res.status, 404)
	})

	it('GET png — serves written file with ETag', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-prev-'))
		const sub = path.join(dir, 'highascg_preview')
		fs.mkdirSync(sub, { recursive: true })
		const png = Buffer.from(
			'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
				'0d0a2db40000000049454e44ae426082',
			'hex',
		)
		fs.writeFileSync(path.join(sub, 'ch5.png'), png)
		const ctx = {
			config: {
				local_media_path: dir,
				composePreview: { basenamePrefix: 'highascg_preview' },
			},
		}
		const res = await handleComposePreviewPngGet(ctx, 5, {})
		assert.equal(res.status, 200)
		assert.equal(res.headers['Content-Type'], 'image/png')
		assert.ok(res.headers.ETag)
	})

	it('normalizeComposePreviewSettings migrates caspar_image to canvas', () => {
		assert.equal(normalizeComposePreviewSettings({ mode: 'canvas' }).mode, 'canvas')
		assert.equal(normalizeComposePreviewSettings({ mode: 'caspar_image' }).mode, 'canvas')
		assert.equal(normalizeComposePreviewSettings({ mode: 'ffmpeg_jpeg' }).mode, 'ffmpeg_jpeg')
	})
})
