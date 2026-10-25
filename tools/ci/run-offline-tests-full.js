#!/usr/bin/env node
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const { collectOfflineTestFiles } = require('./collect-offline-tests')

const REPO_ROOT = path.resolve(__dirname, '../..')
const files = collectOfflineTestFiles()

if (!files.length) {
	console.error('[test:ci:full] no test files collected')
	process.exit(1)
}

console.log(`[test:ci:full] running ${files.length} offline test file(s)`)
const rel = files.map((f) => path.relative(REPO_ROOT, f))
// a flag, not an env: node --test never read NODE_TEST_TIMEOUT (WO-756). No --test-force-exit: it drops tests silently
const testTimeout = `--test-timeout=${process.env.NODE_TEST_TIMEOUT || '120000'}`
const result = spawnSync(process.execPath, ['--test', testTimeout, ...rel], {
	cwd: REPO_ROOT,
	stdio: 'inherit',
})

process.exit(result.status === null ? 1 : result.status)
