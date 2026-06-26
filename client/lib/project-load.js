/**
 * Load project from server — normalize API shapes and try GET before POST load.
 */

import { api } from './api-client.js'

/**
 * @param {unknown} res
 * @returns {object|null}
 */
export function normalizeProjectPayload(res) {
	if (!res || typeof res !== 'object') return null
	const r = /** @type {Record<string, unknown>} */ (res)
	if (r.error) return null
	if (typeof r.version === 'number') return r
	const nested = r.project
	if (nested && typeof nested === 'object' && typeof /** @type {object} */ (nested).version === 'number') {
		return /** @type {object} */ (nested)
	}
	return null
}

/**
 * @returns {Promise<object>}
 */
export async function fetchProjectFromServer() {
	try {
		const getRes = await api.get('/api/project')
		const fromGet = normalizeProjectPayload(getRes)
		if (fromGet) return fromGet
	} catch {
		/* try POST load next */
	}
	const postRes = await api.post('/api/project/load', {})
	const fromPost = normalizeProjectPayload(postRes)
	if (fromPost) return fromPost
	const err =
		postRes && typeof postRes === 'object' && 'error' in postRes
			? String(/** @type {{ error?: string }} */ (postRes).error)
			: 'No project stored on server'
	throw new Error(err)
}
