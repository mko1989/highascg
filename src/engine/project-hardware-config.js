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
		fingerprint: {
			hostname: os.hostname(),
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
			try {
				const { handleMultiviewApply } = require('../api/routes-multiview')
				handleMultiviewApply(hc.multiviewLayout, ctx)
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
	return connectors > 0 || edges > 0 || dests > 0
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
