'use strict'

const { execSync } = require('child_process')
const fs = require('fs')

function normalizePortName(v) {
	const s = String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
	if (!s) return ''
	let m = s.match(/^(DP)-(\d+(?:-\d+)*)$/)
	if (m) return `DP-${m[2]}`
	m = s.match(/^(HDMI-A)-(\d+)$/)
	if (m) return `${m[1]}-${parseInt(m[2], 10)}`
	m = s.match(/^(HDMI|DVI|VGA)-(\d+)$/)
	if (m) return `${m[1]}-${parseInt(m[2], 10)}`
	m = s.match(/^(E-?DP)-(\d+)-(\d+)$/)
	if (m) return `EDP-${parseInt(m[2], 10)}-${parseInt(m[3], 10)}`
	m = s.match(/^(E-?DP)-(\d+)$/)
	if (m) return `EDP-${parseInt(m[2], 10)}`
	return s
}

function listDrmGpuCards() {
	const drmPath = '/sys/class/drm'
	if (!fs.existsSync(drmPath)) return []
	return fs.readdirSync(drmPath)
		.filter((f) => /^card\d+$/.test(f))
		.sort((a, b) => {
			const na = parseInt(a.replace(/^card/i, ''), 10)
			const nb = parseInt(b.replace(/^card/i, ''), 10)
			return na - nb
		})
}

function inferConnectorType(name) {
	const s = String(name || '').toUpperCase()
	if (s.includes('HDMI')) return 'hdmi'
	if (s.includes('DISPLAYPORT') || /^DP-/.test(s) || s.includes('E-DP') || s.includes('EDP')) return 'displayport'
	if (s.includes('DVI')) return 'dvi'
	if (s.includes('VGA')) return 'vga'
	if (s.includes('USB-C') || s.includes('USBC') || s.includes('TYPEC')) return 'usb-c'
	return 'unknown'
}

function isSkippableConnectorName(name) {
	const s = String(name || '').trim()
	if (!s) return true
	if (/writeback/i.test(s)) return true
	return false
}

/**
 * Collapse EDID hex blobs to a comparable lowercase string.
 * @param {string} raw
 * @returns {string}
 */
function normalizeEdidHex(raw) {
	return String(raw || '')
		.replace(/[^0-9a-fA-F]/g, '')
		.toLowerCase()
}

/**
 * First 128 EDID bytes — enough to correlate modetest and xrandr on the same monitor.
 * @param {string} edid
 * @returns {string}
 */
function edidMatchKey(edid) {
	const n = normalizeEdidHex(edid)
	if (n.length < 32) return ''
	return n.slice(0, 256)
}

/**
 * Run `modetest -c` and return combined stdout/stderr text.
 * @param {{ driverModule?: string, timeoutMs?: number }} [opts]
 * @returns {string | null}
 */
function runModetestConnectorsRaw(opts = {}) {
	try {
		const parts = []
		const driver = String(opts.driverModule || '').trim()
		if (driver) parts.push('-M', driver)
		parts.push('-c')
		const out = execSync(`modetest ${parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ')} 2>&1`, {
			encoding: 'utf8',
			timeout: opts.timeoutMs ?? 10000,
			maxBuffer: 8 * 1024 * 1024,
		})
		return String(out || '')
	} catch (e) {
		const text = String(e?.stdout || e?.output?.[1] || '')
		if (text.includes('Connectors:')) return text
		return null
	}
}

/**
 * @param {string} raw
 * @returns {string}
 */
function parseModetestDrmCard(raw) {
	const text = String(raw || '')
	const m =
		text.match(/trying to open device '\/dev\/dri\/(card\d+)'/i) ||
		text.match(/\/dev\/dri\/(card\d+)/i)
	return m ? m[1].toLowerCase() : ''
}

/**
 * Parse `modetest -c` connector block (modes + EDID).
 * @param {string} raw
 * @param {{ drmCard?: string }} [opts]
 * @returns {Array<{
 *   id: number,
 *   status: string,
 *   shortName: string,
 *   name: string,
 *   drmCard: string,
 *   connected: boolean,
 *   type: string,
 *   sizeMm: { width: number, height: number } | null,
 *   modes: Array<{ index: number, width: number, height: number, hz: number, preferred: boolean, flags: string }>,
 *   edid: string,
 *   xrandrName?: string,
 *   matchMethod?: string
 * }>}
 */
