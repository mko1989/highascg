'use strict'

const { normalizePortName } = require('./gpu-topology-xrandr')

/** @param {string} name */
function connectorMediaKind(name) {
	const s = String(name || '')
		.trim()
		.toUpperCase()
		.replace(/^CARD\d+-/i, '')
	if (/^HDMI/.test(s)) return 'hdmi'
	if (/^(E-?DP|EDP)/.test(s)) return 'edp'
	if (/^DP/.test(s)) return 'dp'
	if (/^DVI/.test(s)) return 'dvi'
	if (/^VGA/.test(s)) return 'vga'
	return 'other'
}

/**
 * Score how likely an xrandr output name matches a DRM connector short name.
 * @param {string} xrandrName
 * @param {string} drmShort
 */
function aliasNameScore(xrandrName, drmShort) {
	const a = String(xrandrName || '').toUpperCase()
	const b = String(drmShort || '').toUpperCase()
	let score = 0
	if (connectorMediaKind(a) === connectorMediaKind(b)) score += 10
	const digitsA = a.match(/\d+/g) || []
	const digitsB = b.match(/\d+/g) || []
	for (const da of digitsA) {
		if (digitsB.includes(da)) score += 5
	}
	return score
}

/**
 * Match xrandr connected display to a DRM topology row when names differ (NVIDIA vs DRM sysfs).
 * @param {object} topologyRow
 * @param {Array<{ name?: string, connected?: boolean }>} displayList
 * @param {Map<string, { connected?: boolean }>} connectorByDrm
 * @param {Set<string>} usedDisplayKeys normalized display keys already assigned
 * @returns {{ display: object, key: string } | null}
 */
function resolveDisplayByDrmHeuristic(topologyRow, displayList, connectorByDrm, usedDisplayKeys) {
	const drmName = String(topologyRow?.drmName || '').trim()
	const drmKey = drmName.toLowerCase()
	if (!drmKey) return null

	const conn = connectorByDrm.get(drmKey)
	if (!conn?.connected) return null

	const kind = connectorMediaKind(drmName || topologyRow?.dpA)
	if (kind === 'other') return null

	const candidates = displayList.filter((d) => {
		if (!d?.connected) return false
		const k = normalizePortName(d.name)
		if (!k || usedDisplayKeys.has(k)) return false
		return connectorMediaKind(d.name) === kind
	})

	if (!candidates.length) return null

	let best = candidates[0]
	if (candidates.length > 1) {
		const drmShort = drmName.replace(/^card\d+-/i, '')
		let bestScore = -1
		for (const d of candidates) {
			const score = aliasNameScore(d.name, drmShort)
			if (score > bestScore) {
				bestScore = score
				best = d
			}
		}
	}

	const key = normalizePortName(best.name)
	return key ? { display: best, key } : null
}

module.exports = {
	connectorMediaKind,
	aliasNameScore,
	resolveDisplayByDrmHeuristic,
}
