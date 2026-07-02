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

const FILES = [
	'tools/smoke/smoke-config-manager-path.test.js',
	'tools/smoke/smoke-hardware-identity.test.js',
	'tools/smoke/smoke-new-project.test.js',
	'tools/smoke/smoke-replication-handshake.test.js',
	'tools/smoke/smoke-project-hot-backup.test.js',
	'tools/smoke/smoke-replication-pair-token.test.js',
	'tools/smoke/smoke-replication-ssh-setup.test.js',
	'tools/smoke/smoke-timeline-per-id-playback.test.js',
	'tools/smoke/smoke-timeline-playing-seek.test.js',
	'tools/smoke/smoke-timeline-pause-resume.test.js',
	'tools/smoke/smoke-device-graph-multiview-suggest.test.js',
	'tools/smoke/smoke-config-classify.js',
	'tools/smoke/smoke-streaming-channel-status.test.js',
	'tools/smoke/smoke-api-auth.test.js',
	'tools/smoke/smoke-settings-nuclear-password.test.js',
	'tools/smoke/smoke-zip-slip.test.js',
	'tools/smoke/smoke-xrandr-mode-validation.test.js',
	'tools/smoke/smoke-http-body-limit.test.js',
	'tools/smoke/smoke-parse-body-strict.test.js',
	'tools/smoke/smoke-persistence-immediate.test.js',
	'tools/smoke/smoke-wiki.test.js',
	'test/companion-control-status.test.js',
]

console.log(`[test:ci] running ${FILES.length} curated offline test file(s)`)
const result = spawnSync(process.execPath, ['--test', ...FILES], {
	cwd: REPO_ROOT,
	stdio: 'inherit',
	env: { ...process.env, NODE_TEST_TIMEOUT: process.env.NODE_TEST_TIMEOUT || '60000' },
})

process.exit(result.status === null ? 1 : result.status)
