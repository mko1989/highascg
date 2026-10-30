/**
 * Enumerate ALSA (aplay -l) and optional PipeWire nodes for Settings / GET /api/audio/devices.
 * @see 06_WO_AUDIO_PLAYOUT.md T4.4
 */
'use strict'

const path = require('path')
const { execFileSync } = require('child_process')
const { annotateHdmiSinks } = require('./hdmi-sinks')

const CACHE_TTL_MS = 30000
/** @type {{ at: number, payload: object } | null} */
let cache = null

/** PortAudio device list (naudiodon) — separate TTL */
const PA_CACHE_TTL_MS = 15000
/** @type {{ at: number, payload: object } | null} */
let paCache = null

const APLAY_BINS = ['aplay', '/usr/bin/aplay', '/usr/local/bin/aplay']
const PW_CLI_BINS = ['pw-cli', '/usr/bin/pw-cli']

/**
 * Resolve `aplay` when the Node process has a minimal PATH (e.g. systemd).
 * @param {string} args e.g. `-l` or `-L`
 * @returns {string|null}
 */
function execAplay(args) {
	const opts = {
		encoding: 'utf8',
		timeout: 8000,
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 512 * 1024,
	}
	for (const bin of APLAY_BINS) {
		try {
			return execFileSync(bin, String(args).trim().split(/\s+/).filter(Boolean), opts)
		} catch {
			/* try next */
		}
	}
	return null
}

/**
 * @returns {string|null}
 */
function execPwCliListNodes() {
	const opts = {
		encoding: 'utf8',
		timeout: 5000,
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 1024 * 1024,
	}
	for (const bin of PW_CLI_BINS) {
		try {
			return execFileSync(bin, ['list-objects', 'Node'], opts)
		} catch {
			/* try next */
		}
	}
	return null
}

/**
 * Parse `aplay -L`: non-indented lines are PCM ids; following indented line is description.
 * Skips the dummy `null` entry.
 * @param {string} text
 * @returns {Array<{ id: string, name: string, type: string, channels: null, sampleRates: null }>}
 */
function parseAplayLongList(text) {
	const out = []
	const lines = String(text || '').split('\n')
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const trimmed = line.trim()
		if (!trimmed) continue
		if (/^\s/.test(line)) continue
		const id = trimmed
		let desc = ''
		if (i + 1 < lines.length && /^\s/.test(lines[i + 1])) {
			desc = lines[i + 1].trim()
			i++
		}
		if (id === 'null') continue
		out.push({
			id,
			name: desc ? `${desc} (${id})` : id,
			type: 'alsa_pcm',
			channels: null,
			sampleRates: null,
		})
	}
	return out
}

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

	let alsa
	try {
		const text = execAplay('-l')
		alsa = parseAplayList(text || '')
	} catch {
		alsa = []
	}

	let alsaL
	try {
		const text = execAplay('-L')
		alsaL = parseAplayLongList(text || '')
	} catch {
		alsaL = []
	}

	let pipewire
	try {
		const text = execPwCliListNodes()
		pipewire = parsePwCliNodes(text || '')
	} catch {
		pipewire = []
	}

	// Merge avoiding duplicates by id
	const seen = new Set()
	const merged = []
	for (const d of [...alsa, ...alsaL, ...pipewire]) {
		if (!d.id || seen.has(d.id)) continue
		seen.add(d.id)
		merged.push(d)
	}

	const payload = {
		devices: merged,
		refreshedAt: new Date().toISOString(),
		sources: { alsa: alsa.length, alsaL: alsaL.length, pipewire: pipewire.length },
		cached: false,
	}
	cache = { at: now, payload }
	return payload
}

/** WO-845: marker comments delimiting the only part of `~/.asoundrc` this module owns. */
const ASOUNDRC_BEGIN = '# >>> HighAsCG default device (managed block, do not edit) >>>'
const ASOUNDRC_END = '# <<< HighAsCG default device <<<'

/**
 * WO-845: merge `content` into an existing ~/.asoundrc as a marked block. Everything outside the block is kept
 * verbatim (the box's hand-authored `pcm.sc60mon` 48 kHz plug, WO-406, lived in this file and was destroyed by a
 * whole-file overwrite). A missing block is appended; an existing one is replaced in place.
 * @param {string} existing
 * @param {string} content  the `defaults.*` lines
 * @returns {string}
 */
