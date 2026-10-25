#!/usr/bin/env node
'use strict'

/**
 * Curated offline CI test bundle — fast enough for push/PR (< ~3 min).
 * Full offline discovery: node tools/ci/collect-offline-tests.js
 * Full run (slow): npm run test:ci:full
 */
const { spawnSync } = require('child_process')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')

const FILES = require('./offline-test-files')

console.log(`[test:ci] running ${FILES.length} curated offline test file(s)`)

// WO-383 (check-tdz-reads): a temporal-dead-zone read renders a TypeError instead of the page it is
// on — cheap to catch statically, expensive to find on the glass.
for (const check of ['check-dom-escape-duplicates.js', 'check-tdz-reads.js']) {
	const r = spawnSync(process.execPath, [path.join(__dirname, check)], { cwd: REPO_ROOT, stdio: 'inherit' })
	if (r.status !== 0) process.exit(r.status === null ? 1 : r.status)
}

// node --test takes the per-test timeout only as a flag; it never read the NODE_TEST_TIMEOUT env this used to set.
// Not --test-force-exit: it ended files early and silently (3299–3322 tests per run, 0 failures) — WO-756
const testTimeout = `--test-timeout=${process.env.NODE_TEST_TIMEOUT || '60000'}`
const result = spawnSync(process.execPath, ['--test', testTimeout, ...FILES], {
	cwd: REPO_ROOT,
	stdio: 'inherit',
	env: {
		...process.env,
		/* The WS reconnect smoke spawns a FULL highascg server — never do that from the
		 * curated gate on a production box (it piles up orphaned servers and can touch the
		 * live Caspar). Run it explicitly without this env when integration coverage is wanted. */
		HIGHASCG_SKIP_SERVER_INTEGRATION: process.env.HIGHASCG_SKIP_SERVER_INTEGRATION || '1',
	},
})

process.exit(result.status === null ? 1 : result.status)
