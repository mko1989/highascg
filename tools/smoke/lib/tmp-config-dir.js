'use strict'

/**
 * WO-836: an EMPTY temp config dir for `new ConfigManager(dir).load()`. Loading the box's own config/ made a smoke depend
 * on the owner's current rig and, via load()'s first-run/migration saves (config-manager.js), able to write into live
 * runtime state. An empty dir makes load() write the factory defaults (defaults-core.js) — the baseline CI sees on a clean clone.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

function tmpConfigDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-smoke-config-'))
}

module.exports = { tmpConfigDir }
