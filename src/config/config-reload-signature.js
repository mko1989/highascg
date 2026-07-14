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
		composePreview:
			config.composePreview && typeof config.composePreview === 'object'
				? config.composePreview
				: undefined,
		offline_mode: !!config.offline_mode,
		periodic_sync_interval_sec: config.periodic_sync_interval_sec,
		periodic_sync_interval_sec_osc: config.periodic_sync_interval_sec_osc,
		osc_info_supplement_ms: config.osc_info_supplement_ms,
		osc: normalizeOscConfig(config),
		dmx: config.dmx,
		streaming: s,
		// WO-172 T172.3: `streamingChannel`/`recordOutputs` intentionally included — `deviceGraph` is
		// intentionally NOT. Verified index.js:257-299's `configManager.on('change', ...)` handler:
		// a signature change here calls `casparConn.start()`/`.stop()` (AMCP reconnect, which reruns
		// `setupAllRouting` — see src/config/routing-setup.js:328-340 — the only place the dedicated
		// streaming-channel `PLAY <streamingCh> route://<src>` gets re-issued). `deviceGraph` changes on
		// every single cable/decklink edit; recycling the AMCP connection that often is too heavy and
		// was excluded. `streamingChannel`/`recordOutputs` only change when a stream_out/record_out
		// cable edit actually resolves a new source (via the now-fixed device-view-apply.js sync), or
		// via a direct settings save — comparatively rare — so picking up the reconnect there is an
		// acceptable, much lighter alternative to a full "Apply Caspar config" restart, and is what lets
		// dedicated-output-channel mode's routing self-heal without the user needing to hit Apply.
		// Attach-mode source changes don't strictly need this (next Start/ADD resolves the channel from
		// fresh config directly), so this is a no-op-but-harmless AMCP recycle for that mode.
		streamingChannel:
			config.streamingChannel && typeof config.streamingChannel === 'object'
				? stripLeadingUnderscoreKeys(config.streamingChannel)
				: {},
		recordOutputs: Array.isArray(config.recordOutputs) ? config.recordOutputs : [],
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
