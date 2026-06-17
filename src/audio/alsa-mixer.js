/**
 * ALSA mixer REST backend — wraps `amixer` (no shell interpolation).
 * @see docs/reference/audio/alsa-mixer-api.md
 */
'use strict'

const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')

const AMIXER_BINS = ['amixer', '/usr/bin/amixer', '/usr/local/bin/amixer']
const ALSAMIXER_BINS = ['alsamixer', '/usr/bin/alsamixer', '/usr/local/bin/alsamixer']
const CACHE_TTL_MS = 1500
/** @type {Map<number, { at: number, controls: object[] }>} */
const controlsCache = new Map()

/**
 * @returns {string|null}
 */
function resolveAmixer() {
	for (const bin of AMIXER_BINS) {
		try {
			if (fs.existsSync(bin)) return bin
		} catch {
			/* ignore */
		}
	}
	try {
		return (
			execFileSync('/usr/bin/command', ['-v', 'amixer'], {
				encoding: 'utf8',
				timeout: 2000,
			}).trim() || null
		)
	} catch {
		return null
	}
}

function resolveAlsamixer() {
	for (const bin of ALSAMIXER_BINS) {
		try {
			if (fs.existsSync(bin)) return bin
		} catch {
			/* ignore */
		}
	}
	try {
		return (
			execFileSync('/usr/bin/command', ['-v', 'alsamixer'], {
				encoding: 'utf8',
				timeout: 2000,
				env: { ...process.env, PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
			}).trim() || null
		)
	} catch {
		return null
	}
}

/**
 * @param {string} hwUri e.g. hw:2,0 or alsa://hw:2,0
 * @returns {number|null}
 */
function parseCardFromHwUri(hwUri) {
	const s = String(hwUri || '').trim()
	const m = s.match(/hw:(\d+)/i)
	if (!m) return null
	const n = parseInt(m[1], 10)
	return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * @param {object} [config]
 * @returns {number|null}
 */
function resolveSuggestedAlsaMixerCard(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	for (let i = 1; i <= 8; i++) {
		const raw = cs[`live_audio_input_${i}_device`]
		if (!raw) continue
		const card = parseCardFromHwUri(raw)
		if (card != null) return card
	}
	return null
}

/**
 * @param {string} name
 * @param {number|null|undefined} index
 * @param {object[]} controls
 * @returns {string}
 */
function formatAmixerControlId(name, index, controls) {
	const matches = controls.filter((c) => c.name === name)
	if (index != null && Number.isFinite(index)) return `${name},${index}`
	if (matches.length === 1 && matches[0].index != null && Number.isFinite(matches[0].index)) {
		return `${name},${matches[0].index}`
	}
	if (matches.length > 1) {
		const err = new Error(`control name is ambiguous; pass index (${matches.length} controls named "${name}")`)
		err.code = 'ambiguous_control'
		throw err
	}
	return name
}

function isLinuxAlsaMixerAvailable() {
	return os.platform() === 'linux' && !!resolveAmixer()
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function execAmixer(args) {
	const bin = resolveAmixer()
	if (!bin) throw new Error('amixer not found')
	return execFileSync(bin, args, {
		encoding: 'utf8',
		timeout: 12000,
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 2 * 1024 * 1024,
	})
}

/**
 * @returns {Array<{ card: number, name: string }>}
 */
function listAlsaCards() {
	const cards = []
	try {
		const text = fs.readFileSync('/proc/asound/cards', 'utf8')
		for (const line of text.split('\n')) {
			const m = line.match(/^\s*(\d+)\s+\[([^\]]*)\]:\s*(.+)$/)
			if (!m) continue
			const card = parseInt(m[1], 10)
			if (!Number.isFinite(card)) continue
			const name = String(m[3] || m[2] || '').trim() || `Card ${card}`
			cards.push({ card, name })
		}
	} catch {
		/* fall through */
	}
	if (cards.length) return cards

	try {
		const { listAudioDevices } = require('./audio-devices')
		const payload = listAudioDevices()
		const seen = new Set()
		for (const d of payload.devices || []) {
			if (d.type !== 'alsa' || !Number.isFinite(d.card)) continue
			if (seen.has(d.card)) continue
			seen.add(d.card)
			const shortName = String(d.name || '').split(' — ')[0].trim()
			cards.push({ card: d.card, name: shortName || `Card ${d.card}` })
		}
	} catch {
		/* ignore */
	}
	return cards.sort((a, b) => a.card - b.card)
}

/**
 * @param {string} caps
 */
function capsHas(caps, token) {
	return new RegExp(`\\b${token}\\b`).test(caps)
}

/**
 * @param {string} block
 * @returns {object|null}
 */
function parseControlBlock(block) {
	const header = block.match(/Simple mixer control '([^']*)',(\d+)/)
	if (!header) return null
	const name = header[1]
	const index = parseInt(header[2], 10)
	const capsLine = block.match(/Capabilities:\s*(.+)/i)
	const caps = capsLine ? capsLine[1] : ''

	let playback = capsHas(caps, 'pvolume') || capsHas(caps, 'pswitch')
	let capture = capsHas(caps, 'cvolume') || capsHas(caps, 'cswitch')
	if (capsHas(caps, 'volume') && !capsHas(caps, 'pvolume') && !capsHas(caps, 'cvolume')) {
		const hasPlaybackChannels = /Playback channels:/i.test(block)
		const hasCaptureChannels = /Capture channels:/i.test(block)
		playback = hasPlaybackChannels || !hasCaptureChannels
		capture = hasCaptureChannels
		if (hasPlaybackChannels && hasCaptureChannels) {
			playback = true
			capture = true
		}
	}
	const isEnum = capsHas(caps, 'penum') || capsHas(caps, 'cenum')
	const isSwitchOnly =
		!isEnum &&
		(capsHas(caps, 'pswitch') || capsHas(caps, 'cswitch')) &&
		!capsHas(caps, 'pvolume') &&
		!capsHas(caps, 'cvolume')

	if (isEnum) {
		const items = []
		const itemsLine = block.match(/Items:\s*(.+)/i)
		if (itemsLine) {
			const re = /'([^']*)'/g
			let m
			while ((m = re.exec(itemsLine[1])) !== null) {
				items.push({ value: m[1], label: m[1] })
			}
		}
		const itemM = block.match(/Item0:\s*'([^']*)'/i)
		return {
			name,
			index,
			type: 'enum',
			playback: capsHas(caps, 'penum'),
			capture: capsHas(caps, 'cenum'),
			items,
			item: itemM ? itemM[1] : items[0]?.value ?? '',
		}
	}

	if (isSwitchOnly) {
		const on = /\[(on)\]/i.test(block) && !/\[(off)\]/i.test(block.replace(/\[on\]/gi, ''))
		const offExplicit = /:\s*(Playback|Capture)\s+\[off\]/i.test(block)
		const onExplicit = /:\s*(Playback|Capture)\s+\[on\]/i.test(block)
		let value = onExplicit ? 1 : offExplicit ? 0 : on ? 1 : 0
		if (/Mono:\s*(Playback|Capture)\s+\[on\]/i.test(block)) value = 1
		if (/Mono:\s*(Playback|Capture)\s+\[off\]/i.test(block)) value = 0
		return {
			name,
			index,
			type: 'boolean',
			playback,
			capture,
			value,
			on: value === 1,
		}
	}

	const limitsPrefixed = block.match(/Limits:\s*(Playback|Capture)\s+(\d+)\s*-\s*(\d+)/i)
	const limitsGeneric = !limitsPrefixed ? block.match(/Limits:\s*(\d+)\s*-\s*(\d+)/i) : null
	const min = limitsPrefixed ?
			parseInt(limitsPrefixed[2], 10)
		: limitsGeneric ?
			parseInt(limitsGeneric[1], 10)
		:	0
	const max = limitsPrefixed ?
			parseInt(limitsPrefixed[3], 10)
		: limitsGeneric ?
			parseInt(limitsGeneric[2], 10)
		:	100

	const channels = []
	const percents = []
	const dBs = []
	let anyOff = false

	for (const line of block.split('\n')) {
		const trimmed = line.trim()
		const withDir = trimmed.match(
			/^(\S+(?:\s+\S+)*):\s*(Playback|Capture)\s+(\d+)\s+\[(\d+)%\]\s+\[(-?[\d.]+)dB\]\s+\[(on|off)\]\s*$/
		)
		if (withDir) {
			channels.push(withDir[1].trim())
			percents.push(parseInt(withDir[4], 10))
			dBs.push(parseFloat(withDir[5]))
			if (withDir[6].toLowerCase() === 'off') anyOff = true
			continue
		}
		const genericVol = trimmed.match(/^(\S+(?:\s+\S+)*):\s*(\d+)\s+\[(\d+)%\]\s+\[(-?[\d.]+)dB\]\s*$/)
		if (genericVol) {
			channels.push(genericVol[1].trim())
			percents.push(parseInt(genericVol[3], 10))
			dBs.push(parseFloat(genericVol[4]))
			continue
		}
		const monoVol = trimmed.match(
			/^Mono:\s*(Playback|Capture)\s+(\d+)\s+\[(\d+)%\]\s+\[(-?[\d.]+)dB\]\s+\[(on|off)\]\s*$/
		)
		if (monoVol) {
			channels.push('Mono')
			percents.push(parseInt(monoVol[3], 10))
			dBs.push(parseFloat(monoVol[4]))
			if (monoVol[5].toLowerCase() === 'off') anyOff = true
		}
	}

	if (!channels.length && (playback || capture)) {
		return {
			name,
			index,
			type: 'boolean',
			playback,
			capture,
			value: /\[on\]/i.test(block) ? 1 : 0,
			on: /\[on\]/i.test(block),
		}
	}

	if (!channels.length) return null

	const percent =
		percents.length ?
			Math.round(percents.reduce((a, b) => a + b, 0) / percents.length)
		:	0
	const rawValue =
		limitsPrefixed || limitsGeneric ?
			Math.round(min + ((max - min) * percent) / 100)
		:	percent
	const dB =
		dBs.length ?
			Math.round((dBs.reduce((a, b) => a + b, 0) / dBs.length) * 100) / 100
		:	undefined

	return {
		name,
		index,
		type: 'volume',
		playback,
		capture,
		min,
		max,
		value: rawValue,
		percent,
		...(dB !== undefined ? { dB } : {}),
		mute: anyOff,
		muted: anyOff,
		channels,
	}
}

