'use strict'

const { execSync } = require('child_process')

/* WO-391c: the xrandr probes + their cache live in one module — see hardware-info-xrandr.js. */
const {
	getXAuthority,
	getDisplaysXrandrVerboseRaw,
	getDisplaysXrandrVerboseRawAsync,
	invalidateXrandrCache,
	getDisplaysXrandrDetailed,
	getDisplaysXrandrDetailedAsync,
} = require('./hardware-info-xrandr')

function drmShort(name) {
	return String(name || '').replace(/^card\d+-/i, '')
}

function isGpuConnectorPseudoName(name) {
	const s = String(name || '').trim().toLowerCase()
	if (!s) return true
	if (/^card\d+$/.test(s)) return true
	if (/^renderd\d+$/.test(s)) return true
	if (/^renderd\d+-/.test(s)) return true
	return false
}

function connectorSortKey(name) {
	const short = drmShort(String(name || '').trim())
	const up = short.toUpperCase()
	const m = up.match(/^(DP|HDMI|DVI|VGA|E-?DP|USBC|USB-C)-?(\d+)?(?:-(\d+))?/)
	let typeRank = 99
	let a = 999
	let b = 0
	if (m) {
		const t = m[1].replace('-', '')
		if (t === 'DP' || t === 'EDP') typeRank = 1
		else if (t === 'HDMI') typeRank = 2
		else if (t === 'DVI') typeRank = 3
		else if (t === 'VGA') typeRank = 4
		else if (t === 'USBC') typeRank = 5
		if (m[2]) a = parseInt(m[2], 10)
		if (m[3]) b = parseInt(m[3], 10)
	}
	return { typeRank, a, b, short: up }
}

function compareConnectorNames(a, b) {
	const ka = connectorSortKey(a)
	const kb = connectorSortKey(b)
	if (ka.typeRank !== kb.typeRank) return ka.typeRank - kb.typeRank
	if (ka.a !== kb.a) return ka.a - kb.a
	if (ka.b !== kb.b) return ka.b - kb.b
	return ka.short.localeCompare(kb.short)
}

/**
 * Get connected displays using xrandr (if available and X is running).
 * @returns {Array<{name: string, connected: boolean, resolution: string, x: number, y: number}>}
 */
function getDisplaysXrandr() {
	const res = getDisplaysXrandrDetailed()
	const d = res?.displays
	if (!d || !d.length) return null
	return d.map((x) => ({
		name: x.name,
		connected: x.connected,
		resolution: x.resolution,
		x: x.x,
		y: x.y,
	}))
}

/** @param {string} raw */
function parseXrandrAllOutputs(raw) {
	/** @type {Array<{ name: string, connected: boolean }>} */
	const out = []
	for (const line of String(raw || '').split('\n')) {
		const m = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (!m) continue
		const name = m[1].replace(/^card\d+-/i, '')
		if (!/^(DP|HDMI|E-?DP)/i.test(name)) continue
		out.push({ name, connected: m[2] === 'connected' })
	}
	return out
}

/**
 * GPU connector list from live xrandr --query (connected and disconnected DP/HDMI outputs).
 */
/**
 * PURE — shared by {@link getGpuConnectorInventory} and its async sibling so the two can never
 * drift: both just fetch (xr, catalog) their own way and hand them to this one builder.
 * @param {object | null} xr
 * @param {object} catalog
 */
function buildGpuConnectorInventoryFrom(xr, catalog) {
	const { attachEdidToConnector } = require('./gpu-edid-probe')
	const outputs = parseXrandrAllOutputs(xr?.raw || '')
	return outputs.map((o) =>
		attachEdidToConnector(
			{
				name: o.name,
				shortName: o.name,
				connected: !!o.connected,
				type: /^HDMI/i.test(o.name) ? 'hdmi' : 'displayport',
				modetestId: null,
				drmCard: catalog.defaultCard || 'card0',
				modes: [],
				xrandrName: o.name,
				matchMethod: 'xrandr',
				sizeMm: null,
			},
			catalog,
		),
	)
}

function getGpuConnectorInventory() {
	const { probeGpuEdidCatalog } = require('./gpu-edid-probe')
	const catalog = probeGpuEdidCatalog()
	const xr = getDisplaysXrandrDetailed()
	return buildGpuConnectorInventoryFrom(xr, catalog)
}

