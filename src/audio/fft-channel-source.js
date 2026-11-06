'use strict'

/**
 * WO-976 — a Caspar channel (a screen destination's PGM / PRV) as the audio-reactive FFT source.
 *
 * Source model (casparServer flat keys, so project slices carry them): `audio_fft_source_kind` ('slot'|'channel'|'none'),
 * `audio_fft_source_dest` (screen destination number, 1-based), `audio_fft_source_bus` ('pgm'|'prv'). The legacy
 * `audio_fft_source_slot` stays readable: no kind (or kind 'slot') = `{ kind:'slot', slot }`. The destination is resolved
 * to the Caspar channel through the channel map at apply time, never stored as a channel number (operator-first renumbers).
 *
 * Server side the channel's mix is teed by a runtime STREAM consumer at a fixed index to udp://127.0.0.1:52230. Caspar
 * ignores `-ac 2` and sends its full channel layout (~16 ch, 1.5 MB/s); `-filter:a pan=stereo|c0=c0|c1=c1` makes it
 * stereo s16le/48k (190 kB/s, probed 06.11), the shape the FFT engine already takes from the slot tees.
 * Runtime consumers are invisible to config diffs, so every live-audio setup re-runs syncFftChannelConsumer.
 */

const { getChannelMap, readCasparSetting } = require('../config/routing-map')
const { resolveAudioFftSourceSlot, listConfiguredLiveAudioSlots } = require('../config/live-audio-input')
const { amcpInfoText } = require('../streaming/caspar-ffmpeg-setup')

/** Above the 720/701/710/96/97 internal consumers; one fixed index, REMOVEd by index. */
const FFT_CHANNEL_CONSUMER_INDEX = 9276
/** Outside the 52221-52228 live-audio slot tees. */
const FFT_CHANNEL_UDP_PORT = 52230
const FFT_CHANNEL_FORMAT_ARGS =
	'-vn -codec:a pcm_s16le -ar 48000 -filter:a pan=stereo|c0=c0|c1=c1 -format s16le'

/** @returns {{kind:'none'}|{kind:'slot',slot:number}|{kind:'channel',destination:number,bus:'pgm'|'prv'}} */
function resolveAudioFftSource(cfg) {
	const kind = String(readCasparSetting(cfg, 'audio_fft_source_kind') ?? '')
	if (kind === 'none') return { kind: 'none' }
	if (kind === 'channel') {
		const destination = parseInt(String(readCasparSetting(cfg, 'audio_fft_source_dest') ?? ''), 10)
		const bus = String(readCasparSetting(cfg, 'audio_fft_source_bus')) === 'prv' ? 'prv' : 'pgm'
		if (Number.isFinite(destination) && destination >= 1) return { kind: 'channel', destination, bus }
	}
	const slot = resolveAudioFftSourceSlot(cfg)
	return slot >= 1 ? { kind: 'slot', slot } : { kind: 'none' }
}

/** Caspar channel for a destination source through the current channel map, or null (missing screen / no PRV). */
function resolveFftSourceChannel(cfg, source = resolveAudioFftSource(cfg)) {
	if (source.kind !== 'channel') return null
	const map = getChannelMap(cfg)
	if (source.destination > map.screenCount) return null
	const ch = source.bus === 'prv' ? map.previewCh(source.destination) : map.programCh(source.destination)
	return Number.isInteger(ch) && ch >= 1 ? ch : null
}

const fftChannelAddCommand = (ch) =>
	`ADD ${ch}-${FFT_CHANNEL_CONSUMER_INDEX} STREAM udp://127.0.0.1:${FFT_CHANNEL_UDP_PORT}?pkt_size=1316 ${FFT_CHANNEL_FORMAT_ARGS}`
const fftChannelRemoveCommand = (ch) => `REMOVE ${ch}-${FFT_CHANNEL_CONSUMER_INDEX}`

/** Picker id ('none' | 'slot:N' | 'channel:D:pgm|prv') → the casparServer keys to store. */
function fftSourceKeysFromId(id) {
	const m = /^channel:(\d+):(pgm|prv)$/.exec(String(id))
	if (m) return { audio_fft_source_kind: 'channel', audio_fft_source_dest: parseInt(m[1], 10), audio_fft_source_bus: m[2] }
	const s = /^slot:([1-8])$/.exec(String(id))
	if (s) return { audio_fft_source_kind: 'slot', audio_fft_source_slot: parseInt(s[1], 10) }
	return { audio_fft_source_kind: 'none', audio_fft_source_slot: 0 }
}

