/**
 * Runtime paths for CG Studio (launcher-hosted; template tree on HighAsCG server checkout).
 */

'use strict'

const path = require('path')

/** @type {{ packageDir: string, templateRoot: string } | null} */
let runtime = null

/**
 * @param {{ packageDir: string, templateRoot: string }} opts
 */
function configure(opts) {
	if (!opts?.packageDir || !opts?.templateRoot) {
		throw new Error('cg-studio-context: packageDir and templateRoot required')
	}
	runtime = {
		packageDir: path.resolve(opts.packageDir),
		templateRoot: path.resolve(opts.templateRoot),
	}
}

function requireRuntime() {
	if (!runtime) throw new Error('cg-studio-context: configure() not called')
	return runtime
}

function getPackageDir() {
	return requireRuntime().packageDir
}

function getTemplateRoot() {
	return requireRuntime().templateRoot
}

function getLtDir() {
	return path.join(getTemplateRoot(), 'lower-thirds')
}

function getStudioDir() {
	return path.join(getTemplateRoot(), 'studio')
}

function getPublicDir() {
	return path.join(getPackageDir(), 'public')
}

module.exports = {
	configure,
	getPackageDir,
	getTemplateRoot,
	getLtDir,
	getStudioDir,
	getPublicDir,
}
