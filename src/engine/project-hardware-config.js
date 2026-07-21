/**
 * Project hardwareConfig envelope — same slices as WO-49 device snapshot + routing extras.
 * @module engine/project-hardware-config
 */
'use strict'

const os = require('os')
const { extractPayloadFromConfig, applySnapshotToConfigClone } = require('../config/device-snapshot')
const { normalizeDeviceGraph } = require('../config/device-graph')
const { normalizeScreenDestinations } = require('../config/screen-destinations')

/** @type {2} */
const HARDWARE_CONFIG_VERSION = 2

const ROUTING_EXTRA_KEYS = [
	'audioRouting',
	'streamingChannel',
	'dmx',
	'recordOutputs',
	'streamOutputs',
	'audioOutputs',
]

/**
 * Stable machine identifiers for the project fingerprint. Best-effort: hardware-identity pulls in
 * network inventory, so a failure here must never block a project save.
 * @returns {{ hardwareId?: string, mac?: string }}
 */
function hardwareFingerprintIds() {
	try {
		const { getHardwareIdentity } = require('../system/hardware-identity')
		const id = getHardwareIdentity()
		return {
			...(id?.hardwareId ? { hardwareId: String(id.hardwareId) } : {}),
			...(id?.mac ? { mac: String(id.mac).toLowerCase() } : {}),
		}
	} catch {
		return {}
	}
}

/**
 * @param {object} cfg
 * @param {object} persistence
 * @returns {object}
 */
function buildHardwareConfigFromConfig(cfg, persistence) {
	const payload = extractPayloadFromConfig(cfg)
	const sp = payload.settingsPatches && typeof payload.settingsPatches === 'object' ? payload.settingsPatches : {}
	const { casparServer: _slice, ...osDisplay } = sp

	/** @type {Record<string, unknown>} */
	const hardwareConfig = {
		version: HARDWARE_CONFIG_VERSION,
		deviceGraph: payload.deviceGraph,
		screenDestinations: payload.screenDestinations,
		osDisplay,
		casparServer: cfg.casparServer,
		multiviewLayout: persistence?.get?.('multiviewLayout') ?? null,
		/* hostname alone is NOT a machine identity: ensureHardwareHostname() rewrites legacy
		 * `highascg-nvidia-*` names to the MAC-derived `highascg####`, so every project saved before
		 * that migration looked like a DIFFERENT machine afterwards and raised the hardware-mismatch
		 * modal on every boot. hardwareId/mac are stable across the rename. */
		fingerprint: {
			hostname: os.hostname(),
			...hardwareFingerprintIds(),
		},
	}

	if (payload.gpuPhysicalTopology) {
		hardwareConfig.gpuPhysicalTopology = payload.gpuPhysicalTopology
	}

	for (const k of ROUTING_EXTRA_KEYS) {
		if (cfg[k] !== undefined) hardwareConfig[k] = cfg[k]
	}

	return hardwareConfig
}

/**
 * @param {object} ctx
 * @returns {object | null}
 */
function buildHardwareConfigFromCtx(ctx) {
	if (!ctx?.configManager) return null
	try {
		const persistence = ctx.persistence || require('../utils/persistence')
		return buildHardwareConfigFromConfig(ctx.configManager.get(), persistence)
	} catch {
		return null
	}
}

/**
 * Convert stored hardwareConfig (v1 flat or v2) into device-snapshot payload shape.
 * @param {object} hc
 * @returns {object}
 */
function hardwareConfigToSnapshotPayload(hc) {
	const payload = {
		deviceGraph: hc.deviceGraph != null ? normalizeDeviceGraph(hc.deviceGraph) : undefined,
		screenDestinations:
			hc.screenDestinations != null ? normalizeScreenDestinations(hc.screenDestinations) : undefined,
		settingsPatches: {},
	}

	if (Array.isArray(hc.gpuPhysicalTopology) && hc.gpuPhysicalTopology.length) {
		payload.gpuPhysicalTopology = hc.gpuPhysicalTopology
	}

	if (hc.osDisplay && typeof hc.osDisplay === 'object') {
		Object.assign(payload.settingsPatches, hc.osDisplay)
	}

	if (hc.casparServer && typeof hc.casparServer === 'object') {
		payload.settingsPatches.casparServer = hc.casparServer
	}

	return payload
}

