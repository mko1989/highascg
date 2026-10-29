'use strict'

/**
 * WO-801 — headphone pair monitor: hear one stereo pair of the monitor bus (1+2 … 15+16) instead of the
 * OpenAL downmix of all of them.
 *
 * Every Caspar channel on this build carries 16 discrete audio channels (`core/video_format.h:106`), so PRV and
 * the monitor channel already hold the look's pairs; the fold to stereo happens only in the monitor's OpenAL
 * consumer (`oal_consumer.cpp`, swr hexadecagonal → stereo). A pair is picked by swapping that consumer for an
 * ffmpeg STREAM consumer that writes the selected pair to the same ALSA device:
 *
 *   pair: REMOVE <mon>-500                          (the OAL consumer — the headset is single-open)
 *         ADD <mon>-730 STREAM plug:<dev> -format alsa -filter:a pan=stereo|c0=cA|c1=cB
 *   mix:  REMOVE <mon>-730
 *         ADD <mon>-500 AUDIO [DEVICE_NAME <dev>]   (retried while ALSA lets go of the device)
 *
 * The `alsa` muxer has no video codec (no frame readback) and writes pcm_s16le; a path with a colon is not
 * treated as a media file by the consumer. Not PortAudio — WO-683's single PortAudio output is untouched.
 */

const { getChannelMap } = require('../config/routing-map')
const { normalizeAudioPreview, resolveAudioPreviewChannel } = require('../config/audio-preview')
const { resolveMonitorBus } = require('../config/monitor-bus')
const { routeSourceChannelsToAudioFilter } = require('../engine/audio-route')

/** OpenAL (`<system-audio>`) consumer port — `oal_consumer.cpp` `index()`. */
const OAL_CONSUMER_INDEX = 500
/** Internal long-lived consumer range 7xx (compose 701, v4l2 710/711, meter-null 720). */
const MONITOR_PAIR_CONSUMER_INDEX = 730
const MONITOR_PAIRS = ['mix', '1+2', '3+4', '5+6', '7+8', '9+10', '11+12', '13+14', '15+16']
const OAL_RETRY_MS = [250, 500, 1000, 2000]

/** @param {unknown} v @returns {string} a MONITOR_PAIRS entry ('mix' for anything else) */
function normalizeMonitorPair(v) {
	const s = String(v ?? '').trim().toLowerCase()
	return MONITOR_PAIRS.includes(s) ? s : 'mix'
}

/** @param {unknown} v */
function isMonitorPair(v) {
	return typeof v === 'string' && MONITOR_PAIRS.includes(v.trim().toLowerCase())
}

/**
 * The device the monitor bus plays on (what the generated `<system-audio><device-name>` carries).
 * @param {object} config app config
 * @returns {string} '' = the OpenAL / ALSA default
 */
function monitorDeviceName(config) {
	const ap = normalizeAudioPreview(config)
	if (ap.enabled) return ap.deviceName
	return resolveMonitorBus(config).deviceName
}

/**
 * ALSA PCM for the ffmpeg consumer. A bare name (`sc60mon`) gets `plug:` (rate/format conversion, and the colon
 * keeps the consumer from treating it as a file under media/); a name with a colon is used as is.
 * @param {string} name
 */
function alsaPcmName(name) {
	const n = String(name || '').trim()
	if (!n) return 'plug:default'
	return n.includes(':') ? n : `plug:${n}`
}

/** AMCP parameter: quoted when it has spaces. */
function amcpParam(v) {
	const s = String(v)
	return /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
}

/**
 * @param {number} ch monitor channel
 * @param {string} pair '1+2' … '15+16'
 * @param {string} device monitor device name
 * @returns {string[]}
 */
function pairCommands(ch, pair, device) {
	const pan = routeSourceChannelsToAudioFilter(pair, '16ch')
	if (!pan) throw new Error(`invalid pair ${pair}`)
	return [
		`REMOVE ${ch}-${OAL_CONSUMER_INDEX}`,
		`ADD ${ch}-${MONITOR_PAIR_CONSUMER_INDEX} STREAM ${amcpParam(alsaPcmName(device))} -format alsa -filter:a ${pan}`,
	]
}

/**
 * @param {number} ch
 * @param {string} device
 * @returns {string[]}
 */
function mixCommands(ch, device) {
	const dev = String(device || '').trim()
	return [
		`REMOVE ${ch}-${MONITOR_PAIR_CONSUMER_INDEX}`,
		`ADD ${ch}-${OAL_CONSUMER_INDEX} AUDIO${dev ? ` DEVICE_NAME ${amcpParam(dev)}` : ''}`,
	]
}

/** The channel that carries the headphone consumer (the audio-preview bus when enabled, else the monitor bus). */
function monitorChannel(config) {
	const map = getChannelMap(config)
	const ch = resolveAudioPreviewChannel(config, map) ?? map.monitorCh
	return ch != null && Number.isFinite(Number(ch)) ? Number(ch) : null
}

