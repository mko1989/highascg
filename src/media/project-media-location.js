/**
 * Project media folder location — internal media root, exFAT stick, or bridge partition.
 */
'use strict'

/** @typedef {'internal' | 'exfat' | 'bridge'} ProjectMediaLocation */

/**
 * @param {unknown} loc
 * @returns {ProjectMediaLocation}
 */
function normalizeProjectMediaLocation(loc) {
	const s = String(loc || 'internal')
		.trim()
		.toLowerCase()
	if (s === 'exfat' || s === 'bridge') return s
	return 'internal'
}

/**
 * Relative path under Caspar media root for all project folders (no slug).
 * @param {object} [config]
 * @returns {string}
 */
function getProjectMediaRelPrefix(config) {
	const loc = normalizeProjectMediaLocation(config?.projectScopedMedia?.location)
	if (loc === 'exfat') return 'exfat/projects'
	if (loc === 'bridge') return 'bridge/projects'
	return 'projects'
}

/**
 * @param {string} slug
 * @param {object} [config]
 * @returns {string}
 */
function getProjectMediaRelId(slug, config) {
	const s = String(slug || '').trim()
	if (!s) return ''
	return `${getProjectMediaRelPrefix(config)}/${s}`
}

module.exports = {
	normalizeProjectMediaLocation,
	getProjectMediaRelPrefix,
	getProjectMediaRelId,
}
