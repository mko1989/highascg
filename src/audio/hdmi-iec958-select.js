'use strict'

/**
 * WO-779 follow-up (owner 29.10): the pre-launch unmute turns on the `IEC958 Playback Switch` of the audio output(s)
 * set in the Devices tab ONLY — switches the operator turned off on other HDMI/DP outputs stay off.
 *
 * Selected outputs = `audioOutputs` (config/audio_outputs.json): the server's one PortAudio row (WO-683, the device
 * Caspar opens) plus every enabled system-audio row. A device name resolves to card + PCM device from `hw:C,D`,
 * `plughw:C,D`, `…(hw:C,D)`, `hw:CARD=Id,DEV=D` or `hdmi:CARD=Id,DEV=n` (n-th HDMI PCM).
 *
 * Switch ↔ PCM on HDA HDMI codecs (patch_hdmi): per HDMI PCM, in PCM order, the kernel creates the
 * `HDMI/DP,pcm=D Jack`, then the IEC958 set (index = the PCM's rank), then the `ELD` (device=D) — on the box
 * (26.10, card 1): jack pcm=3 numid 1, switch numid 5 (index 0), ELD numid 6; pcm=7 → numid 11 (index 1) …
 * A switch is accepted only when BOTH agree: index == rank of D among the card's HDMI PCMs, and the nearest
 * jack/ELD control created before it belongs to D. Anything else → unresolved, nothing is switched.
 */

/**
 * `amixer -c C controls` → HDMI jacks, ELD controls, IEC958 Playback Switches (numid + index).
 * @param {string} text
 */
function parseAmixerControls(text) {
	const jacks = []
	const elds = []
	const switches = []
	for (const line of String(text || '').split('\n')) {
		const m = line.match(/^numid=(\d+),iface=(\w+),name='([^']*)'(.*)$/)
		if (!m) continue
		const numid = parseInt(m[1], 10)
		const jack = m[3].match(/^HDMI\/DP,pcm=(\d+) Jack$/)
		if (jack) jacks.push({ pcm: parseInt(jack[1], 10), numid })
		else if (m[2] === 'PCM' && m[3] === 'ELD') {
			const dev = m[4].match(/,device=(\d+)/)
			if (dev) elds.push({ pcm: parseInt(dev[1], 10), numid })
		} else if (m[2] === 'MIXER' && m[3] === 'IEC958 Playback Switch') {
			const idx = m[4].match(/,index=(\d+)/)
			switches.push({ index: idx ? parseInt(idx[1], 10) : 0, numid })
		}
	}
	jacks.sort((a, b) => a.pcm - b.pcm)
	switches.sort((a, b) => a.index - b.index)
	return { jacks, elds, switches }
}

/**
 * `/proc/asound/cards` → card id (e.g. "NVidia") → index.
 * @param {string} text
 * @returns {Map<string, number>}
 */
function parseAsoundCards(text) {
	const out = new Map()
	for (const line of String(text || '').split('\n')) {
		const m = line.match(/^\s*(\d+)\s+\[([^\]\s]+)\s*\]/)
		if (m) out.set(m[2].toLowerCase(), parseInt(m[1], 10))
	}
	return out
}

/**
 * @param {string} deviceName
 * @param {Map<string, number>} cardIds
 * @returns {{ card: number, pcm?: number, hdmiRank?: number } | null}
 */
function parseDeviceName(deviceName, cardIds) {
	const s = String(deviceName || '').trim()
	let m = s.match(/(?:^|[^a-z])(?:plug)?hw:(\d+),(\d+)/i)
	if (m) return { card: parseInt(m[1], 10), pcm: parseInt(m[2], 10) }
	const card = (id) => (/^\d+$/.test(id) ? parseInt(id, 10) : cardIds.get(id.toLowerCase()))
	m = s.match(/(?:^|[^a-z])(?:plug)?hw:CARD=([^,\s)]+),DEV=(\d+)/i)
	if (m && card(m[1]) != null) return { card: /** @type {number} */ (card(m[1])), pcm: parseInt(m[2], 10) }
	m = s.match(/^hdmi:CARD=([^,\s)]+)(?:,DEV=(\d+))?/i)
	if (m && card(m[1]) != null) return { card: /** @type {number} */ (card(m[1])), hdmiRank: parseInt(m[2] || '0', 10) }
	return null
}

