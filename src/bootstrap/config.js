/**
 * Effective config construction for HighAsCG.
 */
'use strict'

const { normalizeOscConfig } = require('../osc/osc-config')
const { resolveStreamingConfig } = require('../streaming/stream-config')

function buildConfig(cli, configManager) {
	const cfg = JSON.parse(JSON.stringify(configManager.get()))

	if (cli.casparHost != null) cfg.caspar.host = cli.casparHost
	if (cli.casparPort != null && !Number.isNaN(cli.casparPort)) cfg.caspar.port = cli.casparPort
	if (cli.httpPort != null && !Number.isNaN(cli.httpPort)) cfg.server.httpPort = cli.httpPort
	if (cli.wsPort != null && !Number.isNaN(cli.wsPort)) cfg.server.wsPort = cli.wsPort
	if (cli.bindAddress != null) cfg.server.bindAddress = cli.bindAddress

	cfg.osc = normalizeOscConfig(cfg)
	if (cli.noOsc) cfg.osc.enabled = false

	const env = process.env
	const syncKeys = [['periodic_sync_interval_sec', 'HIGHASCG_PERIODIC_SYNC_SEC'], ['periodic_sync_interval_sec_osc', 'HIGHASCG_PERIODIC_SYNC_OSC_SEC']]
	for (const [k, e] of syncKeys) {
		if (cfg[k] === null && env[e]) {
			const n = parseInt(env[e], 10); if (Number.isFinite(n) && n > 0) cfg[k] = n
		}
	}

	cfg.streaming = resolveStreamingConfig(cfg.streaming || {})
	if (env.HIGHASCG_STREAMING_AUTO_RELOCATE === '0') cfg.streaming.autoRelocateBasePort = false
	else if (env.HIGHASCG_STREAMING_AUTO_RELOCATE === '1') cfg.streaming.autoRelocateBasePort = true

	const batchEnv = env.HIGHASCG_AMCP_BATCH
	if (batchEnv === '1' || String(batchEnv).toLowerCase() === 'true') cfg.amcp_batch = true
	else if (batchEnv === '0' || String(batchEnv).toLowerCase() === 'false') cfg.amcp_batch = false

	const maxBatchEnv = env.HIGHASCG_AMCP_MAX_BATCH
	if (maxBatchEnv) {
		const n = parseInt(maxBatchEnv, 10); if (Number.isFinite(n) && n >= 1 && n <= 512) cfg.amcp_max_batch_commands = n
	}

	const mixerFlushEnv = env.HIGHASCG_AMCP_BATCH_MIXER_FLUSH
	if (mixerFlushEnv === '0' || String(mixerFlushEnv).toLowerCase() === 'false') cfg.amcp_mixer_commit_before_amcp_batch = false
	else if (mixerFlushEnv === '1' || String(mixerFlushEnv).toLowerCase() === 'true') cfg.amcp_mixer_commit_before_amcp_batch = true

	return cfg
}

module.exports = { buildConfig }
