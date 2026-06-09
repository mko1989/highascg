'use strict'

const { execSync } = require('child_process')
const {
	probeModetestConnectors,
	parseXrandrVerboseOutputs,
	modetestModesToDisplayModes,
} = require('./gpu-modetest')

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
		}).toString()
	} catch (e) {
		console.error(`[Hardware-Info] getDisplaysXrandrVerboseRaw failed:`, e.message)
		return ''
	}
}

function getDisplaysXrandrDetailed() {
	try {
		const stdout = execSync('xrandr --query', {
			stdio: ['ignore', 'pipe', 'ignore'],
			env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
		}).toString()
		const lines = stdout.split('\n')
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
		return { displays, raw: stdout }
	} catch (e) {
		console.error(`[Hardware-Info] getDisplaysXrandrDetailed failed:`, e.message)
		return null
	}
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

let _modetestProbeCache = null
let _modetestProbeAt = 0
const MODETEST_PROBE_TTL_MS = 2000

/**
 * Probe GPU connectors via `modetest -c` and correlate to xrandr by EDID.
 * @param {{ refresh?: boolean, xrandrVerboseRaw?: string }} [opts]
 */
function getModetestProbe(opts = {}) {
	const now = Date.now()
	if (!opts.refresh && _modetestProbeCache && now - _modetestProbeAt < MODETEST_PROBE_TTL_MS) {
		return _modetestProbeCache
	}
	const xrandrVerboseRaw = opts.xrandrVerboseRaw ?? getDisplaysXrandrVerboseRaw()
	const probe = probeModetestConnectors({ xrandrVerboseRaw })
	_modetestProbeCache = probe
	_modetestProbeAt = now
	return probe
}

/**
 * Enumerate DRM connectors (connected and disconnected) from modetest with inferred type.
 * @returns {Array<{
 *   name: string,
 *   shortName: string,
 *   connected: boolean,
 *   type: string,
 *   modetestId: number,
 *   drmCard: string,
 *   modes: object[],
 *   edid: string,
 *   xrandrName: string | null,
 *   matchMethod: string | null,
 *   sizeMm: object | null
 * }>}
 */
function getGpuConnectorInventory() {
	const probe = getModetestProbe()
	const connectors = probe?.connectors || []
	return connectors
		.map((c) => ({
			name: c.name,
			shortName: c.shortName,
			connected: !!c.connected,
			type: c.type,
			modetestId: c.id,
			drmCard: c.drmCard,
			modes: c.modes || [],
			edid: c.edid || '',
			xrandrName: c.xrandrName || null,
			matchMethod: c.matchMethod || null,
			sizeMm: c.sizeMm || null,
		}))
		.sort((a, b) => compareConnectorNames(a?.shortName || a?.name, b?.shortName || b?.name))
}

/**
 * Connected displays with resolution, position, refresh rate, and available modes.
 * Modes and EDID come from modetest; geometry and xrandr output names from xrandr.
 */
function getDisplayDetails() {
	const xr = getDisplaysXrandrDetailed()
	const xrandrVerboseRaw = getDisplaysXrandrVerboseRaw()
	const probe = getModetestProbe({ refresh: true, xrandrVerboseRaw })
	const modetestByXrandr = new Map()
	const modetestByShort = new Map()
	for (const c of probe.connectors || []) {
		modetestByShort.set(drmShort(c.shortName).toLowerCase(), c)
		if (c.xrandrName) modetestByXrandr.set(c.xrandrName, c)
	}

	const displays = []
	if (xr?.displays?.length) {
		for (const d of xr.displays) {
			const modetest = modetestByXrandr.get(d.name) || null
			const modes = modetest?.modes?.length
				? modetestModesToDisplayModes(modetest.modes, d.resolution, d.refreshHz)
				: d.modes
			displays.push({
				...d,
				drmName: modetest?.name || '',
				drmConnector: modetest?.shortName || '',
				drmCard: modetest?.drmCard || '',
				modetestId: modetest?.id ?? null,
				xrandrName: d.name,
				matchMethod: modetest?.matchMethod || null,
				edid: modetest?.edid || '',
				modes,
			})
		}
	} else {
		for (const c of probe.connectors || []) {
			if (!c.connected) continue
			displays.push({
				name: c.xrandrName || c.shortName,
				xrandrName: c.xrandrName || null,
				drmName: c.name,
				drmConnector: c.shortName,
				drmCard: c.drmCard,
				modetestId: c.id,
				matchMethod: c.matchMethod || null,
				edid: c.edid || '',
				connected: true,
				resolution: 'unknown',
				x: 0,
				y: 0,
				refreshHz: null,
				modes: modetestModesToDisplayModes(c.modes),
			})
		}
	}

	return displays
		.filter((d) => !isGpuConnectorPseudoName(d?.name))
		.sort((a, b) => {
			const ax = Number(a?.x)
			const bx = Number(b?.x)
			const ay = Number(a?.y)
			const by = Number(b?.y)
			const posKnown = Number.isFinite(ax) && Number.isFinite(bx) && Number.isFinite(ay) && Number.isFinite(by)
			if (posKnown && (ax !== bx || ay !== by)) return ax !== bx ? ax - bx : ay - by
			return compareConnectorNames(a?.drmConnector || a?.name, b?.drmConnector || b?.name)
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
	getDisplaysXrandrVerboseRaw,
	getGpuConnectorInventory,
	getModetestProbe,
	getConnectedDisplayNames,
	getDisplayDetails,
	getGpuModel,
	compareConnectorNames,
	drmShort,
	parseXrandrVerboseOutputs,
}
