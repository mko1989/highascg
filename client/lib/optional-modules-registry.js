import registry from './optional-modules-registry.json'

/** @typedef {{ id: string, label: string, description?: string, bundle?: string, load?: string, styles?: string[], defaultEnabled?: boolean }} OptionalModuleDef */

/** @type {OptionalModuleDef[]} */
export const OPTIONAL_MODULE_REGISTRY = registry.modules || []

/** @returns {string[]} */
export function getDefaultEnabledModuleIds() {
	return OPTIONAL_MODULE_REGISTRY.filter((m) => m.defaultEnabled).map((m) => m.id)
}

/** @param {string} id */
export function getOptionalModuleDef(id) {
	return OPTIONAL_MODULE_REGISTRY.find((m) => m.id === id) || null
}

/**
 * Build GET /api/modules payload for a given enabled id list.
 * @param {string[]} enabledIds
 */
export function buildModulesApiPayload(enabledIds) {
	const allowed = new Set(
		(Array.isArray(enabledIds) ? enabledIds : [])
			.map((id) => String(id || '').trim())
			.filter(Boolean),
	)
	const enabled = []
	const bundles = []
	const styles = []
	for (const mod of OPTIONAL_MODULE_REGISTRY) {
		if (!allowed.has(mod.id)) continue
		enabled.push(mod.id)
		if (mod.bundle && !bundles.includes(mod.bundle)) bundles.push(mod.bundle)
		for (const href of mod.styles || []) {
			if (!styles.includes(href)) styles.push(href)
		}
	}
	return {
		enabled,
		bundles,
		styles,
		wsNamespaces: enabled.filter((id) => id !== 'cg-studio'),
	}
}
