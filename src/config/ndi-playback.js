'use strict'

/**
 * Parse NDI LIST display form "HOST (Source)" into Caspar ndi:// URL.
 * @param {string} raw
 * @returns {string}
 */
function normalizeNdiSourceName(raw) {
	const s = String(raw || '').trim()
	if (!s) throw new Error('NDI source name required')
	if (s.startsWith('ndi://')) return s
	const listMatch = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
	if (listMatch) {
		const machine = listMatch[1].trim().toLowerCase()
		const source = listMatch[2].trim()
		return `ndi://${machine}/"${source}"`
	}
	if (s.includes('"')) return s
	return `ndi://${s}`
}

/**
 * Human label for UI from stored ndi:// URL or plain name.
 * @param {string} ndiName
 * @returns {string}
 */
function ndiDisplayLabel(ndiName) {
	const s = String(ndiName || '').trim()
	if (!s.startsWith('ndi://')) return s
	const rest = s.slice(6)
	const quoted = rest.match(/^([^/]+)\/"([^"]+)"/)
	if (quoted) {
		return `${quoted[1].toUpperCase()} (${quoted[2]})`
	}
	const slash = rest.indexOf('/')
	if (slash >= 0) {
		const machine = rest.slice(0, slash)
		const source = rest.slice(slash + 1)
		return source.includes(' ') ? `${machine.toUpperCase()} (${source})` : `${machine}/${source}`
	}
	return rest
}

/**
 * @param {string} s
 */
function escapeAmcpQuotedString(s) {
	return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Build AMCP lines to start an NDI host producer.
 * ndi:// URLs must be passed as raw clips — not PLAY … NDI "ndi://…".
 * @param {number} channel
 * @param {number} layer
 * @param {string} ndiName
 * @returns {string[]}
 */
function buildNdiHostPlayCommands(channel, layer, ndiName) {
	const ch = parseInt(String(channel ?? ''), 10)
	const ly = parseInt(String(layer ?? ''), 10) || 1
	const name = String(ndiName || '').trim()
	if (!name || !Number.isFinite(ch) || ch < 1) return []

	if (name.startsWith('ndi://')) {
		return [`PLAY ${ch}-${ly} ${name}`, `MIXER ${ch} COMMIT`]
	}

	const esc = escapeAmcpQuotedString(name)
	return [`PLAY ${ch}-${ly} NDI "${esc}"`, `MIXER ${ch} COMMIT`]
}

module.exports = {
	normalizeNdiSourceName,
	ndiDisplayLabel,
	buildNdiHostPlayCommands,
}
