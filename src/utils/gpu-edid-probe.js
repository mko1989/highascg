'use strict'

const fs = require('fs')
const path = require('path')
const { parseEdidHex } = require('./edid-parse')
const {
	normalizeEdidHex,
	edidMatchKey,
	parseXrandrVerboseOutputs,
	probeModetestConnectors,
	listDrmGpuCards,
	normalizePortName,
} = require('./gpu-modetest')

const EDID_PROBE_BUDGET_MS = Math.max(
	50,
	parseInt(process.env.HIGHASCG_EDID_PROBE_BUDGET_MS || '250', 10) || 250,
)
const EDID_CACHE_TTL_MS = Math.max(
	0,
	parseInt(process.env.HIGHASCG_EDID_CACHE_TTL_MS || '3000', 10) || 3000,
)

/** @type {Map<string, object | null>} */
const parseCache = new Map()
/** @type {{ at: number, value: object } | null} */
let catalogCache = null

function invalidateGpuEdidCache() {
	catalogCache = null
}

function emptyEdidShape() {
	return { raw: '', parsed: null }
}

function getOrParseEdid(rawHex) {
	const key = edidMatchKey(rawHex) || normalizeEdidHex(rawHex).slice(0, 256)
	if (!key) return null
	if (parseCache.has(key)) return parseCache.get(key)
	const parsed = parseEdidHex(rawHex)
	parseCache.set(key, parsed)
	return parsed
}

function readSysfsEdidEntries() {
	const drmPath = '/sys/class/drm'
	if (!fs.existsSync(drmPath)) return []
	/** @type {Array<{ drmCard: string, sysfsName: string, shortName: string, status: string, raw: string }>} */
	const out = []
	for (const ent of fs.readdirSync(drmPath)) {
		const m = ent.match(/^card(\d+)-(DP|HDMI|DVI|VGA|eDP)-(\d+)$/i)
		if (!m) continue
		const base = path.join(drmPath, ent)
		let status = 'unknown'
		try {
			status = fs.readFileSync(path.join(base, 'status'), 'utf8').trim()
		} catch {
			/* optional */
		}
		let raw = ''
		try {
			const buf = fs.readFileSync(path.join(base, 'edid'))
			if (buf.length >= 128) raw = buf.toString('hex')
		} catch {
			/* optional */
		}
		if (!raw) continue
		out.push({
			drmCard: `card${m[1]}`,
			sysfsName: ent,
			shortName: `${m[2]}-${m[3]}`,
			status,
			raw,
		})
	}
	return out
}

function guessDrmCardFromSysfs(xrandrName, sysfsEntries, byEdidKey) {
	for (const row of sysfsEntries) {
		if (normalizePortName(row.shortName) === normalizePortName(xrandrName)) return row.drmCard
	}
	return ''
}

/**
 * Build xrandr-name → EDID catalog (sysfs → xrandr-verbose → modetest).
 * @param {{ budgetMs?: number, xrandrVerboseRaw?: string }} [opts]
 */
