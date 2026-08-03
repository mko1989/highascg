'use strict'

/**
 * Monitor / headphone solo bus resolution (WO-406).
 *
 * Two ways to turn the bus on:
 *  - explicit `monitor_channel_enabled` / `monitor_portaudio_device` casparServer keys, or
 *  - a Device-View audio output saved with `role: 'monitor'` and a device name.
 *
 * One resolver so the runtime channel map (routing-map → solo API) and the config
 * generator (monitor channel XML) can never disagree about whether the bus exists.
 * Accepts both the app config (casparServer nest) and the merged flat generator config.
 */

function readSetting(cfg, key) {
	if (!cfg || typeof cfg !== 'object') return undefined
	const cs = cfg.casparServer && typeof cfg.casparServer === 'object' ? cfg.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key]
	return undefined
}

function isTrue(v) {
	return v === true || v === 'true'
}

/**
 * @param {Record<string, unknown>} config app config or merged generator config
 * @returns {{ enabled: boolean, deviceName: string, bufferFrames: number, latencyMs: number, fifoMs: number }}
 */
function resolveMonitorBus(config) {
	const outputs = Array.isArray(config?.audioOutputs) ? config.audioOutputs : []
	const entry = outputs.find(
		(o) =>
			o &&
			typeof o === 'object' &&
			o.enabled !== false &&
			o.enabled !== 'false' &&
			String(o.role || '').toLowerCase() === 'monitor' &&
			String(o.deviceName || '').trim() !== ''
	)
	const num = (key, entryVal, dflt) => {
		const flat = Number.parseInt(String(readSetting(config, key) ?? ''), 10)
		if (Number.isFinite(flat) && flat > 0) return flat
		const fromEntry = Number.parseInt(String(entryVal ?? ''), 10)
		return Number.isFinite(fromEntry) && fromEntry > 0 ? fromEntry : dflt
	}
	return {
		enabled: isTrue(readSetting(config, 'monitor_channel_enabled')) || !!entry,
		deviceName:
			String(readSetting(config, 'monitor_portaudio_device') || '').trim() ||
			String(entry?.deviceName || '').trim(),
		bufferFrames: num('monitor_portaudio_buffer_frames', entry?.bufferFrames, 128),
		latencyMs: num('monitor_portaudio_latency_ms', entry?.latencyMs, 40),
		fifoMs: num('monitor_portaudio_fifo_ms', entry?.fifoMs, 50),
	}
}

module.exports = { resolveMonitorBus }
