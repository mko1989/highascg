'use strict'

/**
 * OSC listener defaults (CasparCG UDP → HighAsCG).
 * OSC is **always enabled** in normalized config; production assumes Caspar sends OSC to HighAsCG.
 * To disable the UDP listener (dev only), start the server with **`--no-osc`** (see `index.js`).
 * Env: OSC_LISTEN_PORT, OSC_BIND_ADDRESS, HIGHASCG_OSC_WS_DELTA
 */

function num(v, fallback) {
	const n = parseInt(String(v ?? ''), 10)
	return Number.isFinite(n) ? n : fallback
}

/**
 * @param {Record<string, unknown>} [cfg] - merged app config (`config.osc`)
 */
function normalizeOscConfig(cfg) {
	const o = (cfg && cfg.osc) || {}
	const env = process.env
	const wsDelta =
		o.wsDeltaBroadcast === true ||
		env.HIGHASCG_OSC_WS_DELTA === '1' ||
		env.HIGHASCG_OSC_WS_DELTA === 'true'
	return {
		enabled: true,
		listenPort: num(o.listenPort ?? env.OSC_LISTEN_PORT, 6250),
		listenAddress: String(o.listenAddress || env.OSC_BIND_ADDRESS || '0.0.0.0'),
		peakHoldMs: num(o.peakHoldMs, 2000),
		emitIntervalMs: Math.max(10, num(o.emitIntervalMs, 50)),
		staleTimeoutMs: num(o.staleTimeoutMs, 5000),
		/** When true, `change` / WS may send `{ delta: true, channels: { "1": … } }` (merge by channel id). */
		wsDeltaBroadcast: !!wsDelta,
	}
}

module.exports = { normalizeOscConfig }
