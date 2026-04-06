'use strict'

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

/**
 * Get connected displays using xrandr (if available and X is running).
 * @returns {Array<{name: string, connected: boolean, resolution: string, x: number, y: number}>}
 */
function getDisplaysXrandr() {
	try {
		const stdout = execSync('xrandr --query', { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, DISPLAY: ':0' } }).toString()
		const lines = stdout.split('\n')
		const displays = []

		for (const line of lines) {
			// e.g. "HDMI-0 connected 1920x1080+0+0 (normal left inverted right x axis y axis) 477mm x 268mm"
			const match = line.match(/^(\S+) connected (?:primary )?(\d+)x(\d+)\+(\d+)\+(\d+)/)
			if (match) {
				displays.push({
					name: match[1],
					connected: true,
					resolution: `${match[2]}x${match[3]}`,
					x: parseInt(match[4], 10),
					y: parseInt(match[5], 10)
				})
			} else if (line.includes(' connected')) {
				const parts = line.split(' ')
				displays.push({
					name: parts[0],
					connected: true,
					resolution: 'unknown',
					x: 0,
					y: 0
				})
			}
		}
		return displays
	} catch (e) {
		return null
	}
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
			// Card outputs look like "card0-HDMI-A-1" or "card1-DP-2"
			if (file.includes('-')) {
				const statusPath = path.join(drmPath, file, 'status')
				if (fs.existsSync(statusPath)) {
					const status = fs.readFileSync(statusPath, 'utf8').trim()
					if (status === 'connected') {
						displays.push({
							name: file,
							connected: true
						})
					}
				}
			}
		}
	} catch (e) {
		// ignore
	}
	return displays
}

/**
 * Returns names of all connected displays.
 */
function getConnectedDisplayNames() {
	const xr = getDisplaysXrandr()
	if (xr && xr.length > 0) return xr.map(d => d.name)
	
	const sys = getDisplaysSysfs()
	return sys.map(d => d.name)
}

module.exports = {
	getDisplaysXrandr,
	getDisplaysSysfs,
	getConnectedDisplayNames
}
