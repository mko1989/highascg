'use strict'

/**
 * WO-1092 — where LTC out plays, as ALSA sees it. Pure: no file or process access (the caller passes the text of
 * /proc/asound/cards). Two cases:
 *
 *  - LTC has the card to itself: the encoder opens `plughw:CARD=<id>,DEV=<n>` with all of the card's channels and puts
 *    LTC on the chosen channel (or pair); the other channels carry silence.
 *  - The card is the program audio output (Caspar's PortAudio consumer — WO-683: one per server): two openers of one
 *    hw device need a sharing plug. Both sides go through ALSA `dshare` over the same slave, on disjoint channels:
 *      hcg_prog_<card>_<dev>  plug (ttable) → dshare, bindings = the program channels that are not LTC's
 *      hcg_ltc_<card>_<dev>   plug → dshare, bindings = the LTC channel(s)
 *    Caspar's device-name becomes hcg_prog_… (build-caspar-generator-config-audio.js), LTC opens hcg_ltc_…. dshare keeps a
 *    channel mask in shared memory, so the two can never write the same channel: program cannot bleed into LTC's channel,
 *    LTC never reaches the program channels — and LTC never enters Caspar, so record / stream / NDI (Caspar consumers)
 *    cannot carry it. The definitions are a managed block in ~/.asoundrc (ltc-share-io.js), per user, no root needed.
 */

const { channelCountFromLayout, normalizeProgramLayout } = require('../config/audio-channel-layouts')
const { portAudioOutputId } = require('../config/portaudio-output')

const BLOCK_BEGIN = '# >>> HighAsCG LTC channel share (managed block, do not edit) >>>'
const BLOCK_END = '# <<< HighAsCG LTC channel share <<<'
const SLAVE_PERIOD = 256 // frames: 5.3 ms at 48 kHz, as Caspar's direct open used (hw_params period 256)
const SLAVE_BUFFER = 1024 // 21 ms

/**
 * "hw:0,0", "plughw:CARD=PCH,DEV=0", "hw:PCH", "HDA Intel PCH: ALC1220 Analog (hw:0,0)" → { card, dev }; else null.
 * @param {unknown} name
 */
function parseAlsaHw(name) {
	const s = String(name || '')
	let m = /(?:plug)?hw:CARD=([A-Za-z0-9_-]+)(?:,DEV=(\d+))?/i.exec(s)
	if (!m) m = /(?:plug)?hw:([A-Za-z0-9_-]+)(?:,(\d+))?/.exec(s)
	return m ? { card: m[1], dev: m[2] ? parseInt(m[2], 10) : 0 } : null
}

/** /proc/asound/cards → [{ index, id, name }] */
function parseCards(text) {
	const out = []
	for (const line of String(text || '').split('\n')) {
		const m = /^\s*(\d+)\s+\[([^\]]+?)\s*\]:\s*\S+\s+-\s+(.*)$/.exec(line)
		if (m) out.push({ index: parseInt(m[1], 10), id: m[2].trim(), name: m[3].trim() })
	}
	return out
}

/** A card given by index or id → { index, id, name } (null = not present now). */
function findCard(card, cards) {
	const c = String(card)
	return cards.find((x) => (/^\d+$/.test(c) ? x.index === parseInt(c, 10) : x.id === c)) || null
}

/** The server's program audio output (the PortAudio row), with its channel count. */
function programOutput(appConfig) {
	const outs = Array.isArray(appConfig?.audioOutputs) ? appConfig.audioOutputs : []
	const id = portAudioOutputId(outs)
	const row = id ? outs.find((o) => String(o?.id) === id) : null
	if (!row) return null
	const layout = normalizeProgramLayout(String(row.channelLayout || 'stereo'))
	return { id, label: String(row.label || id), deviceName: String(row.deviceName || ''), layout, channels: channelCountFromLayout(layout) }
}

const token = (s) => String(s).replace(/[^A-Za-z0-9]/g, '_')

