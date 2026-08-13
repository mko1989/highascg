'use strict'

/**
 * WO-512 — every directory exclude used by an update must be ANCHORED.
 *
 * An rsync pattern without a leading `/` matches at any depth. The manual procedure's
 * `--exclude 'config/'` therefore excluded `src/config/` as well as the live `config/`, so a release
 * delivered the new `src/api/routes-sources.js` but not the `src/config/source-labels.js` it
 * requires — `MODULE_NOT_FOUND`, restart loop, box down.
 *
 * The shipped excludes file had the same class of bug, live and unnoticed: bare `media/` also
 * matched `src/media/` (production code) and bare `lib/` also matched `scripts/lib/` (shipped
 * scripts), so those two directories were silently skipped by EVERY update.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** Any-depth matching is deliberate for these two: never sync a dep tree or a git dir. */
const INTENTIONALLY_UNANCHORED = new Set(['node_modules/', '.git/'])

function excludeLines() {
	return read('config/server-update-rsync-excludes.txt')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'))
}

test('WO-512: every exclude is anchored, path-qualified, or a declared exception', () => {
	const offenders = []
	for (const line of excludeLines()) {
		if (INTENTIONALLY_UNANCHORED.has(line)) continue
		if (line.startsWith('/')) continue
		// A pattern containing a slash before the end is matched against the full path by rsync,
		// so `tools/eggs/` and `config/casparcg.config` are already effectively anchored.
		const withoutTrailing = line.endsWith('/') ? line.slice(0, -1) : line
		if (withoutTrailing.includes('/')) continue
		offenders.push(line)
	}
	assert.deepEqual(
		offenders,
		[],
		`unanchored single-component excludes match at ANY depth: ${JSON.stringify(offenders)}`,
	)
})

test('WO-512: the two directories this actually broke are anchored', () => {
	const lines = excludeLines()
	// bare `media/` swallowed src/media/, bare `lib/` swallowed scripts/lib/ — both real, both shipped.
	assert.ok(lines.includes('/media/'), 'media must be anchored or it also excludes src/media/')
	assert.ok(lines.includes('/lib/'), 'lib must be anchored or it also excludes scripts/lib/')
	assert.ok(!lines.includes('media/'), 'the unanchored form must be gone')
	assert.ok(!lines.includes('lib/'), 'the unanchored form must be gone')
})

test('WO-512: the deliberate any-depth exceptions survive', () => {
	const lines = excludeLines()
	assert.ok(lines.includes('node_modules/'), 'a dependency tree must never sync, at any depth')
	assert.ok(lines.includes('.git/'), 'nor a git dir')
})

test('WO-512: excluding a directory must never hide production source', () => {
	// The failure mode is structural, not textual: if an exclude names a directory that also exists
	// nested under src/ or scripts/, an unanchored form would skip real code.
	const nestedRisk = ['config', 'media', 'lib', 'data', 'bin']
	for (const name of nestedRisk) {
		const bare = `${name}/`
		assert.ok(
			!excludeLines().includes(bare),
			`'${bare}' unanchored would also exclude nested ${name}/ directories that ship`,
		)
	}
})

test('WO-512: the manual procedure documents anchored excludes', () => {
	const doc = read('tools/ci/HOW_TO_UPDATE_HIGHASCG.md')
	// Assert on the RUNNABLE block only — the prose above it quotes the broken form on purpose to
	// explain the outage, and a naive doesNotMatch over the whole file trips on its own warning.
	const cmd = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n')
	assert.ok(cmd.includes('rsync'), 'the doc must still contain a runnable rsync')
	for (const p of ['/config/', '/media/', '/lib/', '/data/', '/bin/', '/projects/']) {
		assert.ok(cmd.includes(`--exclude '${p}'`), `${p} must be anchored in the command`)
	}
	for (const bare of ['config/', 'media/', 'lib/', 'data/', 'bin/', 'projects/']) {
		assert.ok(
			!cmd.includes(`--exclude '${bare}'`),
			`the unanchored --exclude '${bare}' is what took the box down; it must not be runnable`,
		)
	}
	assert.match(doc, /any depth/i, 'and it must say WHY, or the slashes get "tidied" away again')
})