/**
 * @param {ReturnType<typeof parseAmixerControls>} ctl
 * @param {{ pcm?: number, hdmiRank?: number }} want
 * @returns {{ ok: true, pcm: number, index: number, numid: number } | { ok: false, notHdmi?: boolean, reason: string }}
 */
function switchForPcm(ctl, want) {
	const rank = want.hdmiRank != null ? want.hdmiRank : ctl.jacks.findIndex((j) => j.pcm === want.pcm)
	if (rank < 0 || rank >= ctl.jacks.length) {
		return { ok: false, notHdmi: true, reason: want.pcm != null ? `pcm ${want.pcm} is not an HDMI/DP PCM` : 'no such HDMI PCM' }
	}
	const pcm = ctl.jacks[rank].pcm
	if (ctl.switches.length !== ctl.jacks.length) {
		return { ok: false, reason: `${ctl.jacks.length} HDMI jack(s) vs ${ctl.switches.length} IEC958 switch(es)` }
	}
	const sw = ctl.switches[rank]
	if (sw.index !== rank) return { ok: false, reason: `IEC958 switch indices are not 0…${ctl.switches.length - 1}` }
	const anchors = [...ctl.jacks, ...ctl.elds].filter((a) => a.numid < sw.numid).sort((a, b) => b.numid - a.numid)
	if (!anchors.length || anchors[0].pcm !== pcm) {
		return { ok: false, reason: `IEC958 index ${rank} (numid ${sw.numid}) does not sit in pcm ${pcm}'s controls` }
	}
	return { ok: true, pcm, index: rank, numid: sw.numid }
}

/**
 * The outputs set in the Devices tab whose card switch matters: the PortAudio output + enabled system-audio rows.
 * @param {unknown} audioOutputs
 * @returns {Array<{ id: string, deviceName: string }>}
 */
function selectedAudioOutputs(audioOutputs) {
	const { isPortAudioRow, portAudioOutputId } = require('../config/portaudio-output')
	const list = Array.isArray(audioOutputs) ? audioOutputs : []
	const paId = portAudioOutputId(list)
	const out = []
	for (const o of list) {
		if (!o || typeof o !== 'object' || o.enabled === false || o.enabled === 'false') continue
		const id = String(o.id || '').trim()
		const sys = String(o.type || '').toLowerCase() === 'system-audio'
		if (!sys && !(isPortAudioRow(o) && id && id === paId)) continue
		out.push({ id: id || '?', deviceName: String(o.deviceName || '').trim() })
	}
	return out
}

/**
 * @param {{ audioOutputs: unknown, cardsText: string, controls: (card: number) => string }} io
 * @returns {{ on: Array<{ card: number, numid: number, index: number, what: string }>, notes: string[] }}
 */
function resolveSelectedIec958(io) {
	const cardIds = parseAsoundCards(io.cardsText)
	const on = []
	const notes = []
	const outputs = selectedAudioOutputs(io.audioOutputs)
	if (!outputs.length) notes.push('no audio output set in Devices')
	/** @type {Map<number, ReturnType<typeof parseAmixerControls>>} */
	const perCard = new Map()
	for (const o of outputs) {
		const tag = `${o.id} ${o.deviceName || '(default)'}`
		const dev = parseDeviceName(o.deviceName, cardIds)
		if (!dev) {
			notes.push(`${tag}: not an ALSA hw device — HDMI switches untouched`)
			continue
		}
		if (!perCard.has(dev.card)) perCard.set(dev.card, parseAmixerControls(io.controls(dev.card)))
		const r = switchForPcm(/** @type {any} */ (perCard.get(dev.card)), dev)
		if (!r.ok) {
			notes.push(`${tag}: ${r.notHdmi ? 'not HDMI/DP' : `unresolved (${r.reason})`} — HDMI switches untouched`)
			continue
		}
		if (on.some((x) => x.card === dev.card && x.numid === r.numid)) continue
		on.push({ card: dev.card, numid: r.numid, index: r.index, what: `${o.id}:hw:${dev.card},${r.pcm}` })
	}
	return { on, notes }
}

module.exports = {
	parseAmixerControls,
	parseAsoundCards,
	parseDeviceName,
	switchForPcm,
	selectedAudioOutputs,
	resolveSelectedIec958,
}