/** WO-1106 B6 — operator labels land inside a quoted ~/.asoundrc string: one stray `"` or `}` breaks every ALSA client. */
const alsaText = (s) => String(s).replace(/[\r\n]+/g, ' ').replace(/["\\{}]/g, '').trim()

/**
 * Where LTC out goes, or why it cannot.
 * @param {object} out normalized config.ltc.output
 * @param {object} appConfig  (audioOutputs)
 * @param {string} cardsText  /proc/asound/cards
 * @param {{ channels?: number }} [probe] the device's channel count when known (ltc-devices.js)
 * @returns {{ ok: boolean, problem?: string, share?: boolean, pcm?: string, channels?: number, positions?: number[],
 *   ltcChannels?: number[], label?: string, cardId?: string|null, present?: boolean, program?: object|null,
 *   progPcm?: string, block?: string|null, deviceChannels?: number }}
 */
function resolveLtcTarget(out, appConfig, cardsText, probe = {}) {
	const prog = programOutput(appConfig)
	const cards = parseCards(cardsText)
	const wantsProgram = out.device === 'program'
	const dev = wantsProgram ? prog?.deviceName : out.device
	if (!dev) return { ok: false, problem: wantsProgram ? 'no program audio output to share' : 'no output device chosen' }
	const hw = parseAlsaHw(dev)
	const card = hw ? findCard(hw.card, cards) : null
	const progHw = prog ? parseAlsaHw(prog.deviceName) : null
	const progCard = progHw ? findCard(progHw.card, cards) : null
	const share = !!(hw && progHw && (wantsProgram || (card && progCard && card.index === progCard.index && hw.dev === progHw.dev)))
	const total = Math.max(1, Math.min(64, Number(probe.channels) || out.channels || 2))
	const width = out.pair ? 2 : 1
	const first = Math.max(1, Math.min(out.channel || 1, total - width + 1))
	const ltcChannels = width === 2 ? [first, first + 1] : [first]
	const cardId = card ? card.id : hw ? hw.card : null
	const present = hw ? !!card : true
	const label = card ? `${card.name}${hw.dev ? ` (device ${hw.dev})` : ''}` : dev
	if (!share) {
		const pcm = hw ? `plughw:CARD=${cardId},DEV=${hw.dev}` : dev
		return { ok: true, share: false, pcm, channels: total, positions: ltcChannels, ltcChannels, label, cardId, present, program: prog,
			deviceChannels: total }
	}
	const t = `${token(progCard ? progCard.id : progHw.card)}_${progHw.dev}`
	const progPcm = `hcg_prog_${t}`
	const progCh = Math.min(prog.channels, total)
	const progKeep = []
	for (let c = 1; c <= progCh; c++) if (!ltcChannels.includes(c)) progKeep.push(c)
	if (!progKeep.length) return { ok: false, problem: `LTC on channel ${ltcChannels.join('+')} would replace all of ${prog.label}` }
	const block = shareBlock({ t, slave: `hw:${progCard ? `CARD=${progCard.id}` : progHw.card},DEV=${progHw.dev}`, total, ltcChannels, progCh, progKeep,
		progLabel: prog.label })
	return { ok: true, share: true, pcm: `hcg_ltc_${t}`, channels: width, positions: width === 2 ? [1, 2] : [1], ltcChannels,
		label: `${prog.label} — ${label}`, cardId: progCard ? progCard.id : progHw.card, present: !!progCard, program: prog, progPcm, block,
		deviceChannels: total, silencedProgram: ltcChannels.filter((c) => c <= progCh) }
}

/** ipc_key for the dshare pair: stable per card/device, the same in both definitions (they must share one segment). */
function ipcKey(t) {
	let h = 0x48434700
	for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0
	return 0x40000000 | (h & 0x3fffffff)
}

/**
 * The ~/.asoundrc text for one shared card. Program client channel i (1-based) → its position among the kept channels
 * (`ttable`), LTC's channels are left out of the program PCM entirely.
 */
function shareBlock({ t, slave, total, ltcChannels, progCh, progKeep, progLabel }) {
	const key = ipcKey(t)
	const dshare = (bind) => `type dshare\n\t\tipc_key ${key}\n\t\tipc_perm 0660\n\t\tslave hcg_slave_${t}\n\t\tbindings { ${bind.map((c, i) => `${i} ${c - 1}`).join(' ')} }`
	const ttable = progKeep.map((c, i) => `${c - 1}.${i} 1`).join(' ')
	const lines = [
		`pcm_slave.hcg_slave_${t} {\n\tpcm "${slave}"\n\tchannels ${total}\n\trate 48000\n\tperiod_size ${SLAVE_PERIOD}\n\tbuffer_size ${SLAVE_BUFFER}\n}`,
		`pcm.hcg_prog_${t} {\n\ttype plug\n\tslave { pcm { ${dshare(progKeep).replace(/\n\t\t/g, ' ')} } channels ${progKeep.length} }\n\tttable { ${ttable} }\n` +
			`\thint { show on description "HighAsCG program audio ${alsaText(progLabel)} (channels ${progKeep.join(',')} of ${total}${progCh > progKeep.length ? `, ${progCh}-ch program` : ''})" }\n}`,
		`pcm.hcg_ltc_${t} {\n\ttype plug\n\tslave.pcm { ${dshare(ltcChannels).replace(/\n\t\t/g, ' ')} }\n` +
			`\thint { show on description "HighAsCG LTC out (channel ${ltcChannels.join('+')} of ${total})" }\n}`,
	]
	return lines.join('\n') + '\n'
}

/**
 * Caspar's PortAudio device for the program output: the shared program PCM while LTC shares that card, else its own
 * device name. Used by the casparcg.config generator.
 */
function programDeviceName(appConfig, out, cardsText) {
	const ltc = appConfig?.ltc?.output
	const own = String(out?.deviceName || '')
	if (!ltc || ltc.enabled !== true || ltc.sink === 'fifo') return own
	const r = resolveLtcTarget(ltc, appConfig, cardsText)
	return r.ok && r.share && String(r.program?.id) === String(out?.id) ? r.progPcm : own
}

module.exports = { BLOCK_BEGIN, BLOCK_END, parseAlsaHw, parseCards, resolveLtcTarget, programDeviceName, programOutput }