/** Apply `audio_fft_source` (picker id) or legacy `audio_fft_source_slot` from a live-inputs/config body onto `cs`. */
function applyFftSourceBody(cs, b) {
	if (b.audio_fft_source != null) return Object.assign(cs, fftSourceKeysFromId(b.audio_fft_source))
	if (b.audio_fft_source_slot == null) return cs
	const n = parseInt(String(b.audio_fft_source_slot), 10)
	cs.audio_fft_source_slot = Number.isFinite(n) && n >= 1 && n <= 8 ? n : 0
	if (cs.audio_fft_source_slot >= 1) cs.audio_fft_source_kind = 'slot' // the slot tick wins over a channel pick
	return cs
}

/** { source: <picker id>, options: [{ id, label }] } for the "Audio-reactive source" picker. */
function describeFftSource(cfg) {
	const cur = resolveAudioFftSource(cfg)
	const map = getChannelMap(cfg)
	const options = [{ id: 'none', label: 'None (OSC levels only)' }]
	for (const s of listConfiguredLiveAudioSlots(cfg).slots) options.push({ id: `slot:${s.slot}`, label: `Input slot ${s.slot}` })
	for (let d = 1; d <= map.screenCount; d++) {
		options.push({ id: `channel:${d}:pgm`, label: `Screen ${d} program (ch ${map.programCh(d)})` })
		if (map.previewCh(d) != null) options.push({ id: `channel:${d}:prv`, label: `Screen ${d} preview (ch ${map.previewCh(d)})` })
	}
	const id = cur.kind === 'slot' ? `slot:${cur.slot}` : cur.kind === 'channel' ? `channel:${cur.destination}:${cur.bus}` : 'none'
	return { source: id, channel: resolveFftSourceChannel(cfg, cur), options }
}

/**
 * Make Caspar match the configured source: REMOVE the consumer from a channel it moved away from, ADD it (idempotent via
 * INFO) on the resolved channel. Call after the engine's UDP listener is bound. State lives on ctx._fftChannelConsumer.
 * @returns {Promise<{ channel: number|null, added: boolean, removed: number[] }>}
 */
async function syncFftChannelConsumer(ctx) {
	const out = { channel: null, added: false, removed: [] }
	const amcp = ctx?.amcp
	if (!amcp?.isConnected) return out
	const want = resolveFftSourceChannel(ctx.config)
	const st = (ctx._fftChannelConsumer ||= { channel: null, swept: false })
	const stale = new Set(st.channel != null ? [st.channel] : [])
	if (!st.swept) {
		// First sync of this node process: a consumer left by an earlier process may sit on any PGM/PRV (blind UDP send).
		st.swept = true
		const m = getChannelMap(ctx.config)
		for (const c of [...(m.programChannels || []), ...(m.previewChannels || [])]) if (Number.isInteger(c)) stale.add(c)
	}
	if (want != null) stale.delete(want)
	for (const ch of stale) {
		try {
			const text = amcpInfoText(await amcp.info(ch))
			if (st.channel !== ch && !text.includes(`port_${FFT_CHANNEL_CONSUMER_INDEX}`)) continue
			await amcp.raw(fftChannelRemoveCommand(ch))
			out.removed.push(ch)
		} catch {
			/* absent / channel gone */
		}
	}
	st.channel = null
	if (want == null) return out
	try {
		const text = amcpInfoText(await amcp.info(want))
		if (!text.includes(`port_${FFT_CHANNEL_CONSUMER_INDEX}`)) {
			await amcp.raw(fftChannelAddCommand(want))
			out.added = true
		}
		st.channel = out.channel = want
		if (out.added) ctx.log?.('info', `[AudioFFT] STREAM consumer ${want}-${FFT_CHANNEL_CONSUMER_INDEX} → udp:${FFT_CHANNEL_UDP_PORT}`)
	} catch (e) {
		ctx.log?.('warn', `[AudioFFT] channel consumer on ${want}: ${e?.message || e}`)
	}
	return out
}

module.exports = {
	FFT_CHANNEL_CONSUMER_INDEX,
	FFT_CHANNEL_UDP_PORT,
	FFT_CHANNEL_FORMAT_ARGS,
	resolveAudioFftSource,
	resolveFftSourceChannel,
	fftChannelAddCommand,
	fftChannelRemoveCommand,
	fftSourceKeysFromId,
	applyFftSourceBody,
	describeFftSource,
	syncFftChannelConsumer,
}
