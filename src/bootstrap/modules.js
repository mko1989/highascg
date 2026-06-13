/**
 * Optional module loading and vendor directory mounting.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const moduleRegistry = require('../module-registry')
const pluginManager = require('../plugins/plugin-manager')

function loadOptionalModules(config, log) {
	pluginManager.loadEnabledPlugins(config, log)
}

function buildVendorDirs(logger) {
	const out = {}
	if (moduleRegistry.isLoaded && moduleRegistry.isLoaded('previs')) {
		const threeRoot = path.join(REPO_ROOT, 'node_modules', 'three')
		try {
			if (fs.existsSync(path.join(threeRoot, 'build', 'three.module.js'))) {
				out['/vendor/three/'] = threeRoot
			} else {
				logger.warn('[modules] previs enabled but `three` is not installed — run `npm run install:previs`.')
				out['/vendor/three/'] = threeRoot
			}
		} catch {}
	}
	try {
		const htmlToImageRoot = path.join(REPO_ROOT, 'node_modules', 'html-to-image')
		if (fs.existsSync(path.join(htmlToImageRoot, 'es', 'index.js'))) {
			out['/vendor/html-to-image/'] = htmlToImageRoot
		}
	} catch {}
	// cg-studio editor (grapesjs) runs in highascg-client — server only exposes /api/cg-studio/*.
	return out
}

module.exports = { loadOptionalModules, buildVendorDirs }
