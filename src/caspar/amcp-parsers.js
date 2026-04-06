'use strict'

/**
 * @param {string[]} lines
 * @returns {Array<{ name: string, type: string, size: number, modified: string, frames: number, framerate: number }>}
 */
function parseClsList(lines) {
	const result = []
	for (const line of lines) {
		const parts = line.split(/\s+/)
		if (parts.length >= 2) {
			const name = parts[0].replace(/"/g, '')
			const type = parts[1]
			const size = parseInt(parts[2], 10) || 0
			const modified = parts[3] ? parts.slice(3).join(' ') : ''
			// usually format: "CLIP_NAME" TYPE SIZE YYYYMMDDHHMMSS FRAMES FRAMERATE
			// Actually caspar output: "name" TYPE SIZE DATE ...
			// For simplicity we just capture what we can
			let frames = 0
			let framerate = 0
			const fMatch = line.match(/\d{8}\d{6}\s+(\d+)\s+([\d.]+)/)
			if (fMatch) {
				frames = parseInt(fMatch[1], 10) || 0
				framerate = parseFloat(fMatch[2]) || 0
			}
			result.push({ name, type, size, modified, frames, framerate })
		}
	}
	return result
}

function parseTlsList(lines) {
	const result = []
	for (const line of lines) {
		const parts = line.split(/\s+/)
		if (parts.length >= 2) {
			result.push({
				name: parts[0].replace(/"/g, ''),
				path: parts.slice(1).join(' '),
			})
		}
	}
	return result
}

function parseFlsList(lines) {
	return parseTlsList(lines) // Same structure conceptually: "name" "path"
}

function parseCinf(data) {
	// e.g. "name" TYPE SIZE DATE FRAMES FRAMERATE
	const str = Array.isArray(data) ? data.join(' ') : String(data)
	const parsed = parseClsList([str])
	if (parsed.length > 0) return parsed[0]
	return null
}

function parseThumbnailList(lines) {
	const result = []
	for (const line of lines) {
		const parts = line.split(/\s+/)
		if (parts.length >= 3) {
			result.push({
				name: parts[0].replace(/"/g, ''),
				modified: parts[1],
				size: parseInt(parts[2], 10) || 0,
			})
		}
	}
	return result
}

function parseInfoList(lines) {
	const result = []
	for (const line of lines) {
		const parts = line.split(/\s+/)
		if (parts.length >= 3) {
			result.push({
				channel: parseInt(parts[0], 10) || 0,
				videoMode: parts[1],
				status: parts.slice(2).join(' '),
			})
		}
	}
	return result
}

function parseVersion(data) {
	const str = Array.isArray(data) ? data[0] : String(data || '')
	// e.g. "2.3.3 ceba434"
	return {
		version: str.split(' ')[0] || str,
		label: str,
	}
}

function parseInfoChannel(xmlData) {
	const str = Array.isArray(xmlData) ? xmlData.join('\n') : String(xmlData || '')
	// Usually parsed by xml2js later, but let's provide a basic parser hook
	let parsed = {}
	try {
		require('xml2js').parseString(str, { explicitArray: false }, (err, result) => {
			if (!err) parsed = result
		})
	// parseString is async by default when calling like this, but if no callback it returns undefined usually.. wait, parseString is synchronous if no IO.
	} catch {}
	return parsed
}

function parseMixerValue(data) {
	const str = Array.isArray(data) ? data.join(' ') : String(data || '')
	const parts = str.split(/\s+/)
	if (parts.length === 1) {
		const f = parseFloat(parts[0])
		return isNaN(f) ? parts[0] : f
	}
	return parts.map(p => {
		const f = parseFloat(p)
		return isNaN(f) ? p : f
	})
}

module.exports = {
	parseClsList,
	parseTlsList,
	parseFlsList,
	parseCinf,
	parseThumbnailList,
	parseInfoList,
	parseInfoChannel,
	parseVersion,
	parseMixerValue
}
