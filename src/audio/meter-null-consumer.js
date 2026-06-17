/**
 * Fly-added Caspar consumer so consumer-less input channels tick the mixer and publish OSC meters.
 *
 * CasparCG only runs the channel compositor / audio mixer when at least one consumer is attached.
 * Screen, PortAudio, and streaming STREAM consumers all satisfy this; dedicated live-input channels
 * intentionally ship with `<consumers/>` in casparcg.config (WO-53).
 *
 * Cheapest runtime fix (verified on Caspar 2.6): AMCP ffmpeg STREAM with `-format null` to a
 * discard UDP port — no video encode, no audio output device, same pattern as streaming ADD STREAM.
 *
 * @see src/streaming/caspar-ffmpeg-setup.js (full MPEG-TS STREAM)
 * @see src/sampling/dmx-sampling-ingress.js (consumer index 97)
 */
'use strict'

const { amcpInfoText } = require('../streaming/caspar-ffmpeg-setup')

/** Dedicated slot — below DMX (97), above typical route layers. */
const METER_NULL_CONSUMER_INDEX = 96
/** 52000 + channel → unique discard port per input channel. */
const METER_UDP_PORT_BASE = 52000

/**
 * @param {number} channel
 * @returns {string}
 */
function meterNullStreamUri(channel) {
	const ch = parseInt(String(channel), 10)
	const port = METER_UDP_PORT_BASE + ch
	const localport = port + 10000
	return `udp://127.0.0.1:${port}?localport=${localport}`
}

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isMeterNullConsumerEnabled(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : config
	const raw = cs?.live_audio_meter_null_consumer ?? cs?.input_meter_null_consumer
	if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false
	return true
}

/**
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel
 * @returns {Promise<boolean>}
 */
async function ensureMeterNullConsumer(amcp, channel) {
	if (!amcp?.isConnected) return false
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return false
	const uri = meterNullStreamUri(ch)
	try {
		const info = await amcp.info(ch)
		const text = amcpInfoText(info)
		if (text.includes(uri) || text.includes(`port_${METER_NULL_CONSUMER_INDEX}`)) return true
	} catch {
		/* proceed with ADD */
	}
	const cmd = `ADD ${ch}-${METER_NULL_CONSUMER_INDEX} STREAM ${uri} -format null`
	try {
		await amcp.raw(cmd)
		return true
	} catch (e) {
		const msg = e?.message || String(e)
		if (/already|exists|duplicate/i.test(msg)) return true
		throw e
	}
}

/**
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel
 */
async function removeMeterNullConsumer(amcp, channel) {
	if (!amcp?.isConnected) return
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return
	const uri = meterNullStreamUri(ch)
	try {
		await amcp.raw(`REMOVE ${ch}-${METER_NULL_CONSUMER_INDEX} STREAM ${uri}`)
	} catch {
		/* ok if absent */
	}
}

/**
 * @param {object} ctx app context (amcp, config, log)
 * @param {number[]} channels
 */
async function ensureMeterNullConsumersForChannels(ctx, channels) {
	if (!isMeterNullConsumerEnabled(ctx?.config)) return []
	if (!ctx?.amcp?.isConnected || !Array.isArray(channels) || !channels.length) return []
	const ok = []
	const failed = []
	for (const ch of channels) {
		try {
			if (await ensureMeterNullConsumer(ctx.amcp, ch)) ok.push(ch)
		} catch (e) {
			failed.push({ channel: ch, message: e?.message || String(e) })
		}
	}
	if (ok.length && typeof ctx.log === 'function') {
		ctx.log('info', `[meter] null STREAM consumer on channel(s) ${ok.join(', ')} (OSC tick)`)
	}
	if (failed.length && typeof ctx.log === 'function') {
		ctx.log('warn', `[meter] null consumer failed: ${JSON.stringify(failed)}`)
	}
	return ok
}

module.exports = {
	METER_NULL_CONSUMER_INDEX,
	METER_UDP_PORT_BASE,
	meterNullStreamUri,
	isMeterNullConsumerEnabled,
	ensureMeterNullConsumer,
	removeMeterNullConsumer,
	ensureMeterNullConsumersForChannels,
}
