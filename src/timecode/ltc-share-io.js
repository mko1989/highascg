'use strict'

/**
 * WO-1092 — the file / process side of ltc-share.js: what ALSA cards exist, how many channels a device has, who has it
 * open, and the managed ~/.asoundrc block that lets LTC and the program output share one card on disjoint channels.
 * HIGHASCG_ASOUND_ROOT (tests) replaces /proc/asound; HIGHASCG_ASOUNDRC (tests) replaces ~/.asoundrc.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { BLOCK_BEGIN, BLOCK_END, parseAlsaHw, parseCards, resolveLtcTarget, programOutput } = require('./ltc-share')
const { mergeAsoundrcBlock } = require('../audio/audio-devices')

const asoundRoot = () => process.env.HIGHASCG_ASOUND_ROOT || '/proc/asound'
const asoundrcPath = () => process.env.HIGHASCG_ASOUNDRC || path.join(os.homedir(), '.asoundrc')
const probeCache = new Map() // "card,dev" → channels (only from a real probe of a free device)

function read(p) {
	try {
		return fs.readFileSync(p, 'utf8')
	} catch {
		return ''
	}
}

function readCards() {
	return read(path.join(asoundRoot(), 'cards'))
}

/** Is the playback device open by someone, and with how many channels? */
function deviceUse(index, dev) {
	const sub = path.join(asoundRoot(), `card${index}`, `pcm${dev}p`, 'sub0')
	const status = read(path.join(sub, 'status')).trim()
	if (!status || status === 'closed') return { busy: false, openChannels: 0 }
	const m = /channels:\s*(\d+)/.exec(read(path.join(sub, 'hw_params')))
	return { busy: true, openChannels: m ? parseInt(m[1], 10) : 0 }
}

/** Most channels the device takes: asks ALSA when the device is free (cached), else what it is open with. */
function deviceChannels(index, dev, fallback = 2) {
	const key = `${index},${dev}`
	const use = deviceUse(index, dev)
	if (!use.busy && process.env.HIGHASCG_ASOUND_ROOT == null) {
		const r = spawnSync('aplay', ['-D', `hw:${index},${dev}`, '--dump-hw-params', '-t', 'raw', '-f', 'S16_LE', '-c', '1', '-r', '48000', '/dev/null'],
			{ encoding: 'utf8', timeout: 3000 })
		const m = /CHANNELS:\s*\[?(\d+)(?:\s+(\d+))?\]?/.exec(String(r.stderr || '') + String(r.stdout || ''))
		if (m) probeCache.set(key, parseInt(m[2] || m[1], 10))
	}
	return Math.max(probeCache.get(key) || 0, use.openChannels, use.busy ? fallback : 0) || fallback
}

/** Playback devices from /proc/asound/pcm → [{ card, id, dev, name }] */
function playbackDevices(cards) {
	const out = []
	for (const line of read(path.join(asoundRoot(), 'pcm')).split('\n')) {
		const m = /^(\d+)-(\d+):\s*([^:]*?)\s*:.*playback/.exec(line)
		if (!m) continue
		const card = cards.find((c) => c.index === parseInt(m[1], 10))
		if (card) out.push({ card: card.index, id: card.id, dev: parseInt(m[2], 10), name: m[3] })
	}
	return out
}

/**
 * GET /api/ltc/devices — what the LTC out device picker lists: the program output (shared), then every playback device
 * with its friendly name, channel count, whether it is open and by which configured output.
 */
function listLtcDevices(appConfig) {
	const cards = parseCards(readCards())
	const outs = Array.isArray(appConfig?.audioOutputs) ? appConfig.audioOutputs : []
	const prog = programOutput(appConfig)
	const progHw = prog ? parseAlsaHw(prog.deviceName) : null
	const ltc = appConfig?.ltc?.output || {}
	const ltcHw = parseAlsaHw(ltc.device === 'program' ? prog?.deviceName : ltc.device)
	const isCard = (h, d) => !!(h && (h.card === d.id || h.card === String(d.card)) && h.dev === d.dev)
	const usedBy = (c, dev) =>
		outs.filter((o) => o?.enabled !== false && (() => {
			const h = parseAlsaHw(o?.deviceName)
			const oc = h ? cards.find((x) => (/^\d+$/.test(h.card) ? x.index === +h.card : x.id === h.card)) : null
			return oc && oc.index === c && h.dev === dev
		})()).map((o) => String(o.label || o.id))
	const list = playbackDevices(cards).map((d) => {
		const use = deviceUse(d.card, d.dev)
		const isProg = isCard(progHw, d)
		// a device in use cannot be asked; the operator's stored count stands in for the LTC device (ALC1220: 6 while Caspar holds 2)
		const fallback = Math.max(isProg ? prog.channels : 2, isCard(ltcHw, d) ? Number(ltc.channels) || 2 : 2)
		return { value: `plughw:CARD=${d.id},DEV=${d.dev}`, label: `${cards.find((c) => c.index === d.card)?.name || d.id} — ${d.name}`,
			card: d.id, dev: d.dev, channels: deviceChannels(d.card, d.dev, fallback), busy: use.busy,
			usedBy: usedBy(d.card, d.dev), program: isProg, present: true }
	})
	const progRow = prog ? list.find((d) => d.program) : null
	const head = prog
		? [{ value: 'program', label: `Program audio output (${prog.label})`, card: progRow?.card || progHw?.card || null, dev: progHw?.dev ?? 0,
				channels: progRow ? progRow.channels : prog.channels, busy: !!progRow?.busy, usedBy: [prog.label], program: true, present: !!progRow,
				programChannels: prog.channels }]
		: []
	return { devices: [...head, ...list], program: prog }
}

/**
 * Resolve LTC out's target now (ltc-share.js) and keep ~/.asoundrc in step: the share block is written when LTC shares
 * the program card. It is never removed here while Caspar may still have the shared PCM open — the generator only stops
 * naming it after the operator applies; a stale block is harmless (unused PCM definitions).
 */
function currentTarget(out, appConfig) {
	const cardsText = readCards()
	const pre = resolveLtcTarget(out, appConfig, cardsText)
	if (!pre.ok) return { ...pre, present: true }
	const cards = parseCards(cardsText)
	const hw = parseAlsaHw(pre.share ? pre.program.deviceName : out.device)
	const card = hw ? cards.find((c) => c.id === hw.card || String(c.index) === hw.card) : null
	const probe = card ? { channels: deviceChannels(card.index, hw.dev, out.channels) } : {}
	const t = resolveLtcTarget(out, appConfig, cardsText, probe)
	if (t.ok && t.share && t.block) writeShareBlock(t.block)
	return t
}

function writeShareBlock(block) {
	const file = asoundrcPath()
	const existing = read(file)
	const next = mergeAsoundrcBlock(existing, block || '', { begin: BLOCK_BEGIN, end: BLOCK_END, drop: !block })
	if (next === existing) return false
	const tmp = `${file}.highascg-ltc.tmp`
	fs.writeFileSync(tmp, next, 'utf8')
	fs.renameSync(tmp, file)
	return true
}

module.exports = { readCards, deviceChannels, listLtcDevices, currentTarget, writeShareBlock }
