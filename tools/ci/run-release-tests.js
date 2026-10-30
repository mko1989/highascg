#!/usr/bin/env node
'use strict'

/**
 * WO-836 — `npm run test:release`: the pre-release / pre-PR command. Three groups, run in order, never stopping at the
 * first failure (a release run wants the whole picture), then a summary and a non-zero exit if anything failed:
 *
 *   1. offline   npm run test:ci        — the curated hermetic suite (what CI runs)
 *   2. live      npm run test:live      — tests that act on the real box (HIGHASCG_LIVE_TESTS=1, tools/test-live/)
 *   3. gui       npm run test:release-gui — the sandboxed Godot GUI e2e (WO-719 scenarios) plus the screenshot +
 *                                         Caspar PRINT scenario against a throwaway Caspar (WO-836 part 3)
 *
 *   node tools/ci/run-release-tests.js                   # all three
 *   node tools/ci/run-release-tests.js --skip=gui        # comma list of: offline, live, gui
 *   node tools/ci/run-release-tests.js --only=live
 */
const { spawnSync } = require('child_process')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')

const GROUPS = [
	{ id: 'offline', label: 'offline suite (test:ci)', script: 'tools/ci/run-offline-tests.js' },
	{ id: 'live', label: 'live box (test:live)', script: 'tools/test-live/run-live-tests.js' },
	{ id: 'gui', label: 'GUI release suite (test:release-gui)', script: 'tools/e2e/run-release-gui.js' },
]

const arg = (k) => {
	const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
	return hit ? hit.split('=')[1].split(',').filter(Boolean) : []
}
const only = arg('only')
const skip = arg('skip')
const unknown = [...only, ...skip].filter((id) => !GROUPS.some((g) => g.id === id))
if (unknown.length) {
	console.error(`[test:release] unknown group(s): ${unknown.join(', ')} (known: ${GROUPS.map((g) => g.id).join(', ')})`)
	process.exit(2)
}

const results = []
for (const g of GROUPS) {
	if ((only.length && !only.includes(g.id)) || skip.includes(g.id)) {
		results.push({ ...g, status: 'skipped', ms: 0 })
		continue
	}
	console.log(`\n[test:release] ===== ${g.label} =====`)
	const t0 = Date.now()
	const r = spawnSync(process.execPath, [path.join(REPO_ROOT, g.script)], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
		env: process.env,
	})
	results.push({
		...g,
		status: r.status === 0 ? 'pass' : 'FAIL',
		code: r.status === null ? `signal ${r.signal}` : r.status,
		ms: Date.now() - t0,
	})
}

console.log('\n[test:release] summary')
for (const r of results) {
	const detail =
		r.status === 'skipped' ? '' : `${(r.ms / 1000).toFixed(0)}s${r.status === 'FAIL' ? `, exit ${r.code}` : ''}`
	console.log(`  ${r.status.toUpperCase().padEnd(7)} ${r.label.padEnd(28)} ${detail}`)
}
const failed = results.filter((r) => r.status === 'FAIL')
console.log(
	failed.length
		? `\n[test:release] NOT READY — ${failed.length} group(s) failed`
		: '\n[test:release] all run groups passed'
)
process.exit(failed.length ? 1 : 0)