/**
 * WO-309: non-blocking sibling of {@link getGpuConnectorInventory}, for the GET /api/device-view
 * request path. Fetches xrandr --query and --verbose CONCURRENTLY (independent probes), passes the
 * verbose raw into probeGpuEdidCatalog's existing `opts.xrandrVerboseRaw` injection point so it
 * skips its own internal blocking call, then reuses the exact same pure builder as the sync path.
 * @returns {Promise<object[]>}
 */
async function getGpuConnectorInventoryAsync() {
	const { probeGpuEdidCatalog } = require('./gpu-edid-probe')
	const [xr, xrandrVerboseRaw] = await Promise.all([
		getDisplaysXrandrDetailedAsync(),
		getDisplaysXrandrVerboseRawAsync(),
	])
	const catalog = probeGpuEdidCatalog({ xrandrVerboseRaw })
	return buildGpuConnectorInventoryFrom(xr, catalog)
}

/**
 * PURE — shared by {@link getDisplayDetails} and its async sibling.
 * @param {object | null} xr
 * @param {object} catalog
 */
function buildDisplayDetailsFrom(xr, catalog) {
	const { edidForXrandrOutput } = require('./gpu-edid-probe')
	const displays = (xr?.displays || []).map((d) => {
		const ed = edidForXrandrOutput(d.name, { connected: d.connected, catalog })
		return {
			...d,
			drmName: '',
			drmConnector: '',
			drmCard: ed.drmCard || catalog.defaultCard || 'card0',
			modetestId: null,
			xrandrName: d.name,
			matchMethod: 'xrandr',
			edid: { raw: ed.raw, parsed: ed.parsed },
			monitor: ed.parsed,
			modes: (d.modes || []).map((m) => ({
				width: m.width,
				height: m.height,
				hz: m.hz,
				current: !!m.current,
				preferred: false,
				modetestIndex: null,
			})),
		}
	})

	return displays
		.filter((d) => !isGpuConnectorPseudoName(d?.name))
		.sort((a, b) => {
			const ax = Number(a?.x)
			const bx = Number(b?.x)
			const ay = Number(a?.y)
			const by = Number(b?.y)
			const posKnown = Number.isFinite(ax) && Number.isFinite(bx) && Number.isFinite(ay) && Number.isFinite(by)
			if (posKnown && (ax !== bx || ay !== by)) return ax !== bx ? ax - bx : ay - by
			return compareConnectorNames(a?.name, b?.name)
		})
}

/**
 * Connected displays with resolution, position, refresh rate, and modes from xrandr.
 */
function getDisplayDetails() {
	const { probeGpuEdidCatalog } = require('./gpu-edid-probe')
	const catalog = probeGpuEdidCatalog()
	const xr = getDisplaysXrandrDetailed()
	return buildDisplayDetailsFrom(xr, catalog)
}

/**
 * WO-309: non-blocking sibling of {@link getDisplayDetails}. Same concurrent-fetch +
 * injection pattern as {@link getGpuConnectorInventoryAsync}.
 * @returns {Promise<object[]>}
 */
async function getDisplayDetailsAsync() {
	const { probeGpuEdidCatalog } = require('./gpu-edid-probe')
	const [xr, xrandrVerboseRaw] = await Promise.all([
		getDisplaysXrandrDetailedAsync(),
		getDisplaysXrandrVerboseRawAsync(),
	])
	const catalog = probeGpuEdidCatalog({ xrandrVerboseRaw })
	return buildDisplayDetailsFrom(xr, catalog)
}

/**
 * Returns names of all connected displays (xrandr output names when X is up).
 */
function getConnectedDisplayNames() {
	const xr = getDisplaysXrandr()
	if (xr && xr.length > 0) return xr.map((d) => d.name)

	return (getGpuConnectorInventory() || [])
		.filter((c) => c.connected)
		.map((c) => c.xrandrName || c.shortName)
}

/**
 * Detect GPU model using nvidia-smi.
 * @returns {string|null}
 */
function getGpuModel() {
	try {
		const stdout = execSync('nvidia-smi --query-gpu=gpu_name --format=csv,noheader', {
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 2000,
		}).toString()
		return stdout.trim() || null
	} catch {
		return null
	}
}

module.exports = {
	getXAuthority,
	getDisplaysXrandr,
	getDisplaysXrandrDetailed,
	getDisplaysXrandrDetailedAsync,
	invalidateXrandrCache,
	getDisplaysXrandrVerboseRaw,
	getDisplaysXrandrVerboseRawAsync,
	getGpuConnectorInventory,
	getGpuConnectorInventoryAsync,
	getConnectedDisplayNames,
	getDisplayDetails,
	getDisplayDetailsAsync,
	getGpuModel,
	compareConnectorNames,
	drmShort,
}