function mergeAsoundrcBlock(existing, content) {
	const block = `${ASOUNDRC_BEGIN}\n${content.endsWith('\n') ? content : content + '\n'}${ASOUNDRC_END}\n`
	const text = String(existing || '')
	const b = text.indexOf(ASOUNDRC_BEGIN)
	const e = b === -1 ? -1 : text.indexOf(ASOUNDRC_END, b)
	if (b !== -1 && e !== -1) {
		const after = text.slice(e + ASOUNDRC_END.length).replace(/^\r?\n/, '')
		return text.slice(0, b) + block + after
	}
	const sep = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
	return text + sep + block
}

/**
 * Write ALSA default PCM/CTL. Default is per-user `~/.asoundrc` (no sudo) so the Caspar user’s session picks it up.
 * Use `scope: 'system'` for `/etc/asound.conf` (root or passwordless sudo tee).
 *
 * @param {number} card
 * @param {number} device
 * @param {{ scope?: 'user' | 'system', home?: string }} [opts]  `home` overrides the user's home dir (tests)
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

	// WO-845: the route only parseInt()s — NaN / negatives wrote `defaults.pcm.card NaN` into the file.
	if (!Number.isInteger(card) || !Number.isInteger(device) || card < 0 || device < 0) {
		return { ok: false, invalid: true, error: 'card and device must be non-negative integers' }
	}
	const scope = opts.scope === 'system' ? 'system' : 'user'
	const content = `defaults.pcm.card ${card}\ndefaults.pcm.device ${device}\ndefaults.ctl.card ${card}\n`

	if (scope === 'user') {
		try {
			const home = opts.home || os.userInfo().homedir
			if (!home || typeof home !== 'string') {
				return { ok: false, error: 'No user home directory (cannot write ~/.asoundrc)' }
			}
			const target = path.join(home, '.asoundrc')
			let existing = ''
			try {
				existing = fs.readFileSync(target, 'utf8')
			} catch (e) {
				if (e && e.code !== 'ENOENT') throw e
			}
			// WO-845: only our marked block is rewritten; keep a one-time backup of a hand-authored file.
			if (existing && !existing.includes(ASOUNDRC_BEGIN)) {
				const bak = `${target}.highascg.bak`
				if (!fs.existsSync(bak)) fs.writeFileSync(bak, existing, 'utf8')
			}
			const tmp = `${target}.highascg.tmp`
			fs.writeFileSync(tmp, mergeAsoundrcBlock(existing, content), 'utf8')
			fs.renameSync(tmp, target)
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
		`sudo needs NOPASSWD for /usr/bin/tee and /bin/tee only if you enabled HIGHASCG_INSTALL_ASOUND_SUDOERS=1 (install-phase3.sh). Otherwise use scope=user (~/.asoundrc). Current process: ${runAs}. Manual: sudo tee /etc/asound.conf`
	return { ok: false, error: `${lastErr}. ${hint}` }
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
		const mixed = listAudioDevices({ refresh: true }).devices || []
		for (const d of mixed) {
			if (d.type === 'alsa') {
				mapped.push({
					id: d.id,
					name: d.name,
					hostAPIName: 'ALSA (physical)',
					maxOutputChannels: 16,
					defaultSampleRate: 48000,
				})
			} else if (d.type === 'pipewire') {
				mapped.push({
					id: d.id,
					name: d.name,
					hostAPIName: 'PipeWire',
					maxOutputChannels: 16,
					defaultSampleRate: 48000,
				})
			}
		}
		source = mixed.some((x) => x.type === 'pipewire') ? 'alsa-utils+pipewire' : 'alsa-utils'
	}

	if (mapped.length === 0) {
		const longText = execAplay('-L')
		const pcm = parseAplayLongList(longText || '')
		for (const d of pcm) {
			mapped.push({
				id: d.id,
				name: d.name,
				hostAPIName: 'ALSA (PCM list)',
				maxOutputChannels: 16,
				defaultSampleRate: 48000,
			})
		}
		if (mapped.length) source = 'aplay-L'
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

		mapped = annotateHdmiSinks(mapped)
		const payload = {
			devices: mapped,
			refreshedAt: new Date().toISOString(),
			cached: false,
			source,
			...(source !== 'naudiodon' && naudiodonErr
				? {
						warning: 'Using ALSA / PipeWire list (optional naudiodon not installed).',
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
		hint: 'No devices listed. Install alsa-utils or type the device name manually.',
	}
	paCache = { at: now, payload }
	return payload
}

module.exports = {
	listAudioDevices,
	listPortAudioDevices,
	parseAplayList,
	parseAplayLongList,
	setDefaultAlsaDevice,
	mergeAsoundrcBlock,
}
