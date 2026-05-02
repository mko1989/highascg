'use strict'

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const CACHE_TTL_MS = 5000
let lastProbeAt = 0
let lastProbe = null

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
 * Searches for the last initialization block.
 *
 * @param {string} text
 * @returns {{ decklinks: Array<{ index: number, label: string, externalRef?: string }>, screens: Array<{ index: number, mode: string }> }}
 */
function parseCasparLogHardware(text) {
	const lines = String(text || '').split(/\r?\n/)
	let startupIdx = -1
	for (let i = lines.length - 1; i >= 0; i--) {
		// Match any DeckLink model (8K Pro, Duo 2, Mini, Quad, etc.) or generic startup markers
		if (lines[i].includes('CasparCG Server is starting') || lines[i].includes('Initializing DeckLink') || /DeckLink\s+\S+/i.test(lines[i])) {
			startupIdx = i
			// Keep going back to find the very start of the list
			while (startupIdx > 0 && (/DeckLink/i.test(lines[startupIdx - 1]) || lines[startupIdx - 1].includes('Screen consumer'))) {
				startupIdx--
			}
			break
		}
	}

	const decklinks = new Map()
	const screens = new Map()
	const searchLines = startupIdx >= 0 ? lines.slice(startupIdx) : lines

	for (const line of searchLines) {
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

function getRecentLogPaths() {
	const dir = '/opt/casparcg/log'
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

async function probeDecklinkHardware(opts = {}) {
	const now = Date.now()
	if (lastProbe && now - lastProbeAt < CACHE_TTL_MS) return lastProbe
	const timeoutMs = Math.max(250, parseInt(String(opts.timeoutMs ?? 1200), 10) || 1200)
	const args = ['-hide_banner', '-f', 'decklink', '-list_devices', '1', '-i', 'dummy']
	const res = await new Promise((resolve) => {
		execFile('ffmpeg', args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
			const body = `${stdout || ''}\n${stderr || ''}`
			const connectors = []
			const seen = new Set()
			const lines = body.split(/\r?\n/)
			for (const line of lines) {
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
	lastProbeAt = now
	lastProbe = res
	return res
}

function probeDecklinkFromCasparLog(opts = {}) {
	try {
		const logPaths = getRecentLogPaths()
		if (!logPaths.length) return { source: 'caspar_log', connectors: [], screens: [], warning: 'No Caspar log files found' }
		
		for (const logPath of logPaths) {
			const text = tailFileUtf8(logPath, opts.maxBytes ?? 4 * 1024 * 1024)
			if (!text) continue
			const { decklinks, screens } = parseCasparLogHardware(text)
			if (decklinks.length > 0 || screens.length > 0) {
				return { source: 'caspar_log', connectors: decklinks, screens, logPath }
			}
		}
		return { source: 'caspar_log', connectors: [], screens: [], warning: 'No hardware initialization found in recent logs' }
	} catch (e) {
		return { source: 'caspar_log', connectors: [], screens: [], warning: e?.message || String(e) }
	}
}

module.exports = {
	probeDecklinkHardware,
	probeDecklinkFromCasparLog,
	parseCasparLogHardware,
}

