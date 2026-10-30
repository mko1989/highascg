'use strict'

/**
 * WO-836: load src/shaderfx/shader-store.js bound to a TEMP repo root.
 * The store derives data/shaders + template/shaders from REPO_ROOT at require time (no env override), so a smoke that
 * saved/deleted/reconciled wrote into the live box's Syncthing-synced shader dirs (wo266 / wo379 / wo577). Here
 * template/shaders is COPIED from the repo (reconcile recovers data/shaders from those tracked .html files, which is
 * what those tests rely on) and data/shaders starts empty — every write lands in the temp dir.
 *
 * Call before anything else requires shader-store (the require cache then hands every later importer the temp-bound
 * module, e.g. routes-shaders).
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const repoPaths = require('../../../src/repo-paths')

function loadShaderStoreInTempRoot() {
	const real = repoPaths.REPO_ROOT
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-shader-store-'))
	fs.mkdirSync(path.join(root, 'data', 'shaders'), { recursive: true })
	fs.cpSync(path.join(real, 'template', 'shaders'), path.join(root, 'template', 'shaders'), { recursive: true })
	// deps first, so only shader-store sees the temp root
	require('../../../src/utils/atomic-file-write')
	require('../../../src/shaderfx/shader-template-export')
	const storePath = require.resolve('../../../src/shaderfx/shader-store')
	delete require.cache[storePath]
	repoPaths.REPO_ROOT = root
	let store
	try {
		store = require(storePath)
	} finally {
		repoPaths.REPO_ROOT = real
	}
	if (!store.SHADERS_DATA_DIR.startsWith(root)) throw new Error('shader-store did not bind to the temp root')
	return { store, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

module.exports = { loadShaderStoreInTempRoot }
