/**
 * Fly-added Caspar consumer so channels tick the mixer and publish OSC audio meters.
 *
 * CasparCG only runs the channel compositor / audio mixer when at least one consumer is attached.
 * Many HighAsCG channels ship with `<consumers/>` in casparcg.config (PGM/PRV without screen,
 * dedicated live-input channels — WO-53). On this build, `<audio-osc>true</audio-osc>` alone is
 * not enough; a lightweight consumer must be present for `/channel/N/mixer/audio/…` OSC to flow.
 *
 * Cheapest runtime fix (verified on Caspar 2.6): AMCP ffmpeg STREAM to a discard UDP port — no
 * audio output device, same pattern as streaming ADD STREAM.
 *
 * The output format must declare NO video codec (WO-500). `ffmpeg_consumer.cpp:543` builds a video
 * stream whenever `oformat->video_codec != AV_CODEC_ID_NONE`, and FFmpeg's `null` muxer declares
 * `wrapped_avframe` — so `-format null` was NOT videoless. Every frame then went through
 * `make_av_video_frame` (`util/av_util.cpp:323`), which allocates a full-raster AVFrame and
 * row-by-row memcpys the whole picture into it — carrying its own `TODO (perf) Avoid extra memcpy`
 * upstream — only for `wrapped_avframe` to discard it. On a 6144x1536 channel that is 37.7 MB per
 * frame, 50x/s. `s16le` is a raw-PCM muxer: audio codec only, video codec NONE, no container header
 * and no seeking, so the video branch never runs. Verified live: with `-format null` the consumer's
 * INFO carries `<fps>50</fps>` (set only inside the video branch); with `-format s16le` it does not,
 * while `<frame>` still advances and OSC audio meters keep flowing.
 *
 * @see src/streaming/caspar-ffmpeg-setup.js (full MPEG-TS STREAM)
 * @see src/sampling/dmx-sampling-ingress.js (consumer index 97)
 */
'use strict'

const { amcpInfoText } = require('../streaming/caspar-ffmpeg-setup')
const { parseChannelVideoModesFromInfoConfigXml } = require('../config/server-info-config')

/** Dedicated slot — below DMX (97), above typical route layers. */
/* 720, not 96: 96 is STREAMING_RECORD_CONSUMER_INDEX. This consumer is added to EVERY channel
 * on connect, so it would silently displace a running RECORD — Caspar replaces whatever occupies
 * the index. The high range (7xx) is where the other long-lived internal consumers live
 * (compose-preview 701, v4l2 bridge 710/711), well clear of the streaming pair. */
const METER_NULL_CONSUMER_INDEX = 720
/** 52000 + channel → unique discard port per input channel. */
const METER_UDP_PORT_BASE = 52000
/**
 * Raw-PCM muxer: audio codec pcm_s16le, video codec NONE. The NONE is the load-bearing part —
 * see the file header. Do not "simplify" this back to `-format null`.
 */
const METER_NULL_FORMAT_ARGS = '-format s16le'

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
 * Does this channel already carry a consumer other than our own meter-null one?
 *
 * A channel with a real consumer (screen, decklink, streaming…) already runs its compositor and
 * audio mixer, so a meter-null consumer on top buys no OSC and costs a full frame fetch per tick —
 * at 6144x1536 that is a 9.4 Mpixel readback 50x/s for nothing (WO-500).
 *
 * @param {string} infoText `INFO <channel>` XML
 * @returns {boolean}
 */
function channelHasNonMeterConsumer(infoText) {
	const text = String(infoText || '')
	if (!text) return false
	for (const m of text.matchAll(/<port_(\d+)>/g)) {
		if (parseInt(m[1], 10) !== METER_NULL_CONSUMER_INDEX) return true
	}
	return false
}

/**
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel
 * @param {{ force?: boolean }} [opts] `force` attaches even when the channel has another consumer —
 *   used by the staleness-driven repair path (`meter-health.js`), where measured dead OSC is proof
 *   the channel is not ticking whatever its consumer list claims.
 * @returns {Promise<boolean>}
 */
