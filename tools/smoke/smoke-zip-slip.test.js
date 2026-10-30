'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { extractZipSafely } = require('../../src/utils/safe-unzip')
const { zipStored } = require('./lib/zip-stored')

// WO-836: the fixtures used to come from the `zip` CLI (`zip evil.zip "../../../tmp/evil.txt"`), which refuses a missing
// source file — the build threw, the catch returned, and the guard was never exercised. The archives are built in-process
// now (raw entry names, so a hostile name really lands in the central directory) and nothing is skipped silently.

test('extractZipSafely blocks parent traversal entries', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-slip-'))
	try {
		fs.writeFileSync(path.join(dir, 'evil.zip'), zipStored({ '../../../tmp/evil.txt': 'pwned' }))
		await assert.rejects(() => extractZipSafely(path.join(dir, 'evil.zip'), path.join(dir, 'out')), /zip slip blocked/)
		assert.equal(fs.existsSync(path.resolve(dir, 'out', '../../../tmp/evil.txt')), false, 'nothing was written outside')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('extractZipSafely blocks absolute-path entries', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-abs-'))
	try {
		fs.writeFileSync(path.join(dir, 'abs.zip'), zipStored({ '/tmp/highascg-zip-abs-evil.txt': 'pwned' }))
		await assert.rejects(() => extractZipSafely(path.join(dir, 'abs.zip'), path.join(dir, 'out')), /zip slip blocked/)
		assert.equal(fs.existsSync('/tmp/highascg-zip-abs-evil.txt'), false)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('extractZipSafely writes safe entries only under target root', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-ok-'))
	try {
		const zipPath = path.join(dir, 'good.zip')
		const outDir = path.join(dir, 'extracted')
		fs.writeFileSync(zipPath, zipStored({ 'hello.txt': 'hi' }))
		const count = await extractZipSafely(zipPath, outDir)
		assert.equal(count, 1)
		assert.equal(fs.readFileSync(path.join(outDir, 'hello.txt'), 'utf8'), 'hi')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
