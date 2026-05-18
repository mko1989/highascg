/**
 * Optional module loading and vendor directory mounting.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const moduleRegistry = require('../module-registry')
const pluginManager = require('../plugins/plugin-manager')

function loadOptionalModules(config, log) {
	pluginManager.loadEnabledPlugins(config, log)
}

function buildVendorDirs(logger) {
	const out = {}
	if (moduleRegistry.isLoaded && moduleRegistry.isLoaded('previs')) {
		const threeRoot = path.join(__dirname, '..', '..', 'node_modules', 'three')
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
		const htmlToImageRoot = path.join(__dirname, '..', '..', 'node_modules', 'html-to-image')
		if (fs.existsSync(path.join(htmlToImageRoot, 'es', 'index.js'))) {
			out['/vendor/html-to-image/'] = htmlToImageRoot
		}
	} catch {}
	if (moduleRegistry.isLoaded && moduleRegistry.isLoaded('cg-studio')) {
		const grapesRoot = path.join(__dirname, '..', '..', 'node_modules', 'grapesjs')
		try {
			if (fs.existsSync(path.join(grapesRoot, 'dist', 'grapes.mjs'))) {
				out['/vendor/grapesjs/'] = grapesRoot
			} else {
				logger.warn('[modules] cg-studio enabled but `grapesjs` is not installed — run `npm run install:cg-studio`.')
				out['/vendor/grapesjs/'] = grapesRoot
			}
		} catch {}
	}
	return out
}

module.exports = { loadOptionalModules, buildVendorDirs }
