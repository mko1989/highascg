'use strict'

/**
 * Shared source-reader for the smoke-wo256-operator-compose-tiles*.test.js split. Not itself a
 * test file (no `.test.` in the name) so tools/ci/collect-offline-tests.js never picks it up.
 *
 * client/components/operator-compose-tiles.js was split (line-count refactor) into
 * operator-compose-tiles.js plus sibling operator-compose-tiles-*.js modules it imports from.
 * Source-grep assertions across the WO-256 smoke family check behavior that now lives in one of
 * those siblings — read the whole split family concatenated so this keeps working regardless of
 * which file a given piece of logic ended up in (same pattern as
 * tools/smoke/smoke-decklink-input-retry.test.js's multi-file `src`).
 */

const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.join(__dirname, '../../..')

function readOperatorComposeTiles() {
	const dir = path.join(REPO_ROOT, 'client/components')
	const files = fs
		.readdirSync(dir)
		.filter((f) => f === 'operator-compose-tiles.js' || f.startsWith('operator-compose-tiles-'))
		.sort()
	return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
}

module.exports = { readOperatorComposeTiles, REPO_ROOT }
