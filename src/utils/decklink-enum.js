'use strict'

const { execFile, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const CACHE_TTL_MS = 5000
let lastProbeAt = 0
let lastProbe = null

const DEFAULT_LOG_DIR = '/home/casparcg/highascg/log'

/**
 * @param {string} text
 * @returns {Array<{ index: number, label: string }>}
 */
function parseDecklinkDevicesFromFfmpegText(text) {
	const out = []
	const seen = new Set()
	const lines = String(text || '').split(/\r?\n/)
	for (const line of lines) {
		const m = line.match(/"([^"]*decklink[^"]*)"/i)
		if (!m || !m[1]) continue
		const label = String(m[1]).trim()
		if (!label) continue
		const key = label.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push({ index: out.length + 1, label })
	}
	return out
}

/**
 * Parse CasparCG startup log lines with DeckLink devices and Screen consumers.
 *
 * @param {string} text
 * @returns {{ decklinks: Array<{ index: number, label: string, externalRef?: string }>, screens: Array<{ index: number, mode: string }> }}
 */
function parseCasparLogHardware(text) {
	const lines = String(text || '').split(/\r?\n/)
	const decklinks = new Map()
	const screens = new Map()

	for (const line of lines) {
		const dm = line.match(/-\s*(DeckLink[^[]*?)\s*\[(\d+)\]\s*\((\d+)\)/i)
		if (dm) {
			const labelBase = String(dm[1] || '').trim() || 'DeckLink'
			const idx = parseInt(dm[2], 10)
			const externalRef = String(dm[3] || '').trim()
			if (idx > 0) {
				decklinks.set(idx, {
					index: idx,
					label: `${labelBase} [${idx}]`,
					externalRef,
				})
			}
		}
		const sm = line.match(/Screen consumer \[(\d+)\|([^\]]+)\] Initialized/i)
		if (sm) {
			const idx = parseInt(sm[1], 10)
			screens.set(idx, { index: idx, mode: sm[2] })
		}
	}

	return {
		decklinks: [...decklinks.values()].sort((a, b) => a.index - b.index),
		screens: [...screens.values()].sort((a, b) => a.index - b.index),
	}
}

function resolveLogDir() {
	const env = String(process.env.CASPAR_LOG_DIR || process.env.HIGHASCG_CASPAR_LOG_DIR || '').trim()
	if (env) return env
	return DEFAULT_LOG_DIR
}

function getRecentLogPaths() {
	const dir = resolveLogDir()
	try {
		if (!fs.existsSync(dir)) return []
		return fs
			.readdirSync(dir)
			.filter((f) => /^caspar_\d{4}-\d{2}-\d{2}\.log$/i.test(f))
			.sort()
			.reverse()
			.map((f) => path.join(dir, f))
	} catch {
		return []
	}
}

function tailFileUtf8(filePath, maxBytes) {
	if (!filePath || !fs.existsSync(filePath)) return ''
	try {
		const stat = fs.statSync(filePath)
		const size = stat.size
		if (size <= 0) return ''
		const readLen = Math.min(size, Math.max(128 * 1024, parseInt(String(maxBytes || 0), 10) || 4 * 1024 * 1024))
		const start = size - readLen
		const fd = fs.openSync(filePath, 'r')
		try {
			const buf = Buffer.alloc(readLen)
			fs.readSync(fd, buf, 0, readLen, start)
			return buf.toString('utf8')
		} finally {
			fs.closeSync(fd)
		}
	} catch {
		return ''
	}
}

/**
 * Read kernel log tail for Blackmagic firmware/driver warnings.
 * @returns {{ firmwareMismatch?: boolean, driverVersion?: string, detail?: string, warning?: string }}
 */
function probeDecklinkDriverHealth() {
	const sources = [
		() => execFileSync('journalctl', ['-k', '--no-pager', '-n', '400'], { encoding: 'utf8', timeout: 2000 }),
		() => fs.readFileSync('/var/log/kern.log', 'utf8').slice(-256 * 1024),
		() => fs.readFileSync('/var/log/syslog', 'utf8').slice(-256 * 1024),
	]
	let text = ''
	for (const read of sources) {
		try {
			text = String(read() || '')
			if (text.includes('BlackmagicIO') || text.includes('blackmagic')) break
		} catch {
			// try next source
		}
	}
	if (!text) return { warning: 'Could not read kernel log for DeckLink health' }

	const mismatch = /firmware version mismatch/i.test(text)
	const driverVer = text.match(/BlackmagicIO: Driver version ([^\n]+)/i)
	const mismatchLine = text.match(/BlackmagicIO: WARNING:[^\n]*firmware version mismatch[^\n]*/i)

	const out = {}
	if (driverVer?.[1]) out.driverVersion = String(driverVer[1]).trim()
	if (mismatch) {
		out.firmwareMismatch = true
		out.detail = mismatchLine?.[0]?.replace(/^[^\]]+\]\s*/, '').trim() || 'DeckLink firmware version mismatch (card older than Desktop Video driver)'
		out.warning =
			'DeckLink firmware mismatch: Caspar may enumerate zero devices until firmware is updated with Desktop Video Updater (run on local display :0).'
	}
	return out
}

