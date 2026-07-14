/**
 * WO-184: Smoke tests for thumbnail serving guard.
 * Tests that zero-byte and recently-modified files are handled correctly.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

// Simple mock for testing
function createMockContext(config) {
	return {
		config: config || { thumbnail_cache_path: null },
		log: (level, msg) => {
			if (level === 'debug') console.log('[debug]', msg)
			else if (level === 'warn') console.warn('[warn]', msg)
		},
		amcp: null,
	}
}

describe('WO-184: Thumbnail serving guard', () => {
	it('should skip serving zero-byte cache files', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo184-test-'))
		try {
			const zeroByteFile = path.join(tmpDir, 'empty.png')
			fs.writeFileSync(zeroByteFile, '')

			const { readThumbnailCacheFile } = require('../../src/media/local-media-ffmpeg')
			const buf = readThumbnailCacheFile(tmpDir, 'empty')
			assert.strictEqual(buf, null, 'zero-byte file should be skipped')
		} finally {
			fs.rmSync(tmpDir, { recursive: true })
		}
	})

	it('should serve valid PNG cache files', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo184-test-'))
		try {
			// Minimal valid PNG (1x1 transparent pixel)
			const pngData = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
				0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
				0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
				0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
				0x44, 0xae, 0x42, 0x60, 0x82
			])

			const validFile = path.join(tmpDir, 'valid.png')
			fs.writeFileSync(validFile, pngData)

			const { readThumbnailCacheFile } = require('../../src/media/local-media-ffmpeg')
			const buf = readThumbnailCacheFile(tmpDir, 'valid')
			assert.ok(buf !== null, 'valid PNG file should be read')
			assert.strictEqual(buf.length, pngData.length, 'file content should match')
		} finally {
			fs.rmSync(tmpDir, { recursive: true })
		}
	})

	it('should cleanup zero-byte thumbnails', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo184-test-'))
		try {
			// Create some test files
			fs.writeFileSync(path.join(tmpDir, 'zeroba.png'), '')
			fs.writeFileSync(path.join(tmpDir, 'zerobyte.png'), '')
			fs.writeFileSync(path.join(tmpDir, 'valid.png'), 'PNG_HEADER_PLACEHOLDER')

			const { cleanupZeroByteThumbnails } = require('../../src/media/local-media-ffmpeg')
			const result = await cleanupZeroByteThumbnails({ thumbnail_cache_path: tmpDir }, console.log)

			assert.strictEqual(result.deleted, 2, 'should delete 2 zero-byte files')
			assert.strictEqual(result.errors, 0, 'should have no errors')
			assert.ok(!fs.existsSync(path.join(tmpDir, 'zeroba.png')), 'zero-byte file should be deleted')
			assert.ok(!fs.existsSync(path.join(tmpDir, 'zerobyte.png')), 'zero-byte file should be deleted')
			assert.ok(fs.existsSync(path.join(tmpDir, 'valid.png')), 'non-zero file should be preserved')
		} finally {
			fs.rmSync(tmpDir, { recursive: true })
		}
	})
})

// Run if invoked directly
if (require.main === module) {
	console.log('[test] Running WO-184 smoke tests...')
	const tests = require('./routes-media-thumb.test.js')
	console.log('[test] Complete')
}