/**
 * @param {string} text
 * @returns {object[]}
 */
function parseAmixerScontents(text) {
	const blocks = String(text || '').split(/Simple mixer control '/).slice(1)
	const controls = []
	for (const chunk of blocks) {
		const block = `Simple mixer control '${chunk}`
		const ctrl = parseControlBlock(block)
		if (ctrl) controls.push(ctrl)
	}
	return controls
}

function buildAlsaMixerMeta(controls, opts = {}) {
	const captureControls = controls.filter((c) => c.capture)
	const playbackControls = controls.filter((c) => c.playback)
	let captureNote = null
	if (!captureControls.length) {
		captureNote =
			'No software capture controls on this card. The device may still capture at a fixed level (common on USB interfaces), or input gain may live on another ALSA card.'
	}
	return {
		hasCaptureControls: captureControls.length > 0,
		hasPlaybackControls: playbackControls.length > 0,
		captureControlCount: captureControls.length,
		playbackControlCount: playbackControls.length,
		...(captureNote ? { captureNote } : {}),
		...(opts.suggestedCard != null ? { suggestedCard: opts.suggestedCard } : {}),
	}
}

/**
 * @param {number} card
 * @param {{ refresh?: boolean, suggestedCard?: number|null }} [opts]
 */
function getAlsaMixerState(card, opts = {}) {
	if (!isLinuxAlsaMixerAvailable()) {
		const err = new Error('ALSA mixer not available on this host')
		err.code = 'alsa_unavailable'
		throw err
	}
	if (!Number.isFinite(card) || card < 0) {
		const err = new Error('invalid card')
		err.code = 'invalid_card'
		throw err
	}

	const cards = listAlsaCards()
	if (cards.length && !cards.some((c) => c.card === card)) {
		const err = new Error('card not found')
		err.code = 'card_not_found'
		throw err
	}

	const refresh = opts.refresh === true
	const now = Date.now()
	if (!refresh) {
		const hit = controlsCache.get(card)
		if (hit && now - hit.at < CACHE_TTL_MS) {
			return {
				card,
				cards,
				controls: hit.controls,
				cached: true,
				...buildAlsaMixerMeta(hit.controls, opts),
			}
		}
	}

	let text
	try {
		text = execAmixer(['-c', String(card), 'scontents'])
	} catch (e) {
		const msg = e?.stderr || e?.message || String(e)
		if (/invalid card|no such file|cannot find card/i.test(msg)) {
			const err = new Error('card not found')
			err.code = 'card_not_found'
			throw err
		}
		const err = new Error(msg.trim() || 'amixer failed')
		err.code = 'amixer_failed'
		throw err
	}

	const controls = parseAmixerScontents(text)
	controlsCache.set(card, { at: now, controls })
	return {
		card,
		cards,
		controls,
		cached: false,
		...buildAlsaMixerMeta(controls, opts),
	}
}

/**
 * @param {object} body
 * @param {(level: string, msg: string) => void} [log]
 */
function setAlsaMixerControl(body, log) {
	if (!isLinuxAlsaMixerAvailable()) {
		const err = new Error('ALSA mixer not available on this host')
		err.code = 'alsa_unavailable'
		throw err
	}
	const card = parseInt(String(body?.card ?? ''), 10)
	if (!Number.isFinite(card) || card < 0) {
		const err = new Error('invalid card')
		err.code = 'invalid_card'
		throw err
	}
	const name = body?.name != null ? String(body.name) : ''
	const indexRaw = body?.index != null ? parseInt(String(body.index), 10) : null
	if (!name && indexRaw == null) {
		const err = new Error('name or index required')
		err.code = 'invalid_body'
		throw err
	}

	const state = getAlsaMixerState(card, { refresh: true })
	let controlName
	try {
		controlName = formatAmixerControlId(name, indexRaw, state.controls)
	} catch (e) {
		if (e.code === 'ambiguous_control') throw e
		controlName = name || String(body.index)
	}
	const args = ['-c', String(card), 'sset', controlName]

	if (body?.item != null) {
		args.push(String(body.item))
	} else if (body?.mute === true) {
		args.push('mute')
	} else if (body?.mute === false) {
		args.push('unmute')
	} else if (body?.percent != null) {
		const pct = Math.min(100, Math.max(0, parseInt(String(body.percent), 10) || 0))
		args.push(`${pct}%`)
	} else if (body?.value != null) {
		const v = parseInt(String(body.value), 10)
		args.push(v === 0 ? 'off' : v === 1 ? 'on' : String(body.value))
	} else {
		const err = new Error('percent, mute, item, or value required')
		err.code = 'invalid_body'
		throw err
	}

	if (typeof log === 'function') {
		log(
			'info',
			`[ALSA mixer] card=${card} name=${JSON.stringify(name || controlName)} args=${JSON.stringify(args.slice(3))}`
		)
	}

	try {
		execAmixer(args)
	} catch (e) {
		const msg = e?.stderr || e?.message || String(e)
		if (/invalid card|cannot find card/i.test(msg)) {
			const err = new Error('card not found')
			err.code = 'card_not_found'
			throw err
		}
		if (/unknown|cannot find|no such|invalid command/i.test(msg)) {
			const err = new Error('control not found')
			err.code = 'control_not_found'
			throw err
		}
		if (/read-only|access/i.test(msg)) {
			const err = new Error('control is read-only')
			err.code = 'read_only'
			throw err
		}
		const err = new Error(msg.trim() || 'amixer failed')
		err.code = 'amixer_failed'
		throw err
	}

	controlsCache.delete(card)
	const refreshed = getAlsaMixerState(card, { refresh: true })
	const updated = refreshed.controls.find(
		(c) =>
			(name && c.name === name && (indexRaw == null || c.index === indexRaw)) ||
			(indexRaw != null && c.index === indexRaw)
	)

	const out = {
		ok: true,
		card,
		name: name || updated?.name || controlName,
	}
	if (body?.percent != null) out.percent = Math.min(100, Math.max(0, parseInt(String(body.percent), 10) || 0))
	if (body?.mute != null) out.mute = !!body.mute
	if (body?.item != null) out.item = String(body.item)
	if (updated) out.control = updated
	return out
}

/**
 * Map thrown errors to HTTP status + body.
 * @param {Error & { code?: string }} e
 */
function alsaMixerErrorResponse(e) {
	const code = e?.code || ''
	if (code === 'alsa_unavailable') return { status: 501, error: 'ALSA mixer not available on this host' }
	if (code === 'invalid_card' || code === 'invalid_body' || code === 'ambiguous_control') {
		return { status: 400, error: e.message }
	}
	if (code === 'card_not_found' || code === 'control_not_found') return { status: 404, error: e.message }
	if (code === 'read_only') return { status: 409, error: e.message }
	return { status: 500, error: e?.message || 'amixer failed' }
}

module.exports = {
	isLinuxAlsaMixerAvailable,
	resolveAlsamixer,
	listAlsaCards,
	getAlsaMixerState,
	setAlsaMixerControl,
	parseAmixerScontents,
	parseCardFromHwUri,
	resolveSuggestedAlsaMixerCard,
	alsaMixerErrorResponse,
}
