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
const result = spawnSync(process.execPath, ['--test', ...rel], {
	cwd: REPO_ROOT,
	stdio: 'inherit',
	env: { ...process.env, NODE_TEST_TIMEOUT: process.env.NODE_TEST_TIMEOUT || '120000' },
})

process.exit(result.status === null ? 1 : result.status)
