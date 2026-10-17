'use strict'

/**
 * Where show projects live. One source of truth for project-store and project-volume-sync.
 *
 * Under the Node test runner (`node --test` sets NODE_TEST_CONTEXT in every test process) the
 * default is a private temp dir per process: smokes that ran the real New-project / persist paths
 * used to rewrite the LIVE `projects/untitled.json` (and push it to the bridge volume) on every
 * offline-suite run — WO-617 investigation, 2026-10-17. HIGHASCG_PROJECTS_DIR overrides both.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const LIVE_PROJECTS_DIR = path.join(REPO_ROOT, 'projects')
let _testDir = null

function underTestRunner() {
	return Boolean(process.env.NODE_TEST_CONTEXT)
}

function projectsRoot() {
	if (process.env.HIGHASCG_PROJECTS_DIR) return path.resolve(process.env.HIGHASCG_PROJECTS_DIR)
	if (underTestRunner()) {
		if (!_testDir) _testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-test-projects-'))
		return _testDir
	}
	return LIVE_PROJECTS_DIR
}

/** Bridge / USB project pushes and pulls touch real mounted volumes — never from a test process. */
function volumeSyncAllowed() {
	return !underTestRunner() || process.env.HIGHASCG_TEST_ALLOW_VOLUMES === '1'
}

module.exports = { projectsRoot, volumeSyncAllowed, underTestRunner, LIVE_PROJECTS_DIR }
