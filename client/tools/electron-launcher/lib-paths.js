'use strict'

const fs = require('fs')
const path = require('path')

const LAUNCHER_DIR = path.resolve(__dirname)
const REPO_ROOT = path.resolve(LAUNCHER_DIR, '../../..')

/**
 * @returns {string}
 */
function getRepoRoot() {
	return REPO_ROOT
}

/**
 * First existing dist-web/ (bundled copy next to launcher, then repo build output).
 * @returns {{ root: string, indexHtml: string } | null}
 */
function resolveDistWeb() {
	const candidates = [
		path.join(LAUNCHER_DIR, 'dist-web'),
		path.join(REPO_ROOT, 'dist-web'),
	]
	for (const root of candidates) {
		const indexHtml = path.join(root, 'index.html')
		if (fs.existsSync(indexHtml)) {
			return { root, indexHtml }
		}
	}
	return null
}

module.exports = { LAUNCHER_DIR, REPO_ROOT, getRepoRoot, resolveDistWeb }
