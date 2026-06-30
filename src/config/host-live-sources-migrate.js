'use strict'

const {
	normalizeNdiHostSource,
	normalizeWebpageHostSource,
	isWebpageHostCandidate,
	isNdiHostCandidate,
	isHostLiveSource,
} = require('./host-live-sources')

/**
 * @param {object} item
 */
function isLegacyNdiLiveSource(item) {
	if (!item || typeof item !== 'object') return false
	if (item.routeType === 'ndi_host') return false
	return item.type === 'ndi' || (String(item.value || '').trim().toLowerCase().startsWith('ndi://') && !String(item.value || '').startsWith('route://'))
}

/**
 * @param {object} item
 */
function isLegacyBrowserLiveSource(item) {
	if (!item || typeof item !== 'object') return false
	if (item.routeType === 'webpage_host' || item.routeType === 'layer') return false
	return isWebpageHostCandidate(item) && !isHostLiveSource(item)
}

/**
 * @param {object} config
 */
function collectHostLiveConfigWarnings(config) {
	const warnings = []
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : config || {}
	const decklinkCount = Math.max(0, parseInt(String(config?.decklink_input_count ?? cs.decklink_input_count ?? 0), 10) || 0)

	if (decklinkCount > 0 && String(cs.decklink_inputs_host || '').toLowerCase() === 'multiview_if_match') {
		warnings.push(
			'decklink_inputs_host is multiview_if_match but each DeckLink input already has a dedicated Caspar channel (WO-88). Set decklink_inputs_host to dedicated.',
		)
	}
	if (
		decklinkCount > 0 &&
		(cs.decklink_inputs_host_channel_enabled === true || cs.decklink_inputs_host_channel_enabled === 'true')
	) {
		warnings.push(
			'decklink_inputs_host_channel_enabled is obsolete when decklink_input_count > 0 — inputs use per-slot host channels.',
		)
	}

	for (const item of Array.isArray(config?.extraLiveSources) ? config.extraLiveSources : []) {
		if (isLegacyNdiLiveSource(item)) {
			const label = String(item.label || item.value || 'NDI').slice(0, 80)
			if (item.useDirect === true) {
				warnings.push(`NDI "${label}" uses deprecated direct PGM mode — migrate to ndi_host + route://.`)
			} else {
				warnings.push(`NDI "${label}" is not on a host channel — will migrate to ndi_host on save.`)
			}
		}
		if (isLegacyBrowserLiveSource(item)) {
			const label = String(item.label || item.templateOrUrl || item.value || 'Webpage').slice(0, 80)
			warnings.push(`Webpage "${label}" is not on a host channel — will migrate to webpage_host on save.`)
		}
	}

	return warnings
}

/**
 * @param {object[]} list
 * @param {object} ctx
 */
function migrateExtraLiveSourcesList(list, ctx) {
	const warnings = []
	const out = []
	let changed = false
	const config = ctx?.config || {}

	for (const item of Array.isArray(list) ? list : []) {
		if (isLegacyNdiLiveSource(item)) {
			const label = String(item.label || item.value || 'NDI').slice(0, 80)
			try {
				const normalized = normalizeNdiHostSource(item, { config, ...ctx })
				out.push(normalized)
				changed = true
				warnings.push(`Migrated NDI "${label}" to host channel ${normalized.hostChannel} (${normalized.value}).`)
				continue
			} catch (e) {
				warnings.push(`NDI "${label}" migration failed: ${e?.message || e}`)
				out.push(item)
				continue
			}
		}
		if (isLegacyBrowserLiveSource(item)) {
			const label = String(item.label || item.templateOrUrl || item.value || 'Webpage').slice(0, 80)
			try {
				const normalized = normalizeWebpageHostSource(item, { config, ...ctx })
				out.push(normalized)
				changed = true
				warnings.push(`Migrated webpage "${label}" to host channel ${normalized.hostChannel} (${normalized.value}).`)
				continue
			} catch (e) {
				warnings.push(`Webpage "${label}" migration failed: ${e?.message || e}`)
				out.push(item)
				continue
			}
		}
		if (item?.useDirect === true && isNdiHostCandidate(item)) {
			const next = { ...item }
			delete next.useDirect
			out.push(next)
			changed = true
			continue
		}
		out.push(item)
	}

	return { list: out, warnings, changed }
}

/**
 * Migrate extra live sources + normalize DeckLink host settings for WO-88.
 * @param {object} config
 * @param {object} ctx
 */
function migrateHostLiveSourcesConfig(config, ctx) {
	const mig = migrateExtraLiveSourcesList(config?.extraLiveSources || [], { config, ...ctx })
	const warnings = [...collectHostLiveConfigWarnings(config), ...mig.warnings]
	const casparServerPatch = {}

	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const decklinkCount = Math.max(0, parseInt(String(config?.decklink_input_count ?? cs.decklink_input_count ?? 0), 10) || 0)
	if (decklinkCount > 0 && String(cs.decklink_inputs_host || '').toLowerCase() !== 'dedicated') {
		casparServerPatch.decklink_inputs_host = 'dedicated'
		warnings.push('Set decklink_inputs_host → dedicated (per-slot host channels).')
	}

	return {
		extraLiveSources: mig.list,
		warnings,
		changed: mig.changed || Object.keys(casparServerPatch).length > 0,
		casparServerPatch,
	}
}

module.exports = {
	isLegacyNdiLiveSource,
	isLegacyBrowserLiveSource,
	collectHostLiveConfigWarnings,
	migrateExtraLiveSourcesList,
	migrateHostLiveSourcesConfig,
}