/**
 * Enumerate DeckLink subdevices from PCI + /dev/blackmagic (no ffmpeg/API required).
 * @returns {{ source: string, connectors: Array<{ index: number, label: string, externalRef?: string }>, pciModel?: string, ioNodes?: string[], warning?: string, driverHealth?: object }}
 */
function probeDecklinkFromOs() {
	const health = probeDecklinkDriverHealth()
	let pciModel = ''
	try {
		const lspci = execFileSync('lspci', ['-nn'], { encoding: 'utf8', timeout: 1500 })
		const line = String(lspci || '')
			.split(/\r?\n/)
			.find((l) => /blackmagic|decklink/i.test(l))
		if (line) {
			const bm = line.match(/Blackmagic Design DeckLink[^\[]*|DeckLink [^\[]+/i)
			pciModel = bm?.[0]?.trim() || ''
			if (!pciModel) {
				const afterColon = line.split(':').slice(2).join(':').trim()
				const m = afterColon.match(/^(.+?)\s*\[[0-9a-f]{4}:[0-9a-f]{4}\]/i)
				pciModel = m?.[1]?.trim() || afterColon.replace(/\s*\[[^\]]+\]\s*$/, '').trim()
			}
		}
	} catch {
		// lspci optional
	}

	const ioDir = '/dev/blackmagic'
	/** @type {string[]} */
	let ioNodes = []
	try {
		if (fs.existsSync(ioDir)) {
			ioNodes = fs
				.readdirSync(ioDir)
				.filter((n) => /^io\d+$/.test(n))
				.sort((a, b) => parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10))
		}
	} catch {
		ioNodes = []
	}

	if (!pciModel && ioNodes.length === 0) {
		return {
			source: 'os_probe',
			connectors: [],
			driverHealth: health,
			warning: health.warning || 'No DeckLink PCI device or /dev/blackmagic nodes found',
		}
	}

	const modelBase = pciModel || 'DeckLink'
	const connectors = ioNodes.map((node, i) => ({
		index: i + 1,
		label: `${modelBase} [${i + 1}]`,
		externalRef: node,
	}))

	// PCI present but no io nodes — still report card so UI is not blank.
	if (connectors.length === 0 && pciModel) {
		connectors.push({ index: 1, label: `${pciModel} [1]` })
	}

	const warnings = []
	if (health.warning) warnings.push(health.warning)
	if (health.firmwareMismatch) {
		warnings.push('Caspar "Decklink devices found" block may be empty until firmware matches Desktop Video driver.')
	}

	return {
		source: 'os_probe',
		connectors,
		pciModel: pciModel || undefined,
		ioNodes,
		driverHealth: health,
		warning: warnings.length ? warnings.join(' ') : undefined,
	}
}

async function probeDecklinkFromFfmpeg(opts = {}) {
	const timeoutMs = Math.max(250, parseInt(String(opts.timeoutMs ?? 1200), 10) || 1200)
	const ffmpegBin = String(opts.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg'
	const args = ['-hide_banner', '-f', 'decklink', '-list_devices', '1', '-i', 'dummy']
	return new Promise((resolve) => {
		execFile(ffmpegBin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
			const body = `${stdout || ''}\n${stderr || ''}`
			const connectors = []
			const seen = new Set()
			for (const line of body.split(/\r?\n/)) {
				const m = line.match(/"([^"]*decklink[^"]*)"/i)
				if (m && m[1]) {
					const label = m[1].trim()
					if (label && !seen.has(label.toLowerCase())) {
						seen.add(label.toLowerCase())
						connectors.push({ index: connectors.length + 1, label })
					}
				}
			}
			if (connectors.length > 0) {
				resolve({ source: 'ffmpeg_decklink', connectors })
				return
			}
			if (err) {
				resolve({ source: 'ffmpeg_decklink', connectors: [], warning: err.message || String(err) })
				return
			}
			resolve({ source: 'ffmpeg_decklink', connectors: [] })
		})
	})
}

