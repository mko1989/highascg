/**
 * DeckLink enumeration GET — ffmpeg probe + Caspar log merge (WO-39).
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { probeDecklinkHardware, probeDecklinkFromCasparLog } = require('../utils/decklink-enum')
const { resolveBmdUpdater } = require('./system-hardware-gui')

/**
 * @param {string} candidate
 * @param {string} existing
 */
function isBetterDecklinkLabel(candidate, existing) {
	const c = String(candidate || '').trim()
	const e = String(existing || '').trim()
	if (!c) return false
	if (!e) return true
	const cDeck = /^DeckLink/i.test(c)
	const eDeck = /^DeckLink/i.test(e)
	if (cDeck && !eDeck) return true
	if (!cDeck && eDeck) return false
	return c.length < e.length
}

/**
 * Merge DeckLink rows: OS/ffmpeg first, Caspar log augments labels and persistent IDs.
 * @param {*} primary ffmpeg and/or os_probe result
 * @param {*} clog
 */
function mergeDecklinks(primary, clog) {
	/** @type {Map<number, { index: number, label: string, externalRef?: string }>} */
	const byIdx = new Map()
	for (const c of primary?.connectors || []) {
		byIdx.set(c.index, { index: c.index, label: c.label || `DeckLink [${c.index}]`, externalRef: c.externalRef })
	}
	for (const c of clog?.connectors || []) {
		const existing = byIdx.get(c.index)
		if (!existing) {
			byIdx.set(c.index, {
				index: c.index,
				label: c.label || `DeckLink [${c.index}]`,
				externalRef: c.externalRef,
			})
		} else {
			if (isBetterDecklinkLabel(c.label, existing.label) && c.label) existing.label = c.label
			// Prefer Caspar numeric persistent id over io node name when both exist.
			if (c.externalRef != null && !/^io\d+$/.test(String(c.externalRef))) existing.externalRef = c.externalRef
			else if (existing.externalRef == null && c.externalRef != null) existing.externalRef = c.externalRef
		}
	}
	return [...byIdx.values()].sort((a, b) => a.index - b.index)
}

async function decklinkGet() {
	let ff = null
	try {
		ff = await probeDecklinkHardware({ timeoutMs: 2600 })
	} catch {
		ff = null
	}

	const clog = probeDecklinkFromCasparLog({})
	const primary = ff || { source: 'ffmpeg_decklink', connectors: [], warning: 'ffmpeg probe failed or timed out' }
	const devices = mergeDecklinks(primary, clog)
	const driverHealth = primary.driverHealth || null

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			devices,
			driverHealth,
			sourcesTried: {
				primary: primary.source,
				ffmpeg: primary.sources?.ffmpeg || (primary.source === 'ffmpeg_decklink' ? primary.source : null),
				os: primary.sources?.os || (primary.source === 'os_probe' ? primary.source : null),
				casparLog: clog.source,
				casparLogPath: clog.logPath ?? null,
			},
			warnings: [
				primary.warning,
				clog.warning,
				driverHealth?.firmwareMismatch && !primary.warning?.includes('firmware')
					? driverHealth.warning
					: null,
			].filter(Boolean),
			updaterPath: resolveBmdUpdater(),
		}),
	}
}

module.exports = {
	decklinkGet,
}
