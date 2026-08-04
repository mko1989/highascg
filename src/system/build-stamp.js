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
 * ISO8601 UTC stamps sort lexicographically — but the fleet mixes separators:
 * package.json fallbacks look like `2026.05.20`, release stamps like `2026-06-28_172842`.
 * In raw ASCII `-` < `.`, so a NEWER dashed stamp sorted BELOW an older dotted one and the
 * update check answered "up to date" forever (WO-424). Normalize `.`/`_`/`T` runs to `-`
 * before comparing.
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {number} negative if a < b, positive if a > b, 0 if equal/unknown
 */
function compareBuildStamps(a, b) {
	const norm = (s) => String(s || '').trim().replace(/[._T]/g, '-')
	const sa = norm(a)
	const sb = norm(b)
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
