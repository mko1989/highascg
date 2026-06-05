/**
 * Stable hash of config fields that drive subsystem recycle (OSC, streaming, Caspar TCP, DMX sampling).
 * Used to skip redundant reconnect work when only cosmetic / unrelated JSON keys change.
 */
'use strict'

const crypto = require('crypto')
const { normalizeOscConfig } = require('../osc/osc-config')

/**
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function stripLeadingUnderscoreKeys(obj) {
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
	/** @type {Record<string, unknown>} */
	const o = {}
	for (const [k, v] of Object.entries(obj)) {
		if (k.startsWith('_')) continue
		o[k] = v
	}
	return o
}

/**
 * @param {Record<string, unknown> | undefined} config — effective runtime config after `buildConfig`
 * @returns {Record<string, unknown>}
 */
function pickSubsystemReloadSnapshot(config) {
	if (!config || typeof config !== 'object') return {}
	const s = config.streaming && typeof config.streaming === 'object' ? stripLeadingUnderscoreKeys(config.streaming) : {}
	return {
		caspar: {
			host: config.caspar && typeof config.caspar === 'object' ? config.caspar.host : undefined,
			port: config.caspar && typeof config.caspar === 'object' ? config.caspar.port : undefined,
		},
		offline_mode: !!config.offline_mode,
		periodic_sync_interval_sec: config.periodic_sync_interval_sec,
		periodic_sync_interval_sec_osc: config.periodic_sync_interval_sec_osc,
		osc_info_supplement_ms: config.osc_info_supplement_ms,
		osc: normalizeOscConfig(config),
		dmx: config.dmx,
		streaming: s,
		amcp_batch: config.amcp_batch,
		amcp_max_batch_commands: config.amcp_max_batch_commands,
		amcp_mixer_commit_before_amcp_batch: config.amcp_mixer_commit_before_amcp_batch,
	}
}

/**
 * @param {Record<string, unknown> | undefined} config
 * @returns {string} hex sha256
 */
function hashSubsystemReload(config) {
	const snap = pickSubsystemReloadSnapshot(config)
	return crypto.createHash('sha256').update(JSON.stringify(snap)).digest('hex')
}

module.exports = {
	pickSubsystemReloadSnapshot,
	hashSubsystemReload,
}
