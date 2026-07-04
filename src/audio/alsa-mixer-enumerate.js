/**
 * ALSA card enumeration and binary resolution.
 */
'use strict'

const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')

const AMIXER_BINS = ['amixer', '/usr/bin/amixer', '/usr/local/bin/amixer']
const ALSAMIXER_BINS = ['alsamixer', '/usr/bin/alsamixer', '/usr/local/bin/alsamixer']

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

function isLinuxAlsaMixerAvailable() {
	return os.platform() === 'linux' && !!resolveAmixer()
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

module.exports = {
	resolveAmixer,
	resolveAlsamixer,
	parseCardFromHwUri,
	resolveSuggestedAlsaMixerCard,
	isLinuxAlsaMixerAvailable,
	listAlsaCards,
}
