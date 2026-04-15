/**
 * Enumerate ALSA (aplay -l) and optional PipeWire nodes for Settings / GET /api/audio/devices.
 * @see 06_WO_AUDIO_PLAYOUT.md T4.4
 */
'use strict'

const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const CACHE_TTL_MS = 30000
/** @type {{ at: number, payload: object } | null} */
let cache = null

/** PortAudio device list (naudiodon) — separate TTL */
const PA_CACHE_TTL_MS = 15000
/** @type {{ at: number, payload: object } | null} */
let paCache = null

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

/**
 * Write ALSA default PCM/CTL. Default is per-user `~/.asoundrc` (no sudo) so the Caspar user’s session picks it up.
 * Use `scope: 'system'` for `/etc/asound.conf` (root or passwordless sudo tee).
 *
 * @param {number} card
 * @param {number} device
 * @param {{ scope?: 'user' | 'system' }} [opts]
 * @returns {{ ok: boolean, scope?: string, path?: string, error?: string }}
 */
function setDefaultAlsaDevice(card, device, opts = {}) {
	const { spawnSync } = require('child_process')
	const fs = require('fs')
	const os = require('os')
	let runAs = `uid=${typeof process.getuid === 'function' ? process.getuid() : '?'}`
	try {
		runAs = `${os.userInfo().username} (${runAs})`
	} catch {
		/* ignore */
	}

	const scope = opts.scope === 'system' ? 'system' : 'user'
	const content = `defaults.pcm.card ${card}\ndefaults.pcm.device ${device}\ndefaults.ctl.card ${card}\n`

	if (scope === 'user') {
		try {
			const home = os.userInfo().homedir
			if (!home || typeof home !== 'string') {
				return { ok: false, error: 'No user home directory (cannot write ~/.asoundrc)' }
			}
			const target = path.join(home, '.asoundrc')
			fs.writeFileSync(target, content, 'utf8')
			return { ok: true, scope: 'user', path: target }
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) }
		}
	}

	// system: /etc/asound.conf
	if (typeof process.getuid === 'function' && process.getuid() === 0) {
		try {
			fs.writeFileSync('/etc/asound.conf', content, 'utf8')
			return { ok: true, scope: 'system', path: '/etc/asound.conf' }
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) }
		}
	}
	const teeCandidates = ['/usr/bin/tee', '/bin/tee'].filter((p) => fs.existsSync(p))
	if (teeCandidates.length === 0) {
		return { ok: false, error: 'Neither /usr/bin/tee nor /bin/tee found' }
	}

	let lastErr = ''
	for (const tee of teeCandidates) {
		const r = spawnSync('sudo', ['-n', tee, '/etc/asound.conf'], {
			input: Buffer.from(content, 'utf8'),
			encoding: 'utf8',
			maxBuffer: 256 * 1024,
		})
		if (r.error) {
			lastErr = r.error.message
			continue
		}
		if (r.status === 0) return { ok: true, scope: 'system', path: '/etc/asound.conf' }
		lastErr = (r.stderr || r.stdout || '').trim() || `exit code ${r.status}`
	}
	const hint =
		`sudo needs NOPASSWD for /usr/bin/tee and /bin/tee (see install-phase3.sh). Process runs as ${runAs}; /etc/sudoers.d/highascg-asound must list that user (typically casparcg). Or run manually: sudo tee /etc/asound.conf`
	return { ok: false, error: `${lastErr}. ${hint}` }
}

/**
 * ALSA PCM names from `aplay -L` — often align with PortAudio’s ALSA backend device strings (fuzzy match in Caspar).
 * @param {string} text
 * @returns {Array<{ id: number, name: string, hostAPIName: string, maxOutputChannels: number, defaultSampleRate: number }>}
 */
function parseAplayLForPortAudioFallback(text) {
	const out = []
	const seen = new Set()
	for (const line of String(text || '').split('\n')) {
		if (/^\s/.test(line)) continue
		const name = line.trim()
		if (!name || name === 'null') continue
		if (seen.has(name)) continue
		seen.add(name)
		out.push({
			id: out.length,
			name,
			hostAPIName: 'ALSA (aplay -L)',
			maxOutputChannels: 2,
			defaultSampleRate: 48000,
		})
	}
	out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
	return out
}