function probeGpuEdidCatalog(opts = {}) {
	const budgetMs = opts.budgetMs ?? EDID_PROBE_BUDGET_MS
	const started = Date.now()
	if (catalogCache && Date.now() - catalogCache.at < EDID_CACHE_TTL_MS) {
		return catalogCache.value
	}

	/** @type {Map<string, { raw: string, parsed: object | null, source: string, drmCard: string, xrandrName: string }>} */
	const byXrandr = new Map()
	const warnings = []
	const sysfsEntries = readSysfsEdidEntries()
	const byEdidKey = new Map()
	for (const row of sysfsEntries) {
		const key = edidMatchKey(row.raw)
		if (key && !byEdidKey.has(key)) byEdidKey.set(key, row)
	}

	const defaultCard = listDrmGpuCards()[0] || 'card0'
	const timeLeft = () => Math.max(0, budgetMs - (Date.now() - started))

	let xrandrVerboseRaw = opts.xrandrVerboseRaw
	if (xrandrVerboseRaw == null && timeLeft() > 0) {
		try {
			const { getDisplaysXrandrVerboseRaw } = require('./hardware-info')
			xrandrVerboseRaw = getDisplaysXrandrVerboseRaw()
		} catch (e) {
			warnings.push(`edid_xrandr_verbose: ${e.message}`)
		}
	}

	if (xrandrVerboseRaw && timeLeft() > 0) {
		try {
			for (const o of parseXrandrVerboseOutputs(xrandrVerboseRaw)) {
				if (!o.edid) continue
				const norm = normalizePortName(o.name)
				if (!norm) continue
				const parsed = getOrParseEdid(o.edid)
				const drmCard =
					guessDrmCardFromSysfs(o.name, sysfsEntries, byEdidKey) ||
					(byEdidKey.get(edidMatchKey(o.edid)) || {}).drmCard ||
					defaultCard
				byXrandr.set(norm, {
					raw: o.edid,
					parsed,
					source: 'xrandr-verbose',
					drmCard,
					xrandrName: o.name,
				})
			}
		} catch (e) {
			warnings.push(`edid_xrandr_parse: ${e.message}`)
		}
	}

	for (const row of sysfsEntries) {
		if (row.status !== 'connected') continue
		const norm = normalizePortName(row.shortName)
		if (!norm || byXrandr.has(norm)) continue
		const parsed = getOrParseEdid(row.raw)
		byXrandr.set(norm, {
			raw: row.raw,
			parsed,
			source: 'sysfs',
			drmCard: row.drmCard,
			xrandrName: row.shortName,
		})
	}

	if (timeLeft() > 20) {
		try {
			const probe = probeModetestConnectors({
				xrandrVerboseRaw: xrandrVerboseRaw || '',
				timeoutMs: Math.min(timeLeft(), 8000),
			})
			for (const conn of probe.connectors || []) {
				if (!conn.edid) continue
				const xrName = conn.xrandrName || probe.matches?.get?.(conn.shortName) || ''
				const norm = normalizePortName(xrName || conn.shortName)
				if (!norm || byXrandr.has(norm)) continue
				const parsed = getOrParseEdid(conn.edid)
				byXrandr.set(norm, {
					raw: conn.edid,
					parsed,
					source: 'modetest',
					drmCard: conn.drmCard || probe.drmCard || defaultCard,
					xrandrName: xrName || conn.shortName,
				})
			}
		} catch (e) {
			warnings.push(`edid_modetest: ${e.message}`)
		}
	}

	const value = {
		byXrandr,
		warnings,
		defaultCard,
		elapsedMs: Date.now() - started,
	}
	catalogCache = { at: Date.now(), value }
	return value
}

/**
 * @param {string} xrandrName
 * @param {{ connected?: boolean, catalog?: ReturnType<typeof probeGpuEdidCatalog> }} [opts]
 */
function edidForXrandrOutput(xrandrName, opts = {}) {
	if (opts.connected === false) return { ...emptyEdidShape(), drmCard: '' }
	const catalog = opts.catalog || probeGpuEdidCatalog()
	const hit = catalog.byXrandr.get(normalizePortName(xrandrName))
	if (!hit) return { ...emptyEdidShape(), drmCard: catalog.defaultCard || 'card0' }
	return {
		raw: hit.raw,
		parsed: hit.parsed,
		drmCard: hit.drmCard || catalog.defaultCard || 'card0',
		source: hit.source,
	}
}

function attachEdidToConnector(connector, catalog) {
	const name = connector.xrandrName || connector.name || connector.shortName || ''
	const ed = edidForXrandrOutput(name, { connected: connector.connected, catalog })
	return {
		...connector,
		drmCard: ed.drmCard || connector.drmCard || catalog?.defaultCard || 'card0',
		edid: { raw: ed.raw, parsed: ed.parsed },
		monitor: ed.parsed,
	}
}

module.exports = {
	probeGpuEdidCatalog,
	edidForXrandrOutput,
	attachEdidToConnector,
	invalidateGpuEdidCache,
	emptyEdidShape,
}
