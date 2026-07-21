'use strict'

const { execSync } = require('child_process')

/**
 * Both xrandr probes are execSync on the `GET /api/device-view` path, so they block the entire
 * single-threaded server -- AMCP, every WS client, every other route -- for their full duration,
 * not just the Devices view. They were the only sync probes in the codebase with no timeout at all
 * (nvidia-smi below uses 2000, decklink-enum 1500-2000, audio-devices 5000-8000), which meant a
 * wedged or unreachable X server would hang the whole process indefinitely with no recovery.
 * Measured healthy cost on the operator box: xrandr --query ~75-90ms, --verbose ~72ms. 3s is a
 * generous ceiling for a far slower machine while still bounding the pathological case.
 */
const XRANDR_TIMEOUT_MS = 3000

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
 * Parse `xrandr --query` into connected outputs with geometry, current refresh, and listed modes.
 * @returns {Array<{
 *   name: string,
 *   connected: boolean,
 *   resolution: string,
 *   x: number,
 *   y: number,
 *   refreshHz: number | null,
 *   modes: Array<{ width: number, height: number, hz: number, current: boolean }>
 * }> | null}
 */
function getXAuthority() {
	if (process.env.XAUTHORITY) return process.env.XAUTHORITY
	const user = process.env.USER || 'casparcg'
	return `/home/${user}/.Xauthority`
}

function getDisplaysXrandrVerboseRaw() {
	try {
		return execSync('xrandr --verbose', {
			stdio: ['ignore', 'pipe', 'ignore'],
			env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
			timeout: XRANDR_TIMEOUT_MS,
		}).toString()
	} catch (e) {
		console.error(`[Hardware-Info] getDisplaysXrandrVerboseRaw failed:`, e.message)
		return ''
	}
}

/**
 * Parse `xrandr --query` text into display rows (connected heads only).
 * @param {string} stdout
 * @returns {{ displays: object[], raw: string }}
 */
function parseXrandrQueryRaw(stdout) {
	const lines = String(stdout || '').split('\n')
	const displays = []
	let cur = null

	function pushCur() {
		if (cur && cur.connected) displays.push(cur)
		cur = null
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const head = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (head) {
			pushCur()
			const name = head[1]
			const connected = head[2] === 'connected'
			if (!connected) continue
			cur = {
				name,
				connected: true,
				resolution: 'unknown',
				x: 0,
				y: 0,
				refreshHz: null,
				modes: [],
			}
			const geom = line.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/)
			if (geom) {
				cur.resolution = `${geom[1]}x${geom[2]}`
				cur.x = parseInt(geom[3], 10)
				cur.y = parseInt(geom[4], 10)
			}
			continue
		}
		if (cur && cur.connected && /^\s/.test(line) && /\d+x\d+/.test(line)) {
			const full = line.match(/^\s+(\S+)\s+(.+)$/)
			if (full) {
				const modeToken = full[1]
				if (/^\d+x\d+/i.test(modeToken)) {
					const dim = modeToken.match(/^(\d+)x(\d+)/i)
					if (dim) {
						const w = parseInt(dim[1], 10)
						const h = parseInt(dim[2], 10)
						const rest = full[2]
						const tokens = rest.trim().split(/\s+/)
						for (const tok of tokens) {
							const hz = parseFloat(tok.replace(/[^0-9.]/g, ''))
							if (!Number.isFinite(hz) || hz <= 0) continue
							const isCurrent = tok.includes('*')
							const key = `${modeToken}@${hz}`
							if (!cur.modes.some((x) => `${x.randrMode}@${x.hz}` === key)) {
								cur.modes.push({
									width: w,
									height: h,
									hz,
									current: isCurrent,
									randrMode: modeToken,
								})
							}
							if (isCurrent) cur.refreshHz = hz
						}
					}
				}
			}
		}
	}
	pushCur()
	return { displays, raw: String(stdout || '') }
}

/**
 * `xrandr --query` hits the live X server (the one Caspar's screen consumers render on);
 * uncached calls several times per second visibly stutter playout. Short TTL keeps hot
 * paths (AMCP notify hooks, layout lookups) off X; call {@link invalidateXrandrCache}
 * after applying a new layout.
 */
const XRANDR_CACHE_TTL_MS = Math.max(
	0,
	parseInt(process.env.HIGHASCG_XRANDR_CACHE_TTL_MS || '3000', 10) || 3000,
)
/** @type {{ at: number, value: object | null } | null} */
let _xrandrCache = null

function invalidateXrandrCache() {
	_xrandrCache = null
	try {
		const { invalidateGpuEdidCache } = require('./gpu-edid-probe')
		invalidateGpuEdidCache()
	} catch {
		/* optional */
	}
}

function getDisplaysXrandrDetailed() {
	if (_xrandrCache && Date.now() - _xrandrCache.at < XRANDR_CACHE_TTL_MS) {
		return _xrandrCache.value
	}
	const value = getDisplaysXrandrDetailedUncached()
	_xrandrCache = { at: Date.now(), value }
	return value
}

function getDisplaysXrandrDetailedUncached() {
	try {
		const stdout = execSync('xrandr --query', {
			stdio: ['ignore', 'pipe', 'ignore'],
			env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
			timeout: XRANDR_TIMEOUT_MS,
		}).toString()
		if (String(stdout || '').trim()) {
			return parseXrandrQueryRaw(stdout)
		}
	} catch (e) {
		console.error(`[Hardware-Info] getDisplaysXrandrDetailed failed:`, e.message)
	}

	try {
		const { readBootXrandrSnapshot } = require('./boot-xrandr-snapshot')
		const boot = readBootXrandrSnapshot()
		if (boot?.raw) {
			const parsed = parseXrandrQueryRaw(boot.raw)
			return { ...parsed, source: 'boot-snapshot', bootPath: boot.path }
		}
	} catch {
		/* optional */
	}

	return null
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
function getGpuConnectorInventory() {
	const { probeGpuEdidCatalog, attachEdidToConnector } = require('./gpu-edid-probe')
	const catalog = probeGpuEdidCatalog()
	const xr = getDisplaysXrandrDetailed()
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

/**
 * Connected displays with resolution, position, refresh rate, and modes from xrandr.
 */
function getDisplayDetails() {
	const { probeGpuEdidCatalog, edidForXrandrOutput } = require('./gpu-edid-probe')
	const catalog = probeGpuEdidCatalog()
	const xr = getDisplaysXrandrDetailed()
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
	invalidateXrandrCache,
	getDisplaysXrandrVerboseRaw,
	getGpuConnectorInventory,
	getConnectedDisplayNames,
	getDisplayDetails,
	getGpuModel,
	compareConnectorNames,
	drmShort,
}