/**
 * Linux fallback when `naudiodon` is missing or fails to build (GCC/Node ABI issues).
 */
function listPortAudioDevicesFromAplayL() {
	if (os.platform() !== 'linux') return []
	try {
		const text = execSync('aplay -L', {
			encoding: 'utf8',
			timeout: 8000,
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 512 * 1024,
		})
		return parseAplayLForPortAudioFallback(text)
	} catch {
		return []
	}
}

/**
 * Enumerate PortAudio devices (same names Caspar’s PortAudio consumer fuzzy-matches).
 * 1) Optional `naudiodon` (optionalDependency — build may fail on some toolchains).
 * 2) Linux: `aplay -L` fallback (install `alsa-utils`; names usually match PortAudio/ALSA).
 *
 * @param {{ refresh?: boolean, outputsOnly?: boolean }} [opts]
 * @returns {{ devices: Array<{ id: number, name: string, hostAPIName: string, maxOutputChannels: number, defaultSampleRate: number }>, refreshedAt: string, cached?: boolean, source?: string, warning?: string, error?: string, hint?: string, detail?: string }}
 */
function listPortAudioDevices(opts = {}) {
	const refresh = opts.refresh === true
	const outputsOnly = opts.outputsOnly !== false
	const now = Date.now()
	if (!refresh && paCache && now - paCache.at < PA_CACHE_TTL_MS) {
		return { ...paCache.payload, cached: true }
	}

	/** @type {Array<{ id: number, name: string, hostAPIName: string, maxOutputChannels: number, defaultSampleRate: number }>} */
	let mapped = []
	let source = 'naudiodon'
	let naudiodonErr = ''

	try {
		const naudiodon = require('naudiodon')
		const raw = naudiodon.getDevices() || []
		const seen = new Set()
		for (const d of raw) {
			if (!d || typeof d.name !== 'string') continue
			if (outputsOnly && (d.maxOutputChannels | 0) <= 0) continue
			const name = d.name.trim()
			if (!name || seen.has(name)) continue
			seen.add(name)
			mapped.push({
				id: d.id,
				name,
				hostAPIName: String(d.hostAPIName || ''),
				maxOutputChannels: d.maxOutputChannels | 0,
				defaultSampleRate: typeof d.defaultSampleRate === 'number' ? d.defaultSampleRate : 0,
			})
		}
	} catch (e) {
		naudiodonErr = e instanceof Error ? e.message : String(e)
		mapped = []
	}

	if (mapped.length === 0) {
		const fb = listPortAudioDevicesFromAplayL()
		if (fb.length > 0) {
			mapped = fb
			source = 'aplay-l'
		}
	}

	if (mapped.length > 0) {
		if (source === 'naudiodon') {
			mapped.sort((a, b) => {
				const ao = /asio/i.test(a.hostAPIName) ? 0 : 1
				const bo = /asio/i.test(b.hostAPIName) ? 0 : 1
				if (ao !== bo) return ao - bo
				return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
			})
		}

		const payload = {
			devices: mapped,
			refreshedAt: new Date().toISOString(),
			cached: false,
			source,
			...(source === 'aplay-l' && naudiodonErr
				? {
						warning:
							'Using ALSA device names from `aplay -L` (naudiodon not built). Names usually match PortAudio on Linux; if not, type the device string manually.',
						detail: naudiodonErr,
					}
				: {}),
		}
		paCache = { at: now, payload }
		return payload
	}

	const payload = {
		devices: [],
		refreshedAt: new Date().toISOString(),
		source: 'none',
		error: naudiodonErr ? 'naudiodon_unavailable' : 'no_devices',
		hint:
			'On Linux, install `alsa-utils` so `aplay -L` can list devices, or type the PortAudio device name manually. Optional: fix naudiodon build (C++ toolchain) for exact PortAudio enumeration.',
		...(naudiodonErr ? { detail: naudiodonErr } : {}),
	}
	paCache = { at: now, payload }
	return payload
}

module.exports = {
	listAudioDevices,
	listPortAudioDevices,
	parseAplayList,
	setDefaultAlsaDevice,
}