/**
 * @param {object} ctx
 * @param {object} hc
 * @returns {boolean}
 */
function applyHardwareConfigToCtx(ctx, hc) {
	if (!ctx?.configManager || !hc || typeof hc !== 'object') return false
	try {
		const persistence = ctx.persistence || require('../utils/persistence')
		const cm = ctx.configManager
		const next = { ...cm.get() }

		const payload = hardwareConfigToSnapshotPayload(hc)
		applySnapshotToConfigClone(next, { payload }, 'full')

		for (const k of ROUTING_EXTRA_KEYS) {
			if (hc[k] !== undefined) next[k] = hc[k]
		}

		cm.save(next)
		if (ctx.config) Object.assign(ctx.config, cm.get())

		if (hc.multiviewLayout !== undefined) {
			persistence.set('multiviewLayout', hc.multiviewLayout)
			ctx._multiviewLayout = hc.multiviewLayout
			// WO-156: plural map is the reconnect re-apply source of truth.
			if (!ctx._multiviewLayouts) ctx._multiviewLayouts = {}
			if (hc.multiviewLayout) ctx._multiviewLayouts[1] = hc.multiviewLayout
			else delete ctx._multiviewLayouts[1]
			try {
				const { applyMultiviewLayout } = require('./multiview-apply')
				void applyMultiviewLayout(hc.multiviewLayout, ctx).catch(() => {})
			} catch {
				/* optional */
			}
		}

		return true
	} catch {
		return false
	}
}

/**
 * @param {object} ctx
 * @param {object} project
 */
function injectHardwareConfigToProject(ctx, project) {
	const hc = buildHardwareConfigFromCtx(ctx)
	if (hc) project.hardwareConfig = hc
}

/**
 * True when hardwareConfig carries operator Device View / routing data worth applying.
 * Empty snapshots (saved after eggs factory reset) must not wipe live server config.
 * @param {object} hc
 */
function hardwareConfigHasOperatorData(hc) {
	if (!hc || typeof hc !== 'object') return false
	const dg = hc.deviceGraph && typeof hc.deviceGraph === 'object' ? hc.deviceGraph : null
	const connectors = Array.isArray(dg?.connectors) ? dg.connectors.length : 0
	const edges = Array.isArray(dg?.edges) ? dg.edges.length : 0
	const dests = Array.isArray(hc.screenDestinations?.destinations)
		? hc.screenDestinations.destinations.length
		: 0
	if (connectors > 0 || edges > 0 || dests > 0) return true
	const cs = hc.casparServer && typeof hc.casparServer === 'object' ? hc.casparServer : null
	if (!cs) return false
	const liveCount = Math.min(8, Math.max(0, parseInt(String(cs.live_audio_input_count ?? 0), 10) || 0))
	const deckCount = Math.min(8, Math.max(0, parseInt(String(cs.decklink_input_count ?? 0), 10) || 0))
	if (liveCount > 0 || deckCount > 0) return true
	for (let i = 1; i <= 8; i++) {
		if (String(cs[`live_audio_input_${i}_device`] || '').trim()) return true
	}
	return false
}

/**
 * @param {object} ctx
 * @param {object} project
 */
function applyHardwareConfigFromProject(ctx, project) {
	if (!project?.hardwareConfig) return
	if (!hardwareConfigHasOperatorData(project.hardwareConfig)) {
		if (typeof ctx.log === 'function') {
			ctx.log(
				'info',
				'[project] Skipped empty hardwareConfig — scenes/timelines loaded; server Device View unchanged (save project after cabling to embed hardware).',
			)
		}
		return
	}
	const ok = applyHardwareConfigToCtx(ctx, project.hardwareConfig)
	if (ok && typeof ctx.log === 'function') {
		const ver = project.hardwareConfig.version || 1
		ctx.log(
			'info',
			`[project] Loaded hardware configuration (v${ver}). Run apply-os and regenerate casparcg.config if heads or modes changed.`,
		)
	}
}

module.exports = {
	HARDWARE_CONFIG_VERSION,
	ROUTING_EXTRA_KEYS,
	buildHardwareConfigFromConfig,
	buildHardwareConfigFromCtx,
	hardwareConfigToSnapshotPayload,
	applyHardwareConfigToCtx,
	injectHardwareConfigToProject,
	applyHardwareConfigFromProject,
	hardwareConfigHasOperatorData,
}
