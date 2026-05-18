/**
 * DeckLink enumeration GET — ffmpeg probe + Caspar log merge (WO-39).
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { probeDecklinkHardware, probeDecklinkFromCasparLog } = require('../utils/decklink-enum')
const { resolveBmdUpdater } = require('./system-hardware-gui')

/**
 * Prefer ffmpeg enumeration; augment from recent Caspar log (model + internal device id).
 * @param {*} ff
 * @param {*} clog
 */
function mergeDecklinks(ff, clog) {
	/** @type {Map<number, { index: number, label: string, externalRef?: string }>} */
	const byIdx = new Map()
	for (const c of ff?.connectors || []) {
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
			const labelBetter = existing.label.length < (c.label || '').length
			if (labelBetter && c.label) existing.label = c.label
			if (existing.externalRef == null && c.externalRef != null) existing.externalRef = c.externalRef
		}
	}
	const devices = [...byIdx.values()].sort((a, b) => a.index - b.index)
	return devices
}

async function decklinkGet() {
	let ff = null
	try {
		ff = await probeDecklinkHardware({ timeoutMs: 2600 })
	} catch {
		ff = null
	}

	const clog = probeDecklinkFromCasparLog({})
	const ffmpeg = ff || { source: 'ffmpeg_decklink', connectors: [], warning: 'ffmpeg probe failed or timed out' }
	const devices = mergeDecklinks(ffmpeg, clog)

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			devices,
			sourcesTried: {
				ffmpeg: ffmpeg.source,
				casparLog: clog.source,
				casparLogPath: clog.logPath ?? null,
			},
			warnings: [
				ffmpeg.warning,
				clog.warning,
			].filter(Boolean),
			updaterPath: resolveBmdUpdater(),
		}),
	}
}

module.exports = {
	decklinkGet,
}
