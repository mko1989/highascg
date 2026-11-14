'use strict'

/**
 * WO-1076 — where external (opt-in, separately installed) HighAsCG modules live.
 *
 *   repo      <repo>/modules/<name>/            dev checkout (synced source; the server never writes here)
 *   installed ~/.highascg/modules/<name>/       unpacked by POST /api/modules/install (outside the synced repo)
 *   state     ~/.highascg/modules.json          { "<name>": { "enabled": true } } — next to the installs, so a
 *                                               settings save (hand-listed newConfig) can never revert it and
 *                                               Syncthing never fights it
 *
 * Overrides: HIGHASCG_MODULES_REPO_DIR, HIGHASCG_MODULES_DIR, HIGHASCG_MODULES_STATE_FILE. Under the Node test runner
 * (NODE_TEST_CONTEXT) every default is a private temp dir per process (projects-root.js pattern): a smoke never reads
 * or writes the box's real ~/.highascg or repo modules/.
 */

const os = require('os')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { underTestRunner } = require('../engine/projects-root')

let _testRoot = null

/** A per-process path, NOT created here: reads of a missing dir are "no modules"; writers mkdir on demand. */
function testRoot() {
	if (!_testRoot) _testRoot = path.join(os.tmpdir(), `highascg-test-modules-${process.pid}-${require('crypto').randomBytes(4).toString('hex')}`)
	return _testRoot
}

/** @returns {string} the dev-checkout module dir (repo `modules/`) */
function repoModulesDir() {
	if (process.env.HIGHASCG_MODULES_REPO_DIR) return path.resolve(process.env.HIGHASCG_MODULES_REPO_DIR)
	if (underTestRunner()) return path.join(testRoot(), 'repo-modules')
	return path.join(REPO_ROOT, 'modules')
}

/** @returns {string} the installed-module dir (~/.highascg/modules) */
function installedModulesDir() {
	if (process.env.HIGHASCG_MODULES_DIR) return path.resolve(process.env.HIGHASCG_MODULES_DIR)
	if (underTestRunner()) return path.join(testRoot(), 'installed-modules')
	return path.join(os.homedir(), '.highascg', 'modules')
}

/** @returns {string} the enabled-state file */
function modulesStateFile() {
	if (process.env.HIGHASCG_MODULES_STATE_FILE) return path.resolve(process.env.HIGHASCG_MODULES_STATE_FILE)
	if (underTestRunner()) return path.join(testRoot(), 'modules.json')
	return path.join(os.homedir(), '.highascg', 'modules.json')
}

module.exports = { repoModulesDir, installedModulesDir, modulesStateFile }
