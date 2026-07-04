'use strict'

/**
 * Eggs build / exFAT bundle entry — re-exports runtime factory-starter (src/config/).
 * Keeps write-iso-default-config.js and write-exfat-starter-bundle.js paths stable.
 */

const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../../..')

module.exports = {
	REPO_ROOT,
	...require(path.join(REPO_ROOT, 'src/config/factory-starter')),
}