/** @returns {Promise<{ ok: boolean, data: string }>} never throws */
async function run(amcp, line) {
	try {
		const r = await amcp.raw(line)
		if (r && r.ok === false) return { ok: false, data: String(r.data ?? 'failed') }
		return { ok: true, data: String(r?.data ?? '') }
	} catch (e) {
		return { ok: false, data: e?.message || String(e) }
	}
}

/** `INFO <ch>` → which of our two ports the channel carries. */
async function consumerPorts(amcp, ch) {
	try {
		const info = await amcp.info(ch)
		const d = info?.data
		const text = Array.isArray(d) ? d.join('\n') : String(d ?? '')
		return { oal: text.includes(`<port_${OAL_CONSUMER_INDEX}>`), pair: text.includes(`<port_${MONITOR_PAIR_CONSUMER_INDEX}>`), text }
	} catch (e) {
		return { oal: false, pair: false, text: '', error: e?.message || String(e) }
	}
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Put the monitor output on `pair` ('mix' = the OpenAL downmix of the config).
 * @param {object} ctx app context ({ amcp, config, log? })
 * @param {string} pair
 * @param {{ sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, pair: string, monitorCh: number|null, commands: string[], error?: string }>}
 */
async function applyMonitorPair(ctx, pair, opts = {}) {
	const p = normalizeMonitorPair(pair)
	const sleep = opts.sleep || defaultSleep
	const ch = monitorChannel(ctx?.config)
	const out = { ok: false, status: 400, pair: p, monitorCh: ch, commands: [] }
	if (ch == null) return { ...out, error: 'No monitor output (add an audio output with role Monitor, or enable audio preview)' }
	if (!ctx?.amcp) return { ...out, status: 503, error: 'Caspar not connected' }
	const ports = await consumerPorts(ctx.amcp, ch)
	if (!ports.oal && !ports.pair) {
		return { ...out, status: 409, error: `Caspar channel ${ch} has no headphone consumer (port ${OAL_CONSUMER_INDEX}/${MONITOR_PAIR_CONSUMER_INDEX}) — Apply the Caspar config first` }
	}
	const device = monitorDeviceName(ctx.config)
	if (p === 'mix') {
		if (ports.oal && !ports.pair) return { ...out, ok: true, status: 200 }
		const rm = mixCommands(ch, device)[0]
		out.commands.push(rm)
		await run(ctx.amcp, rm) // 404 when it is already gone is fine
		await sleep(OAL_RETRY_MS[0])
		const back = await addOal(ctx.amcp, ch, device, sleep, out.commands)
		return back.ok ? { ...out, ok: true, status: 200 } : { ...out, status: 502, error: back.error }
	}
	const cmds = pairCommands(ch, p, device)
	const rm = ports.pair ? `REMOVE ${ch}-${MONITOR_PAIR_CONSUMER_INDEX}` : cmds[0]
	out.commands.push(rm)
	const r0 = await run(ctx.amcp, rm)
	if (!r0.ok && !ports.pair) return { ...out, status: 502, error: `${rm}: ${r0.data}` }
	await sleep(OAL_RETRY_MS[0]) // let the old consumer close the single-open device
	out.commands.push(cmds[1])
	const r = await run(ctx.amcp, cmds[1])
	if (!r.ok) {
		// Never leave the headphones without a consumer: put the OpenAL one back.
		await addOal(ctx.amcp, ch, device, sleep, out.commands)
		return { ...out, status: 502, error: `${cmds[1]}: ${r.data}` }
	}
	return { ...out, ok: true, status: 200 }
}

/** `ADD <ch>-500 AUDIO …`, retried: the OpenAL consumer opens the device in its constructor and fails while busy. */
async function addOal(amcp, ch, device, sleep, log) {
	const add = mixCommands(ch, device)[1]
	let last = { ok: false, data: '' }
	for (let i = 0; i <= OAL_RETRY_MS.length; i++) {
		log.push(add)
		last = await run(amcp, add)
		if (last.ok) return { ok: true }
		if (i < OAL_RETRY_MS.length) await sleep(OAL_RETRY_MS[i])
	}
	return { ok: false, error: `${add}: ${last.data}` }
}

/**
 * Caspar (re)connect: a restarted Caspar comes back with only the config's OpenAL port, so a stored pair is applied
 * again. 'mix' touches nothing; a channel that already carries the pair port is left alone (node-only restart).
 * @param {object} ctx
 * @param {string} storedPair
 */
async function reassertMonitorPair(ctx, storedPair) {
	const p = normalizeMonitorPair(storedPair)
	if (p === 'mix' || !ctx?.amcp) return { ok: true, skipped: true, pair: p }
	const ch = monitorChannel(ctx.config)
	if (ch == null) return { ok: false, skipped: true, pair: p }
	const ports = await consumerPorts(ctx.amcp, ch)
	if (ports.pair && !ports.oal) return { ok: true, skipped: true, pair: p }
	return applyMonitorPair(ctx, p)
}

module.exports = {
	MONITOR_PAIRS,
	normalizeMonitorPair,
	isMonitorPair,
	monitorDeviceName,
	alsaPcmName,
	pairCommands,
	mixCommands,
	monitorChannel,
	applyMonitorPair,
	reassertMonitorPair,
}
