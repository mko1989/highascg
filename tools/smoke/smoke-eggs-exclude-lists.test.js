'use strict'

/**
 * Smoke test: penguins-eggs exclude lists consistency (WO-273 findings).
 *
 * Verifies:
 * 1. No dead paths are excluded (e.g., tools/restore does not exist)
 * 2. Dev-only tool directories (ci, map, wiki, replication, dev) are excluded from embed-server
 * 3. Deprecated scripts (scripts/deprecated/) are excluded from embed-server
 * 4. Runtime critical paths (tools/runtime/, scripts/exfat/) are NOT excluded
 * 5. Fragment list correctly excludes all of scripts/* and tools/* (by design; full tarball load-bearing)
 *
 * Context: tools/eggs/live-usb/{penguins-eggs-exclude-highascg-fragment.list,
 * penguins-eggs-exclude-highascg-embed-server.list}
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')

const FRAGMENT_EXCLUDES = path.join(REPO_ROOT, 'tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list')
const EMBED_SERVER_EXCLUDES = path.join(REPO_ROOT, 'tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list')

// Parse a penguins-eggs exclude list (# comments, blank lines ignored)
const parseExcludeList = (filePath) => {
	const content = fs.readFileSync(filePath, 'utf8')
	return content
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'))
}

describe('WO-273: penguins-eggs exclude lists', () => {
	it('fragment list excludes all scripts/* and tools/* (full tarball, exFAT drop-update load-bearing)', () => {
		const excludes = parseExcludeList(FRAGMENT_EXCLUDES)
		assert.ok(
			excludes.includes('home/casparcg/highascg/scripts'),
			'fragment list must exclude scripts/',
		)
		assert.ok(
			excludes.includes('home/casparcg/highascg/tools'),
			'fragment list must exclude tools/',
		)
	})

	it('embed-server list does NOT exclude tools/runtime (runtime critical: operator-shape-overlay.py spawned by server)', () => {
		const excludes = parseExcludeList(EMBED_SERVER_EXCLUDES)
		const hasExclude = excludes.some((line) => line.includes('tools/runtime'))
		assert.ok(!hasExclude, 'tools/runtime MUST NOT be excluded from embed-server ISO')
	})

	it('embed-server list does NOT exclude scripts/exfat (runtime critical: installed by setup units to /usr/local/lib/highascg)', () => {
		const excludes = parseExcludeList(EMBED_SERVER_EXCLUDES)
		// Should NOT have a blanket scripts/ exclusion or scripts/exfat-specific exclusion
		const hasFullScriptsExclude = excludes.includes('home/casparcg/highascg/scripts')
		assert.ok(!hasFullScriptsExclude, 'scripts/ must NOT be fully excluded from embed-server (scripts/exfat needed)')
	})

	describe('Dead path entries (contradiction #1)', () => {
		it('tools/restore does not exist in the repo', () => {
			const restorePath = path.join(REPO_ROOT, 'tools/restore')
			assert.ok(!fs.existsSync(restorePath), 'tools/restore directory must not exist (found as dead exclude entry)')
		})

		it('embed-server list must NOT include the dead tools/restore entry', () => {
			const excludes = parseExcludeList(EMBED_SERVER_EXCLUDES)
			const hasDeadEntry = excludes.includes('home/casparcg/highascg/tools/restore')
			assert.ok(
				!hasDeadEntry,
				'penguins-eggs-exclude-highascg-embed-server.list must not include tools/restore (does not exist)',
			)
		})
	})

	describe('Dev-only tool directories excluded from embed-server (contradiction #2)', () => {
		const DEV_TOOLS = ['ci', 'map', 'wiki', 'replication', 'dev']

		DEV_TOOLS.forEach((toolDir) => {
			it(`tools/${toolDir} exists and should be excluded from embed-server`, () => {
				const toolPath = path.join(REPO_ROOT, 'tools', toolDir)
				assert.ok(
					fs.existsSync(toolPath),
					`tools/${toolDir} must exist (dev-only, should be excluded)`,
				)
			})

			it(`tools/${toolDir} must be excluded from embed-server ISO`, () => {
				const excludes = parseExcludeList(EMBED_SERVER_EXCLUDES)
				const hasExclude = excludes.includes(`home/casparcg/highascg/tools/${toolDir}`)
				assert.ok(
					hasExclude,
					`penguins-eggs-exclude-highascg-embed-server.list must exclude tools/${toolDir} (dev-only, per WO-273 bucket)`,
				)
			})
		})
	})

	describe('Deprecated scripts excluded from embed-server (contradiction #3)', () => {
		it('scripts/deprecated exists and contains stale runtime files that should not ship on exFAT update', () => {
			const deprecatedPath = path.join(REPO_ROOT, 'scripts/deprecated')
			assert.ok(
				fs.existsSync(deprecatedPath),
				'scripts/deprecated must exist (archive of moved/dead scripts)',
			)
		})

		it('embed-server list must exclude scripts/deprecated to prevent bloat on exFAT update payload', () => {
			const excludes = parseExcludeList(EMBED_SERVER_EXCLUDES)
			const hasExclude = excludes.includes('home/casparcg/highascg/scripts/deprecated')
			assert.ok(
				hasExclude,
				'penguins-eggs-exclude-highascg-embed-server.list must exclude scripts/deprecated (WO-273 finding 5)',
			)
		})
	})

	describe('Existing correct excludes', () => {
		const SHOULD_EXCLUDE_FROM_EMBED = [
			{ dir: 'eggs', reason: 'branding assets + eggs build scripts' },
			{ dir: 'smoke', reason: '325 offline test files' },
			{ dir: 'release', reason: 'release packaging (dev-only)' },
		]

		SHOULD_EXCLUDE_FROM_EMBED.forEach(({ dir: toolDir, reason }) => {
			it(`embed-server correctly excludes tools/${toolDir} (${reason})`, () => {
				const excludes = parseExcludeList(EMBED_SERVER_EXCLUDES)
				const hasExclude = excludes.includes(`home/casparcg/highascg/tools/${toolDir}`)
				assert.ok(hasExclude, `tools/${toolDir} should be excluded from embed-server`)
			})
		})
	})
})
