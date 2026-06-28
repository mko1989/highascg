'use strict'

/**
 * Parse one Satellite protocol line into { command, args }.
 * @param {string} line
 */
function parseSatelliteLine(line) {
	const trimmed = String(line || '').trim()
	if (!trimmed) return null
	const space = trimmed.indexOf(' ')
	const command = space === -1 ? trimmed : trimmed.slice(0, space)
	const rest = space === -1 ? '' : trimmed.slice(space + 1)
	const args = {}
	if (rest) {
		const re = /([\w-]+)=("(?:\\.|[^"\\])*"|[^\s]+)/g
		let m
		while ((m = re.exec(rest)) !== null) {
			let val = m[2]
			if (val.startsWith('"') && val.endsWith('"')) {
				val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
			}
			args[m[1]] = val
		}
	}
	return { command, args }
}

/**
 * @param {string} command
 * @param {Record<string, string | number | boolean>} args
 */
function formatSatelliteLine(command, args) {
	const parts = [command]
	for (const [k, v] of Object.entries(args || {})) {
		if (v === undefined || v === null) continue
		const s = String(v)
		if (/[\s"]/.test(s)) parts.push(`${k}="${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
		else parts.push(`${k}=${s}`)
	}
	return parts.join(' ') + '\n'
}

module.exports = { parseSatelliteLine, formatSatelliteLine }
