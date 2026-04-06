/**
 * Enumerate ALSA (aplay -l) and optional PipeWire nodes for Settings / GET /api/audio/devices.
 * @see 06_WO_AUDIO_PLAYOUT.md T4.4
 */
'use strict'

const { execSync } = require('child_process')

const CACHE_TTL_MS = 30000
/** @type {{ at: number, payload: object } | null} */
let cache = null

/**
 * @param {string} text
 * @returns {Array<{ id: string, name: string, type: string, card: number, device: number, channels: null, sampleRates: null }>}
 */
function parseAplayList(text) {
	const out = []
	for (const line of String(text || '').split('\n')) {
		const m = line.match(/card\s+(\d+):\s*(.+?),\s*device\s+(\d+):\s*(.+)$/i)
		if (!m) continue
		const card = parseInt(m[1], 10)
		const dev = parseInt(m[3], 10)
		const name = `${m[2].trim()} — ${m[4].trim()}`
		out.push({
			id: `hw:${card},${dev}`,
			name,
			type: 'alsa',
			card,
			device: dev,
			channels: null,
			sampleRates: null,
		})
	}
	return out
}

/**
 * Best-effort parse of `pw-cli list-objects` (PipeWire) for Audio/Sink nodes.
 * @param {string} text
 * @returns {Array<{ id: string, name: string, type: string, channels: null, sampleRates: null }>}
 */
function parsePwCliNodes(text) {
	const out = []
	const blocks = String(text || '').split(/\nid\s+\d+/)
	for (const block of blocks) {
		if (!/factory\.name.*Audio\/Sink|media\.class.*Audio\/Sink/i.test(block)) continue
		const idm = block.match(/^\s*(\d+)/)
		const nm = block.match(/node\.name\s*=\s*"([^"]+)"/)
		const nick = block.match(/node\.nickname\s*=\s*"([^"]*)"/)
		if (!idm || !nm) continue
		const name = (nick && nick[1]) || nm[1]
		out.push({
			id: `pipewire:${nm[1]}`,
			name,
			type: 'pipewire',
			channels: null,
			sampleRates: null,
		})
	}
	return out
}

/**
 * @param {{ refresh?: boolean }} [opts]
 */
function listAudioDevices(opts = {}) {
	const refresh = opts.refresh === true
	const now = Date.now()
	if (!refresh && cache && now - cache.at < CACHE_TTL_MS) {
		return { ...cache.payload, cached: true }
	}

	let alsa = []
	try {
		const text = execSync('aplay -l', {
			encoding: 'utf8',
			timeout: 8000,
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 512 * 1024,
		})
		alsa = parseAplayList(text)
	} catch {
		alsa = []
	}

	let pipewire = []
	try {
		const text = execSync('pw-cli list-objects Node', {
			encoding: 'utf8',
			timeout: 5000,
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 1024 * 1024,
		})
		pipewire = parsePwCliNodes(text)
	} catch {
		pipewire = []
	}

	const payload = {
		devices: [...alsa, ...pipewire],
		refreshedAt: new Date().toISOString(),
		sources: { alsa: alsa.length, pipewire: pipewire.length },
		cached: false,
	}
	cache = { at: now, payload }
	return payload
}

module.exports = { listAudioDevices, parseAplayList }
