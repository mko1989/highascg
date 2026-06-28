/**
 * Project media folder location — mirrors server project-media-location.js.
 */

/** @typedef {'internal' | 'exfat' | 'bridge'} ProjectMediaLocation */

/**
 * @param {unknown} loc
 * @returns {ProjectMediaLocation}
 */
export function normalizeProjectMediaLocation(loc) {
	const s = String(loc || 'internal')
		.trim()
		.toLowerCase()
	if (s === 'exfat' || s === 'bridge') return s
	return 'internal'
}

/**
 * @param {object} [settings]
 * @returns {string}
 */
export function getProjectMediaRelPrefix(settings) {
	const loc = normalizeProjectMediaLocation(settings?.projectScopedMedia?.location)
	if (loc === 'exfat') return 'exfat/projects'
	if (loc === 'bridge') return 'bridge/projects'
	return 'projects'
}

/**
 * @param {string} slug
 * @param {object} [settings]
 * @returns {string}
 */
export function getProjectMediaRelId(slug, settings) {
	const s = String(slug || '').trim()
	if (!s) return ''
	return `${getProjectMediaRelPrefix(settings)}/${s}`
}

/**
 * @param {string} slug
 * @param {object} [settings]
 * @returns {string[]}
 */
export function projectMediaIdPrefixesForSlug(slug, settings) {
	const s = String(slug || '').trim()
	if (!s) return []
	const seen = new Set()
	const out = []
	for (const prefix of [
		`${getProjectMediaRelId(s, settings)}/`,
		`projects/${s}/`,
		`exfat/projects/${s}/`,
		`bridge/projects/${s}/`,
	]) {
		if (!seen.has(prefix)) {
			seen.add(prefix)
			out.push(prefix)
		}
	}
	return out
}
