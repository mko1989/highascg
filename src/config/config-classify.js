'use strict'

const { SYSTEM_DISPLAY_KEYS } = require('../api/settings-os')

/** Routing/output definitions in project hardwareConfig — per-machine on hot backup (Caspar consumer count). */
const SHOW_ROUTING_HARDWARE_SLICES = [
	'audioRouting',
	'streamingChannel',
	'dmx',
	'recordOutputs',
	'streamOutputs',
	'audioOutputs',
	'rtmp',
]

/** Top-level config keys that are device-local and must never replicate. */
const DEVICE_TOP_LEVEL_KEYS = new Set([
	'audioCapture',
	'caspar',
	'casparServer',
	'deviceGraph',
	'gpuPhysicalTopology',
	'server',
	'host_stats',
	'usbIngest',
	'local_template_path',
	'replication',
	...SYSTEM_DISPLAY_KEYS,
])

/** Top-level keys treated as shared show data. */
const SHOW_TOP_LEVEL_KEYS = new Set([
	'screenDestinations',
	'audioRouting',
	'streamingChannel',
	'dmx',
	'recordOutputs',
	'streamOutputs',
	'audioOutputs',
	'ui',
	'editorDefaults',
	'companion',
	'plugins',
	'rtmp',
])

/**
 * @param {string} key
 * @returns {'show'|'device'|'live'|null}
 */
function classifyConfigKey(key) {
	if (!key || typeof key !== 'string') return null
	if (key.includes('_os_') || key.includes('_system_id')) return 'device'
	if (/^screen_[1-4]_/.test(key) && (key.endsWith('_system_id') || key.includes('_os_'))) return 'device'
	if (/^multiview_os_/.test(key)) return 'device'
	if (DEVICE_TOP_LEVEL_KEYS.has(key)) return 'device'
	if (SHOW_TOP_LEVEL_KEYS.has(key)) return 'show'
	return null
}

/**
 * @param {object} config
 * @returns {{ shared: Record<string, unknown>, deviceLocal: Record<string, unknown> }}
 */
function splitConfigForReplication(config) {
	/** @type {Record<string, unknown>} */
	const shared = {}
	/** @type {Record<string, unknown>} */
	const deviceLocal = {}
	if (!config || typeof config !== 'object') return { shared, deviceLocal }

	for (const [key, value] of Object.entries(config)) {
		const tier = classifyConfigKey(key)
		if (tier === 'device') deviceLocal[key] = value
		else if (tier === 'show') shared[key] = value
	}

	return { shared, deviceLocal }
}

/**
 * Strip device-local slices from a project before leader→follower push.
 * @param {object} project
 * @returns {object}
 */
function stripDeviceLocalFromProject(project) {
	if (!project || typeof project !== 'object') return project
	const p = JSON.parse(JSON.stringify(project))
	const hc = p.hardwareConfig
	if (hc && typeof hc === 'object') {
		delete hc.osDisplay
		delete hc.casparServer
		delete hc.gpuPhysicalTopology
		delete hc.fingerprint
		delete hc.deviceGraph
		for (const key of SHOW_ROUTING_HARDWARE_SLICES) {
			delete hc[key]
		}
	}
	return p
}

const DEVICE_HARDWARE_SLICES = [
	'osDisplay',
	'casparServer',
	'gpuPhysicalTopology',
	'fingerprint',
	'deviceGraph',
]

/** Show output definitions replicated leader → follower (channel ids/modes must match). */
const SHOW_DESTINATION_SLICES = ['screenDestinations']

/** Slices the follower keeps from its on-disk project when merging leader show data. */
const FOLLOWER_LOCAL_PROJECT_SLICES = [...DEVICE_HARDWARE_SLICES, ...SHOW_ROUTING_HARDWARE_SLICES]

/**
 * Merge leader shared project into follower's on-disk project, preserving device-local hardware.
 * @param {object|null} existing
 * @param {object} incoming
 * @returns {object}
 */
function mergeSharedProjectIntoLocal(existing, incoming) {
	if (!incoming || typeof incoming !== 'object') return existing || incoming
	const merged = JSON.parse(JSON.stringify(incoming))
	if (!existing || typeof existing !== 'object') return merged

	const existingHc = existing.hardwareConfig
	const incomingHc = merged.hardwareConfig
	if (existingHc && typeof existingHc === 'object') {
		merged.hardwareConfig = {
			...(incomingHc && typeof incomingHc === 'object' ? incomingHc : {}),
		}
		for (const slice of FOLLOWER_LOCAL_PROJECT_SLICES) {
			if (existingHc[slice] !== undefined) merged.hardwareConfig[slice] = existingHc[slice]
		}
	}

	return merged
}

module.exports = {
	classifyConfigKey,
	splitConfigForReplication,
	stripDeviceLocalFromProject,
	mergeSharedProjectIntoLocal,
	DEVICE_TOP_LEVEL_KEYS,
	SHOW_TOP_LEVEL_KEYS,
	DEVICE_HARDWARE_SLICES,
	SHOW_DESTINATION_SLICES,
	SHOW_ROUTING_HARDWARE_SLICES,
	FOLLOWER_LOCAL_PROJECT_SLICES,
}
