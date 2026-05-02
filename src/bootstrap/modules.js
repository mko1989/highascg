/**
 * Optional module loading and vendor directory mounting.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const moduleRegistry = require('../module-registry')

function loadOptionalModules(config, log) {
	const envFlag = process.env.HIGHASCG_PREVIS
	const previsEnabled = envFlag === '1' || String(envFlag).toLowerCase() === 'true' || (config?.features?.previs3d === true)
	if (!previsEnabled) {
		log('info', '[modules] Previs/tracking module disabled (set HIGHASCG_PREVIS=1 or config.features.previs3d=true to enable).')
		return
	}
	log('info', '[modules] Previs/tracking module enabled — attempting to load previs, tracking, autofollow.')
	for (const name of ['previs', 'tracking', 'autofollow']) {
		moduleRegistry.tryLoad(name, log)
	}
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
	return out
}

module.exports = { loadOptionalModules, buildVendorDirs }