async function probeDecklinkHardware(opts = {}) {
	const now = Date.now()
	if (lastProbe && now - lastProbeAt < CACHE_TTL_MS) return lastProbe

	const ffmpeg = await probeDecklinkFromFfmpeg(opts)
	if (ffmpeg.connectors.length > 0) {
		lastProbeAt = now
		lastProbe = ffmpeg
		return ffmpeg
	}

	const os = probeDecklinkFromOs()
	if (os.connectors.length > 0) {
		const merged = {
			...os,
			sources: { ffmpeg: ffmpeg.source, os: os.source },
			warning: [ffmpeg.warning, os.warning].filter(Boolean).join(' ') || undefined,
		}
		lastProbeAt = now
		lastProbe = merged
		return merged
	}

	const res = {
		source: ffmpeg.source,
		connectors: [],
		sources: { ffmpeg: ffmpeg.source, os: os.source },
		driverHealth: os.driverHealth,
		warning: [ffmpeg.warning, os.warning].filter(Boolean).join(' ') || undefined,
	}
	lastProbeAt = now
	lastProbe = res
	return res
}

function probeDecklinkFromCasparLog(opts = {}) {
	try {
		const logPaths = getRecentLogPaths()
		if (!logPaths.length) return { source: 'caspar_log', connectors: [], screens: [], warning: 'No Caspar log files found' }

		/** @type {Array<{ index: number, label: string, externalRef?: string }>} */
		let bestDecklinks = []
		let decklinkLogPath = null
		/** @type {Array<{ index: number, mode: string }>} */
		let latestScreens = []
		let screensLogPath = null

		for (const logPath of logPaths) {
			const text = tailFileUtf8(logPath, opts.maxBytes ?? 4 * 1024 * 1024)
			if (!text) continue
			const { decklinks, screens } = parseCasparLogHardware(text)
			if (decklinks.length > bestDecklinks.length) {
				bestDecklinks = decklinks
				decklinkLogPath = logPath
			}
			if (screens.length > 0 && !screensLogPath) {
				latestScreens = screens
				screensLogPath = logPath
			}
		}

		if (bestDecklinks.length > 0) {
			return {
				source: 'caspar_log',
				connectors: bestDecklinks,
				screens: latestScreens,
				logPath: decklinkLogPath,
				screensLogPath,
			}
		}

		if (latestScreens.length > 0) {
			return {
				source: 'caspar_log',
				connectors: [],
				screens: latestScreens,
				logPath: screensLogPath,
				warning: 'No DeckLink enumeration in recent Caspar logs (screens only)',
			}
		}

		return { source: 'caspar_log', connectors: [], screens: [], warning: 'No hardware initialization found in recent logs' }
	} catch (e) {
		return { source: 'caspar_log', connectors: [], screens: [], warning: e?.message || String(e) }
	}
}

/**
 * @param {string} xmlStr
 * @param {function} cb
 */
function parseInfoConfigForDecklinks(xmlStr, cb) {
	if (!xmlStr) {
		if (typeof cb === 'function') cb({})
		return
	}
	const { parseString } = require('xml2js')
	parseString(xmlStr, (err, result) => {
		if (err || !result) {
			if (typeof cb === 'function') cb({})
			return
		}
		const decklink = {}
		try {
			let channels = result.configuration?.channels?.[0]?.channel
			if (channels && !Array.isArray(channels)) channels = [channels]
			if (Array.isArray(channels)) {
				channels.forEach((ch, idx) => {
					let consumers = ch.consumers?.[0]?.decklink
					if (consumers && !Array.isArray(consumers)) consumers = [consumers]
					if (Array.isArray(consumers) && consumers.length > 0) {
						decklink[idx + 1] = {
							consumers: consumers.map((c) => ({
								device: parseInt(Array.isArray(c.device) ? c.device[0] : c.device, 10) || 0,
								keyDevice:
									parseInt(
										Array.isArray(c['key-device']) ? c['key-device'][0] : c['key-device'],
										10
									) || 0,
								keyOnly:
									(Array.isArray(c['key-only']) ? c['key-only'][0] : c['key-only']) === 'true' ||
									(Array.isArray(c['key-only']) ? c['key-only'][0] : c['key-only']) === true,
								keyer: String(Array.isArray(c.keyer) ? c.keyer[0] : c.keyer || '').trim(),
								embeddedAudio: (Array.isArray(c['embedded-audio']) ? c['embedded-audio'][0] : c['embedded-audio']) === 'true',
							})),
						}
					}
				})
			}
		} catch (e) {
			// ignore parse errors
		}
		if (typeof cb === 'function') cb(decklink)
	})
}

module.exports = {
	probeDecklinkHardware,
	probeDecklinkFromCasparLog,
	probeDecklinkFromOs,
	probeDecklinkDriverHealth,
	parseCasparLogHardware,
	parseInfoConfigForDecklinks,
	parseDecklinkDevicesFromFfmpegText,
}
