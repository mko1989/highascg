/**
 * Client-side optional modules (WO-30 / WO-32).
 * Bundle paths come from the registry; only ids listed in `enabled` are merged in.
 */
import { OPTIONAL_MODULE_REGISTRY } from './optional-modules-registry.js'

/**
 * @param {{ enabled?: string[], bundles?: string[], styles?: string[], wsNamespaces?: string[] } | null | undefined} info
 */
export function mergeClientOptionalModules(info) {
	const enabled = Array.isArray(info?.enabled) ? info.enabled.slice() : []
	const bundles = Array.isArray(info?.bundles) ? info.bundles.slice() : []
	const styles = Array.isArray(info?.styles) ? info.styles.slice() : []
	const enabledSet = new Set(enabled)

	for (const mod of OPTIONAL_MODULE_REGISTRY) {
		if (!enabledSet.has(mod.id)) continue
		if (mod.bundle && !bundles.includes(mod.bundle)) bundles.push(mod.bundle)
		for (const href of mod.styles || []) {
			if (!styles.includes(href)) styles.push(href)
		}
	}

	return {
		...(info || {}),
		enabled,
		bundles,
		styles,
		wsNamespaces: Array.isArray(info?.wsNamespaces) ? info.wsNamespaces : [],
	}
}
