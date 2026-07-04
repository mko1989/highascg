'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const SYSTEM_LICENSES = '/usr/share/doc/highascg/licenses'

/**
 * Resolve directory containing licenses/manifest.json for API + static serving.
 * @returns {string}
 */
function resolveLicensesDir() {
	if (process.env.HIGHASCG_LICENSES_DIR) {
		return path.resolve(process.env.HIGHASCG_LICENSES_DIR)
	}
	if (fs.existsSync(path.join(SYSTEM_LICENSES, 'manifest.json'))) {
		return SYSTEM_LICENSES
	}
	const repoLicenses = path.join(REPO_ROOT, 'licenses')
	if (fs.existsSync(path.join(repoLicenses, 'manifest.json'))) {
		return repoLicenses
	}
	try {
		const st = fs.lstatSync(path.join(REPO_ROOT, 'licenses'))
		if (st.isSymbolicLink()) return fs.realpathSync(path.join(REPO_ROOT, 'licenses'))
	} catch {
		/* ignore */
	}
	return repoLicenses
}

module.exports = { SYSTEM_LICENSES, resolveLicensesDir }
