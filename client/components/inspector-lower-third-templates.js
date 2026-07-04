/**
 * Lower-third template list cache.
 */

import { api } from '../lib/api-client.js'

/** @type {{ id: string, name: string, htmlPath: string, available: boolean }[] | null} */
let _cachedTemplates = null
let _cacheExpiry = 0

export async function fetchLowerThirdTemplates() {
	if (_cachedTemplates && Date.now() < _cacheExpiry) return _cachedTemplates
	try {
		const res = await api.get('/api/lower-thirds/templates')
		_cachedTemplates = res?.templates || []
		_cacheExpiry = Date.now() + 30_000
	} catch (e) {
		console.warn('[lower-third] Failed to fetch templates:', e?.message || e)
		_cachedTemplates = _cachedTemplates || []
	}
	return _cachedTemplates
}
