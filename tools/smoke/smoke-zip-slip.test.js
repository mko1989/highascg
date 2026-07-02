'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { extractZipSafely } = require('../../src/utils/safe-unzip')

test('extractZipSafely blocks parent traversal entries', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-slip-'))
	const { execSync } = require('child_process')
	try {
		execSync('zip -q evil.zip "../../../tmp/evil.txt"', { cwd: dir, stdio: 'ignore' })
	} catch {
		fs.rmSync(dir, { recursive: true, force: true })
		return
	}
	await assert.rejects(
		() => extractZipSafely(path.join(dir, 'evil.zip'), path.join(dir, 'out')),
		/zip slip blocked/,
	)
	fs.rmSync(dir, { recursive: true, force: true })
})

test('extractZipSafely writes safe entries only under target root', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-ok-'))
	const zipPath = path.join(dir, 'good.zip')
	const outDir = path.join(dir, 'extracted')
	const { execSync } = require('child_process')
	fs.writeFileSync(path.join(dir, 'hello.txt'), 'hi')
	try {
		execSync('zip -q good.zip hello.txt', { cwd: dir, stdio: 'ignore' })
	} catch {
		fs.rmSync(dir, { recursive: true, force: true })
		return
	}
	const count = await extractZipSafely(zipPath, outDir)
	assert.equal(count, 1)
	assert.equal(fs.readFileSync(path.join(outDir, 'hello.txt'), 'utf8'), 'hi')
	fs.rmSync(dir, { recursive: true, force: true })
})