function parseModetestConnectors(raw, opts = {}) {
	const text = String(raw || '')
	if (!text.includes('Connectors:')) return []

	const drmCard = String(opts.drmCard || parseModetestDrmCard(text) || listDrmGpuCards()[0] || 'card0')
	/** @type {ReturnType<typeof parseModetestConnectors>} */
	const connectors = []
	let cur = null
	let section = ''
	let inEdidValue = false
	let edidLines = []

	function flushEdid() {
		if (!cur) return
		if (edidLines.length) cur.edid = normalizeEdidHex(edidLines.join(''))
		edidLines = []
		inEdidValue = false
	}

	function pushCur() {
		if (!cur) return
		flushEdid()
		if (!isSkippableConnectorName(cur.shortName)) connectors.push(cur)
		cur = null
		section = ''
	}

	for (const line of text.split('\n')) {
		const head = line.match(/^(\d+)\t(\d+)\t(connected|disconnected)\t(\S+)/)
		if (head) {
			pushCur()
			const shortName = head[4].trim()
			const sizeTok = line.split('\t')[4]?.trim() || ''
			let sizeMm = null
			const sm = sizeTok.match(/^(\d+)x(\d+)$/)
			if (sm && sm[1] !== '0' && sm[2] !== '0') {
				sizeMm = { width: parseInt(sm[1], 10), height: parseInt(sm[2], 10) }
			}
			cur = {
				id: parseInt(head[1], 10),
				status: head[3],
				shortName,
				name: `${drmCard}-${shortName}`,
				drmCard,
				connected: head[3] === 'connected',
				type: inferConnectorType(shortName),
				sizeMm,
				modes: [],
				edid: '',
			}
			section = ''
			continue
		}

		if (!cur) continue

		if (/^\s+modes:\s*$/.test(line)) {
			section = 'modes'
			continue
		}
		if (/^\s+props:\s*$/.test(line)) {
			section = 'props'
			continue
		}

		if (section === 'modes') {
			const mode = line.match(/^\s+#(\d+)\s+(\d+)x(\d+)\s+([\d.]+)/)
			if (mode) {
				const flags = line.includes('flags:') ? line.split('flags:')[1]?.split(';')[0]?.trim() || '' : ''
				const preferred = /type:\s*preferred/.test(line)
				cur.modes.push({
					index: parseInt(mode[1], 10),
					width: parseInt(mode[2], 10),
					height: parseInt(mode[3], 10),
					hz: parseFloat(mode[4]),
					preferred,
					flags,
				})
			}
			continue
		}

		if (section === 'props') {
			if (/^\t\d+\s+EDID:/.test(line)) {
				flushEdid()
				inEdidValue = false
				continue
			}
			if (/^\t\tvalue:\s*$/.test(line)) {
				inEdidValue = true
				continue
			}
			if (inEdidValue) {
				if (/^\t\t\t[0-9a-fA-F]+/.test(line)) {
					edidLines.push(line.trim())
					continue
				}
				flushEdid()
			}
		}
	}
	pushCur()
	return connectors
}

/**
 * Parse `xrandr --verbose` outputs for EDID + connector numbers.
 * @param {string} raw
 * @returns {Array<{ name: string, connected: boolean, edid: string, connectorNumber: number | null }>}
 */
function parseXrandrVerboseOutputs(raw) {
	const text = String(raw || '')
	/** @type {ReturnType<typeof parseXrandrVerboseOutputs>} */
	const outputs = []
	let cur = null
	let inEdid = false
	let edidParts = []

	function flushOutput() {
		if (!cur) return
		if (edidParts.length) cur.edid = normalizeEdidHex(edidParts.join(''))
		outputs.push(cur)
		cur = null
		inEdid = false
		edidParts = []
	}

	for (const line of text.split('\n')) {
		const head = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (head) {
			flushOutput()
			cur = {
				name: head[1],
				connected: head[2] === 'connected',
				edid: '',
				connectorNumber: null,
			}
			inEdid = false
			continue
		}
		if (!cur) continue

		const cn = line.match(/^\s+ConnectorNumber:\s+(\d+)/)
		if (cn) {
			cur.connectorNumber = parseInt(cn[1], 10)
			continue
		}

		if (/^\s+EDID:\s*$/.test(line)) {
			inEdid = true
			edidParts = []
			continue
		}

		if (inEdid) {
			const hexLine = line.match(/^\s+([0-9a-fA-F]+)\s*$/)
			if (hexLine) {
				edidParts.push(hexLine[1])
				continue
			}
			inEdid = false
		}
	}
	flushOutput()
	return outputs
}

/**
 * Correlate modetest DRM connector names to live xrandr output names.
 * Primary key is EDID; falls back to normalized connector name.
 * @param {ReturnType<typeof parseModetestConnectors>} modetestConnectors
 * @param {ReturnType<typeof parseXrandrVerboseOutputs>} xrandrOutputs
 * @returns {Map<string, string>} modetest shortName -> xrandr output name
 */
function matchModetestToXrandr(modetestConnectors, xrandrOutputs) {
	const byEdid = new Map()
	for (const x of xrandrOutputs || []) {
		const key = edidMatchKey(x.edid)
		if (!key) continue
		if (!byEdid.has(key)) byEdid.set(key, [])
		byEdid.get(key).push(x)
	}

	const matches = new Map()
	const usedXrandr = new Set()
	const usedConn = new Set()

	// Pass 1: live xrandr name match (authoritative when an output is connected).
	for (const x of xrandrOutputs || []) {
		if (!x.connected || usedXrandr.has(x.name)) continue
		const xNorm = normalizePortName(x.name)
		if (!xNorm) continue
		for (const conn of modetestConnectors || []) {
			if (usedConn.has(conn.shortName)) continue
			if (normalizePortName(conn.shortName) !== xNorm) continue
			matches.set(conn.shortName, x.name)
			usedXrandr.add(x.name)
			usedConn.add(conn.shortName)
			conn.xrandrName = x.name
			conn.matchMethod = 'name'
			break
		}
	}

	for (const conn of modetestConnectors || []) {
		if (conn.xrandrName) continue

		const edidKey = edidMatchKey(conn.edid)
		if (edidKey && byEdid.has(edidKey)) {
			const candidates = byEdid.get(edidKey).filter((x) => !usedXrandr.has(x.name))
			const hit = candidates.find((x) => x.connected) || candidates[0]
			if (hit) {
				matches.set(conn.shortName, hit.name)
				usedXrandr.add(hit.name)
				usedConn.add(conn.shortName)
				conn.xrandrName = hit.name
				conn.matchMethod = 'edid'
				continue
			}
		}

		if (conn.xrandrName) continue

		const { aliasNameScore, connectorMediaKind } = require('./gpu-display-alias')
		const kind = connectorMediaKind(conn.shortName)
		if (kind === 'other' || !conn.connected) continue
		const candidates = (xrandrOutputs || []).filter(
			(x) => x.connected && !usedXrandr.has(x.name) && connectorMediaKind(x.name) === kind,
		)
		if (!candidates.length) continue
		let best = candidates[0]
		let bestScore = -1
		for (const x of candidates) {
			const score = aliasNameScore(x.name, conn.shortName)
			if (score > bestScore) {
				bestScore = score
				best = x
			}
		}
		if (bestScore > 0) {
			matches.set(conn.shortName, best.name)
			usedXrandr.add(best.name)
			usedConn.add(conn.shortName)
			conn.xrandrName = best.name
			conn.matchMethod = 'heuristic'
		}
	}

	return matches
}

function modetestModesToDisplayModes(modetestModes, currentResolution, currentHz) {
	const [curW, curH] = String(currentResolution || '')
		.split('x')
		.map((n) => parseInt(n, 10))
	const modes = []
	const seen = new Set()
	for (const m of modetestModes || []) {
		const key = `${m.width}x${m.height}@${m.hz}`
		if (seen.has(key)) continue
		seen.add(key)
		const current =
			Number.isFinite(curW) &&
			Number.isFinite(curH) &&
			m.width === curW &&
			m.height === curH &&
			(!Number.isFinite(currentHz) || Math.abs(m.hz - currentHz) < 0.2)
		modes.push({
			width: m.width,
			height: m.height,
			hz: m.hz,
			current,
			preferred: !!m.preferred,
			modetestIndex: m.index,
		})
	}
	return modes
}

/**
 * Probe connectors via modetest and correlate to xrandr outputs.
 * @param {{ modetestRaw?: string, xrandrVerboseRaw?: string, driverModule?: string }} [opts]
 */
function probeModetestConnectors(opts = {}) {
	let raw = opts.modetestRaw
	if (raw == null) raw = runModetestConnectorsRaw({ driverModule: opts.driverModule })
	if (!raw) return { connectors: [], matches: new Map(), raw: '', source: 'modetest' }

	const drmCard = parseModetestDrmCard(raw) || listDrmGpuCards()[0] || 'card0'
	const connectors = parseModetestConnectors(raw, { drmCard })
	const xrandrVerbose = opts.xrandrVerboseRaw != null ? parseXrandrVerboseOutputs(opts.xrandrVerboseRaw) : []
	const matches = xrandrVerbose.length ? matchModetestToXrandr(connectors, xrandrVerbose) : new Map()

	return { connectors, matches, raw, source: 'modetest', drmCard }
}

module.exports = {
	listDrmGpuCards,
	normalizeEdidHex,
	edidMatchKey,
	runModetestConnectorsRaw,
	parseModetestDrmCard,
	parseModetestConnectors,
	parseXrandrVerboseOutputs,
	matchModetestToXrandr,
	modetestModesToDisplayModes,
	probeModetestConnectors,
	inferConnectorType,
}
