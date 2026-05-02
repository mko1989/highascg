'use strict'

const fs = require('fs')
const os = require('os')
const { getDisplayDetails, getGpuConnectorInventory } = require('../utils/hardware-info')
const { listAudioDevices, listPortAudioDevices } = require('../audio/audio-devices')
const { buildGpuPhysicalMap } = require('../utils/gpu-physical-map')

const DEFAULT_PATH = '/tmp/highascg-system-inventory.json'

function resolveOutputPath() {
	const raw = process.env.HIGHASCG_SYSTEM_INVENTORY_PATH
	const p = raw != null && String(raw).trim() ? String(raw).trim() : DEFAULT_PATH
	return p
}

function collectNetwork() {
	const out = []
	const nets = os.networkInterfaces()
	for (const [name, entries] of Object.entries(nets)) {
		for (const e of entries || []) {
			if (!e || e.family !== 'IPv4' || e.internal) continue
			out.push({
				iface: name,
				address: e.address,
				netmask: e.netmask || '',
				mac: e.mac || '',
			})
		}
	}
	return out
}

function resolveCasparLogPath() {
	const env = String(process.env.CASPAR_LOG_PATH || '').trim()
	if (env) return env
	const d = new Date()
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `/opt/casparcg/log/caspar_${y}-${m}-${day}.log`
}

/**
 * @param {string} filePath
 * @param {number} maxBytes
 * @returns {string}
 */
function readFileTailText(filePath, maxBytes) {
	if (!fs.existsSync(filePath)) return ''
	const stat = fs.statSync(filePath)
	const size = stat.size
	if (size <= 0) return ''
	const fd = fs.openSync(filePath, 'r')
	try {
		const readLen = Math.min(size, maxBytes)
		const start = size - readLen
		const buf = Buffer.alloc(readLen)
		fs.readSync(fd, buf, 0, readLen, start)
		return buf.toString('utf8')
	} finally {
		fs.closeSync(fd)
	}
}

/**
 * Parse Caspar startup log block:
 *   Decklink devices found:
 *    - DeckLink 8K Pro [1] (2254678464)
 *
 * @param {string} text
 * @returns {Array<{ index: number, label: string, rawId?: string }>}
 */
function parseDecklinkDevicesFromCasparLog(text) {
	const lines = String(text || '').split(/\r?\n/)
	const out = []
	const seen = new Set()
	let inBlock = false
	for (const line of lines) {
		if (/Decklink devices found:/i.test(line)) {
			inBlock = true
			continue
		}
		if (!inBlock) continue
		const m = line.match(/-\s*(.+?)\s*\[(\d+)\](?:\s*\(([^)]+)\))?/i)
		if (m) {
			const label = String(m[1] || '').trim()
			const index = parseInt(String(m[2] || ''), 10)
			if (!label || !Number.isFinite(index) || index < 1) continue
			const key = `${index}:${label.toLowerCase()}`
			if (seen.has(key)) continue
			seen.add(key)
			const item = { index, label }
			const rawId = String(m[3] || '').trim()
			if (rawId) item.rawId = rawId
			out.push(item)
			continue
		}
		// End of block after first non-device line following parsed entries.
		if (out.length > 0 && !/^\s*\[/.test(line)) break
	}
	return out.sort((a, b) => a.index - b.index)
}

function collectDecklinkFromCasparLog() {
	try {
		const p = resolveCasparLogPath()
		const tail = readFileTailText(p, 2 * 1024 * 1024)
		if (!tail) return { source: 'caspar_log', connectors: [], logPath: p, warning: 'empty_or_missing_log' }
		const connectors = parseDecklinkDevicesFromCasparLog(tail)
		return { source: 'caspar_log', connectors, logPath: p }
	} catch (e) {
		return { source: 'caspar_log', connectors: [], warning: e?.message || String(e) }
	}
}

function buildPayload(config) {
	const displays = getDisplayDetails() || []
	const connectors = getGpuConnectorInventory() || []
	const physicalMap = buildGpuPhysicalMap({ config: config || {}, displays, connectors })
	return {
		version: 1,
		collectedAt: new Date().toISOString(),
		host: {
			hostname: os.hostname(),
			platform: process.platform,
			release: os.release(),
			arch: process.arch,
		},
		gpu: {
			displays,
			connectors,
			physicalMap,
		},
		network: {
			ipv4: collectNetwork(),
		},
		decklink: collectDecklinkFromCasparLog(),
		audio: {
			alsa: listAudioDevices({ refresh: true })?.devices || [],
			portaudio: listPortAudioDevices({ refresh: true, outputsOnly: true })?.devices || [],
		},
	}
}

function summarizeGpuPhysicalMap(payload) {
	const ports = Array.isArray(payload?.gpu?.physicalMap?.ports) ? payload.gpu.physicalMap.ports : []
	if (!ports.length) return 'no physical GPU mapping data'
	return ports
		.map((p) => {
			const pid = String(p?.physicalPortId || '')
			const pair = String(p?.pair?.name || '').trim()
			const active = String(p?.runtime?.activePort || '').trim() || '-'
			const state = p?.runtime?.connected ? 'up' : 'down'
			return `${pid}:${pair || '?'}=>${active}(${state})`
		})
		.join(' | ')
}

/**
 * Write startup hardware inventory snapshot for device-view.
 * @param {(level:'info'|'warn'|'error'|'debug', msg: string) => void} [log]
 * @param {object} [config]
 * @returns {{ path: string, payload: object } | null}
 */
function writeSystemInventoryFile(log, config) {
	const p = resolveOutputPath()
	try {
		const payload = buildPayload(config)
		const body = JSON.stringify(payload, null, 2) + '\n'
		fs.writeFileSync(p, body, 'utf8')
		if (typeof log === 'function') {
			log('info', `[startup] wrote system inventory: ${p}`)
			log('info', `[startup] gpu physical mapping: ${summarizeGpuPhysicalMap(payload)}`)
		}
		return { path: p, payload }
	} catch (e) {
		if (typeof log === 'function') log('warn', `[startup] failed to write system inventory: ${e?.message || e}`)
		return null
	}
}

/**
 * Read inventory file if available.
 * @returns {{ path: string, payload: any, stale: boolean } | null}
 */
function readSystemInventoryFile() {
	const p = resolveOutputPath()
	try {
		if (!fs.existsSync(p)) return null
		const raw = fs.readFileSync(p, 'utf8')
		const payload = JSON.parse(raw)
		const ts = payload?.collectedAt ? Date.parse(String(payload.collectedAt)) : NaN
		const stale = Number.isFinite(ts) ? Date.now() - ts > 10 * 60 * 1000 : true
		return { path: p, payload, stale }
	} catch {
		return null
	}
}

module.exports = {
	DEFAULT_PATH,
	resolveOutputPath,
	writeSystemInventoryFile,
	readSystemInventoryFile,
}