async function ensureMeterNullConsumer(amcp, channel, opts = {}) {
	if (!amcp?.isConnected) return false
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return false
	const uri = meterNullStreamUri(ch)
	try {
		const info = await amcp.info(ch)
		const text = amcpInfoText(info)
		if (text.includes(uri) || text.includes(`port_${METER_NULL_CONSUMER_INDEX}`)) return true
		if (!opts.force && channelHasNonMeterConsumer(text)) return false
	} catch {
		/* proceed with ADD — failing open keeps meters over performance */
	}
	const cmd = `ADD ${ch}-${METER_NULL_CONSUMER_INDEX} STREAM ${uri} ${METER_NULL_FORMAT_ARGS}`
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
 * All Caspar channel indices that should receive a meter-null consumer on startup.
 * Prefer live INFO CONFIG (authoritative channel list); fall back to routing map.
 * @param {object} [config]
 * @param {string} [infoConfigXml]
 * @returns {number[]}
 */
function listMeterNullTargetChannels(config, infoConfigXml) {
	const channels = new Set()
	const add = (ch) => {
		const n = parseInt(String(ch), 10)
		if (Number.isFinite(n) && n >= 1) channels.add(n)
	}
	const xml = String(infoConfigXml || '').trim()
	if (xml) {
		for (const row of parseChannelVideoModesFromInfoConfigXml(xml)) add(row.index)
	}
	if (channels.size === 0 && config) {
		const { getChannelMap } = require('../config/routing-map')
		const map = getChannelMap(config)
		for (const ch of map.programChannels || []) add(ch)
		for (const ch of map.previewChannels || []) add(ch)
		for (const ch of map.multiviewChannels || []) add(ch)
		add(map.multiviewCh)
		add(map.streamingCh)
		add(map.monitorCh)
		add(map.inputsCh)
		for (const ch of map.liveAudioInputChannels || []) add(ch)
		for (const ch of map.decklinkInputChannels || []) add(ch)
		for (const ch of map.audioOnlyChannels || []) add(ch)
		for (const ch of map.mappingChannels || []) add(ch)
		for (const ch of map.switcherBusChannels || []) add(ch)
		for (const ch of map.switcherBus1Channels || []) add(ch)
	}
	return [...channels].sort((a, b) => a - b)
}

/**
 * Ensure meter-null STREAM consumers on every configured Caspar channel (connect / routing setup).
 * @param {object} ctx app context (amcp, config, gatheredInfo, log)
 */
async function ensureAllMeterNullConsumers(ctx) {
	const channels = listMeterNullTargetChannels(ctx?.config, ctx?.gatheredInfo?.infoConfig)
	return ensureMeterNullConsumersForChannels(ctx, channels)
}

/**
 * @param {object} ctx app context (amcp, config, log)
 * @param {number[]} channels
 */
async function ensureMeterNullConsumersForChannels(ctx, channels) {
	if (!isMeterNullConsumerEnabled(ctx?.config)) return []
	if (!ctx?.amcp?.isConnected || !Array.isArray(channels) || !channels.length) return []
	const ok = []
	const skipped = []
	const failed = []
	for (const ch of channels) {
		try {
			if (await ensureMeterNullConsumer(ctx.amcp, ch)) ok.push(ch)
			else skipped.push(ch)
		} catch (e) {
			failed.push({ channel: ch, message: e?.message || String(e) })
		}
	}
	if (ok.length && typeof ctx.log === 'function') {
		const label = ok.length > 6 ? `${ok.length} channels (${ok.slice(0, 5).join(', ')}…)` : ok.join(', ')
		ctx.log('info', `[meter] null STREAM consumer on ${label} (OSC tick)`)
	}
	if (skipped.length && typeof ctx.log === 'function') {
		ctx.log('info', `[meter] skipped ${skipped.join(', ')} — already have a consumer (WO-500)`)
	}
	if (failed.length && typeof ctx.log === 'function') {
		ctx.log('warn', `[meter] null consumer failed: ${JSON.stringify(failed)}`)
	}
	return ok
}

module.exports = {
	METER_NULL_CONSUMER_INDEX,
	METER_UDP_PORT_BASE,
	METER_NULL_FORMAT_ARGS,
	meterNullStreamUri,
	channelHasNonMeterConsumer,
	isMeterNullConsumerEnabled,
	listMeterNullTargetChannels,
	ensureAllMeterNullConsumers,
	ensureMeterNullConsumer,
	removeMeterNullConsumer,
	ensureMeterNullConsumersForChannels,
}
