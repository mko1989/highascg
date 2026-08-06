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
 * WO-443: monitor-role audio outputs are BOX-LOCAL hardware (this box's headphone/monitor
 * device — cf. WO-425: the label/device is never a code default), so they must not ride in a
 * project: saving stamped them into every project, and loading imposed one box's monitor
 * device on another (or resurrected a stale copy over the live one).
 * @param {unknown} list
 * @returns {{ monitor: object[], portable: object[] }}
 */
function splitMonitorAudioOutputs(list) {
	const arr = Array.isArray(list) ? list : []
	return {
		monitor: arr.filter((o) => String(o?.role || '') === 'monitor'),
		portable: arr.filter((o) => String(o?.role || '') !== 'monitor'),
	}
}

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
	if (hardwareConfig.audioOutputs !== undefined) {
		hardwareConfig.audioOutputs = splitMonitorAudioOutputs(hardwareConfig.audioOutputs).portable
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
		if (hc.audioOutputs !== undefined) {
			/* WO-443: the box keeps ITS monitor outputs; the project's copy (legacy projects carry
			 * one) is dropped — it describes whatever box it was saved on. */
			next.audioOutputs = [
				...splitMonitorAudioOutputs(hc.audioOutputs).portable,
				...splitMonitorAudioOutputs(cm.get().audioOutputs).monitor,
			]
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
 * True when this hardware slice records something the OPERATOR chose, as opposed to something the
 * machine merely detected.
 *
 * Deliberately NOT {@link hardwareConfigHasOperatorData}, which counts `connectors > 0` as data.
 * Connectors are enumerated GPU/DeckLink ports — a factory-reset box still reports 7 of them, so by
 * that measure a wiped config looks "non-empty" and would sail past this guard. Only cables (edges)
 * and screen destinations represent a decision worth protecting from a background write.
 * @param {object} hc
 * @returns {boolean}
 */
function hardwareConfigHasOperatorIntent(hc) {
	if (!hc || typeof hc !== 'object') return false
	const edges = Array.isArray(hc.deviceGraph?.edges) ? hc.deviceGraph.edges.length : 0
	const dests = Array.isArray(hc.screenDestinations?.destinations)
		? hc.screenDestinations.destinations.length
		: 0
	return edges > 0 || dests > 0
}

/**
 * Stamp the live hardware slice onto a project about to be written.
 *
 * `preserveWhenEmpty` exists because this OVERWRITES whatever the project already carried, and the
 * live config is empty immediately after a factory reset. Observed data loss: a project saved with
 * 14 connectors / 6 edges / 3 destinations was factory-reset (which correctly trashed it), and ~23s
 * later a background autosave from the still-open browser recreated it carrying the now-empty live
 * config — connectors 7, edges 0, destinations 0. Loading it then restored nothing, which reads as
 * "load is broken" but is really "the file was destroyed before the load".
 *
 * The split is deliberate. An EXPLICIT save is the operator saying "capture what is on screen now",
 * so it may legitimately record an empty rig. An AUTOSAVE is a background write that must never
 * destroy data, so when the live config has nothing to say it leaves the stored slice alone.
 * Same shape as preserveProjectCredentials in project-scenes.js.
 *
 * @param {object} ctx
 * @param {object} project
 * @param {{ preserveWhenEmpty?: boolean }} [opts]
 */
function injectHardwareConfigToProject(ctx, project, opts = {}) {
	const hc = buildHardwareConfigFromCtx(ctx)
	if (!hc) return

	if (opts.preserveWhenEmpty === true && !hardwareConfigHasOperatorIntent(hc)) {
		if (hardwareConfigHasOperatorIntent(project?.hardwareConfig)) return
		try {
			const projectStore = require('./project-store')
			const slug = projectStore.projectSlugFromName(project?.name)
			const stored = slug ? projectStore.readProjectFile(slug) : null
			if (hardwareConfigHasOperatorIntent(stored?.hardwareConfig)) {
				project.hardwareConfig = stored.hardwareConfig
				return
			}
		} catch {
			/* no stored copy to fall back to — writing the empty slice below is then harmless */
		}
	}

	project.hardwareConfig = hc
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
	splitMonitorAudioOutputs,
	buildHardwareConfigFromConfig,
	buildHardwareConfigFromCtx,
	hardwareConfigToSnapshotPayload,
	applyHardwareConfigToCtx,
	injectHardwareConfigToProject,
	hardwareConfigHasOperatorIntent,
	applyHardwareConfigFromProject,
	hardwareConfigHasOperatorData,
}
