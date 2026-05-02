'use strict'

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

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
 * xrandr often reports `DP-1` while sysfs uses `card0-DP-1` — resolve the directory that has `modes`.
 * @param {string} name
 * @returns {string}
 */
function resolveDrmConnectorDir(name) {
	const base = '/sys/class/drm'
	try {
		if (fs.existsSync(path.join(base, name, 'modes'))) return name
		const short = drmShort(name)
		const files = fs.readdirSync(base)
		for (const f of files) {
			if (!f.includes('-')) continue
			if (drmShort(f) === short && fs.existsSync(path.join(base, f, 'modes'))) return f
		}
	} catch {
		// ignore
	}
	return name
}

/**
 * Read `/sys/class/drm/.../modes` (one `WxH` per line) when xrandr is unavailable or lists no modes.
 * @param {string} drmName — e.g. DP-1 or card0-DP-1
 * @returns {Array<{ width: number, height: number, hz: null, current: boolean }>}
 */
function readDrmModesFromSysfs(drmName) {
	const dir = resolveDrmConnectorDir(drmName)
	try {
		const p = path.join('/sys/class/drm', dir, 'modes')
		if (!fs.existsSync(p)) return []
		const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
		const out = []
		const seen = new Set()
		for (const line of lines) {
			const m = line.match(/^(\d+)x(\d+)/)
			if (!m) continue
			const w = parseInt(m[1], 10)
			const h = parseInt(m[2], 10)
			const key = `${w}x${h}`
			if (seen.has(key)) continue
			seen.add(key)
			out.push({ width: w, height: h, hz: null, current: false })
		}
		return out
	} catch {
		return []
	}
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
function getDisplaysXrandrDetailed() {
	try {
		const stdout = execSync('xrandr --query', {
			stdio: ['ignore', 'pipe', 'ignore'],
			env: { ...process.env, DISPLAY: ':0' },
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
				const m = line.match(/^\s+(\d+)x(\d+)\s+(.+)$/)
				if (m) {
					const w = parseInt(m[1], 10)
					const h = parseInt(m[2], 10)
					const rest = m[3]
					const tokens = rest.trim().split(/\s+/)
					for (const tok of tokens) {
						const hz = parseFloat(tok.replace(/[^0-9.]/g, ''))
						if (!Number.isFinite(hz) || hz <= 0) continue
						const isCurrent = tok.includes('*')
						const key = `${w}x${h}@${hz}`
						if (!cur.modes.some((x) => `${x.width}x${x.height}@${x.hz}` === key)) {
							cur.modes.push({ width: w, height: h, hz, current: isCurrent })
						}
						if (isCurrent) cur.refreshHz = hz
					}
				}
			}
		}
		pushCur()
		return displays
	} catch (e) {
		return null
	}
}

/**
 * Get connected displays using xrandr (if available and X is running).
 * @returns {Array<{name: string, connected: boolean, resolution: string, x: number, y: number}>}
 */
function getDisplaysXrandr() {
	const d = getDisplaysXrandrDetailed()
	if (!d || !d.length) return null
	return d.map((x) => ({
		name: x.name,
		connected: x.connected,
		resolution: x.resolution,
		x: x.x,
		y: x.y,
	}))
}

/**
 * Get connected displays using sysfs /sys/class/drm (Linux).
 * Works without X being started.
 * @returns {Array<{name: string, connected: boolean}>}
 */
function getDisplaysSysfs() {
	const drmPath = '/sys/class/drm'
	if (!fs.existsSync(drmPath)) return []

	const displays = []
	try {
		const files = fs.readdirSync(drmPath)
		for (const file of files) {
			if (file.includes('-')) {
				const statusPath = path.join(drmPath, file, 'status')
				if (fs.existsSync(statusPath)) {
					const status = fs.readFileSync(statusPath, 'utf8').trim()
					if (status === 'connected') {
						displays.push({
							name: file,
							connected: true,
						})
					}
				}
			}
		}
	} catch (e) {
		// ignore
	}
	return displays.sort((a, b) => compareConnectorNames(a?.name, b?.name))
}

function inferConnectorType(name) {
	const s = String(name || '').toUpperCase()
	if (s.includes('HDMI')) return 'hdmi'
	if (s.includes('DISPLAYPORT') || s.includes('DP-') || s.includes('-DP') || s.includes('E-DP') || s.includes('EDP')) return 'displayport'
	if (s.includes('DVI')) return 'dvi'
	if (s.includes('VGA')) return 'vga'
	if (s.includes('USB-C') || s.includes('USBC') || s.includes('TYPEC')) return 'usb-c'
	return 'unknown'
}

/**
 * Enumerate DRM connectors (connected and disconnected) with inferred type.
 * @returns {Array<{name: string, shortName: string, connected: boolean, type: string}>}
 */
function getGpuConnectorInventory() {
	const drmPath = '/sys/class/drm'
	if (!fs.existsSync(drmPath)) return []
	const out = []
	try {
		const files = fs.readdirSync(drmPath)
		for (const file of files) {
			if (!file.includes('-')) continue
			const statusPath = path.join(drmPath, file, 'status')
			if (!fs.existsSync(statusPath)) continue
			const status = String(fs.readFileSync(statusPath, 'utf8') || '').trim().toLowerCase()
			const short = drmShort(file)
			if (isGpuConnectorPseudoName(short) || isGpuConnectorPseudoName(file)) continue
			out.push({
				name: file,
				shortName: short,
				connected: status === 'connected',
				type: inferConnectorType(short),
			})
		}
	} catch {
		return []
	}
	return out.sort((a, b) => compareConnectorNames(a?.shortName || a?.name, b?.shortName || b?.name))
}

/**
 * Connected displays with resolution, position, refresh rate, and available modes (from xrandr when possible).
 * Fills `modes` from `/sys/class/drm/.../modes` when xrandr omits them (common when only sysfs names are available).
 */
function getDisplayDetails() {
	const xr = getDisplaysXrandrDetailed()
	let displays
	if (xr && xr.length) {
		displays = xr
	} else {
		const sys = getDisplaysSysfs()
		displays = sys.map((d) => ({
			name: d.name,
			connected: true,
			resolution: 'unknown',
			x: 0,
			y: 0,
			refreshHz: null,
			modes: [],
		}))
	}
	for (const d of displays) {
		if (!d.modes || d.modes.length === 0) {
			const drm = readDrmModesFromSysfs(d.name)
			if (drm.length) d.modes = drm
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
			return compareConnectorNames(a?.name, b?.name)
		})
}

/**
 * Returns names of all connected displays.
 */
function getConnectedDisplayNames() {
	const xr = getDisplaysXrandr()
	if (xr && xr.length > 0) return xr.map((d) => d.name)

	const sys = getDisplaysSysfs()
	return sys.map((d) => d.name)
}

module.exports = {
	getDisplaysXrandr,
	getDisplaysXrandrDetailed,
	getDisplaysSysfs,
	getGpuConnectorInventory,
	getConnectedDisplayNames,
	getDisplayDetails,
}
