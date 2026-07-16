'use strict'

/**
 * WO-248 T248.6 — offline smoke for `resolveChromeBinary()` precedence in
 * `src/media/headless-chrome-cdp.js`. Everything runs against fixture dirs in
 * an isolated tmpdir; NO real Chrome is launched (the live render check is
 * A248.1, kept out of the curated gate because it is slow and binary-dependent).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { resolveChromeBinary } = require('../../src/media/headless-chrome-cdp')

/**
 * Create a fake Chrome-for-Testing cache layout:
 * <root>/chrome/<versionDir>/chrome-linux64/chrome (executable).
 * @param {string} cacheRoot
 * @param {string} versionDir
 * @returns {string} path to the fake chrome executable
 */
function makeCachedChrome(cacheRoot, versionDir) {
	const binDir = path.join(cacheRoot, versionDir, 'chrome-linux64')
	fs.mkdirSync(binDir, { recursive: true })
	const bin = path.join(binDir, 'chrome')
	fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n')
	fs.chmodSync(bin, 0o755)
	return bin
}

describe('WO-248 resolveChromeBinary precedence', () => {
	let tmp

	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo248-chrome-resolve-'))
	})

	after(() => {
		try {
			fs.rmSync(tmp, { recursive: true, force: true })
		} catch (_) {}
	})

	it('HIGHASCG_CHROME_BIN env override wins over the cache', () => {
		const cacheRoot = path.join(tmp, 'cache-a')
		makeCachedChrome(cacheRoot, 'linux-150.0.7871.24')
		const envBin = path.join(tmp, 'my-chrome')
		fs.writeFileSync(envBin, '#!/bin/sh\nexit 0\n')
		fs.chmodSync(envBin, 0o755)

		const resolved = resolveChromeBinary({
			env: { HIGHASCG_CHROME_BIN: envBin, PATH: '' },
			cacheRoot,
			pathDirs: [],
		})
		assert.equal(resolved, envBin)
	})

	it('throws a clear error when HIGHASCG_CHROME_BIN points at a missing path', () => {
		assert.throws(
			() =>
				resolveChromeBinary({
					env: { HIGHASCG_CHROME_BIN: path.join(tmp, 'does-not-exist'), PATH: '' },
					cacheRoot: path.join(tmp, 'nope'),
					pathDirs: [],
				}),
			/HIGHASCG_CHROME_BIN.*does not exist/,
		)
	})

	it('picks the newest version dir from the cache when no env override', () => {
		const cacheRoot = path.join(tmp, 'cache-b')
		makeCachedChrome(cacheRoot, 'linux-149.0.7827.22')
		const newest = makeCachedChrome(cacheRoot, 'linux-150.0.7871.24')
		// A non-version dir must be ignored, not crash the sort.
		fs.mkdirSync(path.join(cacheRoot, 'notes'), { recursive: true })

		const resolved = resolveChromeBinary({ env: { PATH: '' }, cacheRoot, pathDirs: [] })
		assert.equal(resolved, newest)
	})

	it('numeric (not lexical) version ordering: 150 beats 99', () => {
		const cacheRoot = path.join(tmp, 'cache-c')
		makeCachedChrome(cacheRoot, 'linux-99.0.1000.0')
		const newest = makeCachedChrome(cacheRoot, 'linux-150.0.7871.24')
		const resolved = resolveChromeBinary({ env: { PATH: '' }, cacheRoot, pathDirs: [] })
		assert.equal(resolved, newest)
	})

	it('falls back to a chromium/google-chrome binary on PATH', () => {
		const pathDir = path.join(tmp, 'pathbin')
		fs.mkdirSync(pathDir, { recursive: true })
		const chromium = path.join(pathDir, 'chromium-browser')
		fs.writeFileSync(chromium, '#!/bin/sh\nexit 0\n')
		fs.chmodSync(chromium, 0o755)

		const resolved = resolveChromeBinary({
			env: { PATH: '' },
			cacheRoot: path.join(tmp, 'empty-cache'),
			pathDirs: [pathDir],
		})
		assert.equal(resolved, chromium)
	})

	it('throws a helpful listing error when nothing is found', () => {
		assert.throws(
			() =>
				resolveChromeBinary({
					env: { PATH: '' },
					cacheRoot: path.join(tmp, 'still-empty'),
					pathDirs: [],
				}),
			/No Chrome binary found.*HIGHASCG_CHROME_BIN.*chromium/s,
		)
	})
})
