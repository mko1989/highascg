/**
 * Optional module loading and vendor directory mounting.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const moduleRegistry = require('../module-registry')

function loadOptionalModules(config, log) {
	log('info', '[modules] PixelWeb module enabled — attempting to load.')
	moduleRegistry.tryLoad('pixelweb', log)

	const envFlag = process.env.HIGHASCG_PREVIS
	const previsEnabled = envFlag === '1' || String(envFlag).toLowerCase() === 'true' || (config?.features?.previs3d === true)
	if (previsEnabled) {
		log('info', '[modules] Previs/tracking module enabled — attempting to load previs, tracking, autofollow.')
		for (const name of ['previs', 'tracking', 'autofollow']) {
			moduleRegistry.tryLoad(name, log)
		}
	} else {
		log('info', '[modules] Previs/tracking module disabled (set HIGHASCG_PREVIS=1 or config.features.previs3d=true to enable).')
	}

	const cgStudioFlag = process.env.HIGHASCG_CG_STUDIO
	const cgStudioEnabled = cgStudioFlag === '1' || String(cgStudioFlag).toLowerCase() === 'true' || (config?.features?.cgStudio === true)
	if (cgStudioEnabled) {
		log('info', '[modules] Template Editor (cg-studio) module enabled — attempting to load.')
		moduleRegistry.tryLoad('cg-studio', log)
	} else {
		log('info', '[modules] Template Editor module disabled (set HIGHASCG_CG_STUDIO=1 or config.features.cgStudio=true to enable).')
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
