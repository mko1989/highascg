/**
 * Read launcher-injected optional module list from index.html meta.
 * @returns {string[] | null} enabled module ids, or null if meta absent/invalid
 */
export function readMetaEnabledModuleIds() {
	if (typeof document === 'undefined') return null
	const el = document.querySelector('meta[name="highascg-optional-modules"]')
	if (!el || el.content == null || String(el.content).trim() === '') return null
	try {
		const parsed = JSON.parse(el.content)
		if (Array.isArray(parsed)) {
			return parsed.map((id) => String(id || '').trim()).filter(Boolean)
		}
		if (parsed && Array.isArray(parsed.enabled)) {
			return parsed.enabled.map((id) => String(id || '').trim()).filter(Boolean)
		}
	} catch {
		/* ignore */
	}
	return null
}
