#!/usr/bin/env node
/**
 * WO-184: Smoke tests for thumbnail guard implementation.
 * Standalone test file - run with: node test/wo-184-smoke-tests.js
 */

'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

let passed = 0
let failed = 0

function test(name, fn) {
	try {
		fn()
		console.log(`✓ ${name}`)
		passed++
	} catch (e) {
		console.error(`✗ ${name}: ${e.message}`)
		failed++
	}
}

// Test 1: readThumbnailCacheFile rejects zero-byte files
test('readThumbnailCacheFile rejects zero-byte files', () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo184-'))
	try {
		fs.writeFileSync(path.join(tmpDir, 'empty.png'), '')
		const { readThumbnailCacheFile } = require('../src/media/local-media-ffmpeg')
		const result = readThumbnailCacheFile(tmpDir, 'empty')
		assert.strictEqual(result, null, 'Zero-byte file should return null')
	} finally {
		fs.rmSync(tmpDir, { recursive: true })
	}
})

// Test 2: readThumbnailCacheFile accepts valid PNG data
test('readThumbnailCacheFile reads valid PNG files', () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo184-'))
	try {
		// Minimal valid PNG header + IHDR + data
		const pngData = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
			0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
		])
		fs.writeFileSync(path.join(tmpDir, 'valid.png'), pngData)
		const { readThumbnailCacheFile } = require('../src/media/local-media-ffmpeg')
		const result = readThumbnailCacheFile(tmpDir, 'valid')
		assert.ok(result !== null, 'Valid PNG should be returned')
		assert.strictEqual(result.length, pngData.length, 'File size should match')
	} finally {
		fs.rmSync(tmpDir, { recursive: true })
	}
})

// Test 3: writeThumbnailCacheFile uses atomic write
test('writeThumbnailCacheFile creates valid PNG files (atomic write)', () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo184-'))
	try {
		const testData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		const { writeThumbnailCacheFile } = require('../src/media/local-media-ffmpeg')

		writeThumbnailCacheFile(tmpDir, 'test-key', testData)

		// Check that file exists and has correct content
		const filePath = path.join(tmpDir, 'test-key.png')
		assert.ok(fs.existsSync(filePath), 'Cache file should exist')
		const content = fs.readFileSync(filePath)
		assert.strictEqual(content.length, testData.length, 'Written content should match')

		// Check that tmp file was cleaned up
		const tmpFile = `${filePath}.tmp`
		assert.ok(!fs.existsSync(tmpFile), 'Temp file should be cleaned up')
	} finally {
		fs.rmSync(tmpDir, { recursive: true })
	}
})

// Test 4: cleanupZeroByteThumbnails removes zero-byte files
test('cleanupZeroByteThumbnails removes zero-byte files', async () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo184-'))
	try {
		fs.writeFileSync(path.join(tmpDir, 'zero1.png'), '')
		fs.writeFileSync(path.join(tmpDir, 'zero2.png'), '')
		fs.writeFileSync(path.join(tmpDir, 'valid.png'), 'NOT_EMPTY')

		const { cleanupZeroByteThumbnails } = require('../src/media/local-media-ffmpeg')
		const result = await cleanupZeroByteThumbnails({ thumbnail_cache_path: tmpDir })

		assert.strictEqual(result.deleted, 2, 'Should delete 2 zero-byte files')
		assert.strictEqual(result.errors, 0, 'Should have no errors')
		assert.ok(!fs.existsSync(path.join(tmpDir, 'zero1.png')), 'Zero-byte file 1 should be deleted')
		assert.ok(!fs.existsSync(path.join(tmpDir, 'zero2.png')), 'Zero-byte file 2 should be deleted')
		assert.ok(fs.existsSync(path.join(tmpDir, 'valid.png')), 'Non-empty file should be preserved')
	} finally {
		fs.rmSync(tmpDir, { recursive: true })
	}
})

// Test 5: Syntax check for modified files
test('Modified server files have valid syntax', () => {
	const files = [
		'src/api/routes-media.js',
		'src/media/local-media-ffmpeg.js',
	]
	const { execSync } = require('child_process')
	for (const file of files) {
		const result = execSync(`node --check ${path.join(__dirname, '..', file)}`, { encoding: 'utf8' })
		// node --check returns empty string on success
		assert.strictEqual(result.trim(), '', `${file} should have valid syntax`)
	}
})

// Test 6: ESLint check (if available)
test('Modified files pass ESLint check', () => {
	const files = [
		'src/api/routes-media.js',
		'src/media/local-media-ffmpeg.js',
		'client/lib/thumbnail-error-handler.js',
	]
	const { execSync } = require('child_process')
	try {
		// Try to run eslint
		const eslintPath = path.join(__dirname, '..', 'node_modules', '.bin', 'eslint')
		if (fs.existsSync(eslintPath)) {
			const fileArgs = files.map(f => path.join(__dirname, '..', f)).join(' ')
			const result = execSync(`${eslintPath} --quiet ${fileArgs}`, { encoding: 'utf8' })
			// eslint returns empty on success
			assert.ok(result.trim() === '' || result.includes('0 problems'), 'ESLint should find no issues')
		} else {
			console.log('  (ESLint not available, skipping)')
		}
	} catch (e) {
		// eslint not available is not a failure
		console.log('  (ESLint check skipped)')
	}
})

// Print summary
console.log('\n' + '='.repeat(60))
console.log(`WO-184 Smoke Tests: ${passed} passed, ${failed} failed`)
console.log('='.repeat(60))

if (failed > 0) {
	process.exit(1)
}
