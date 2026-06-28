'use strict'

const fs = require('fs')
const path = require('path')

/**
 * @param {string} dir
 * @returns {string|null}
 */
function readBuildStampFromDir(dir) {
	if (!dir || !fs.existsSync(dir)) return null
	const stampPath = path.join(dir, 'BUILD_STAMP')
	try {
		if (fs.existsSync(stampPath)) {
			const v = fs.readFileSync(stampPath, 'utf8').trim()
			if (v) return v
		}
	} catch {
		/* ignore */
	}
	const legacy = path.join(dir, '.highascg-build-stamp')
	try {
		if (fs.existsSync(legacy)) {
			const v = fs.readFileSync(legacy, 'utf8').trim()
			if (v) return v
		}
	} catch {
		/* ignore */
	}
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
		const v = String(pkg?.version || '').trim()
		return v || null
	} catch {
		return null
	}
}

/**
 * ISO8601 UTC stamps sort lexicographically.
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {number} negative if a < b, positive if a > b, 0 if equal/unknown
 */
function compareBuildStamps(a, b) {
	const sa = String(a || '').trim()
	const sb = String(b || '').trim()
	if (!sa && !sb) return 0
	if (!sa) return -1
	if (!sb) return 1
	if (sa === sb) return 0
	return sa < sb ? -1 : 1
}

/**
 * @param {string} assetName e.g. highascg-server_2026-06-28T143022Z.tar.gz
 * @returns {string|null}
 */
function parseServerReleaseAssetStamp(assetName) {
	const m = String(assetName || '').match(/^highascg-server_(.+)\.tar\.gz$/i)
	return m ? m[1] : null
}

module.exports = {
	readBuildStampFromDir,
	compareBuildStamps,
	parseServerReleaseAssetStamp,
}
