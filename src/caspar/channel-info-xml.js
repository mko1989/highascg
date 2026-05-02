'use strict'

const { parseString } = require('xml2js')

/**
 * @param {*} res - AMCP INFO channel response (`data` holds XML lines)
 * @returns {string}
 */
function infoResponseToXml(res) {
	if (res?.data != null) {
		return Array.isArray(res.data) ? res.data.join('\n') : String(res.data)
	}
	return ''
}

/**
 * Collect physical layer indices under `channel.stage.layer` that appear in Caspar INFO XML.
 * Mirrors {@link StateManager#updateFromInfo} traversal (layer_10, layer_11, …).
 *
 * @param {string} xmlStr
 * @param {number} minLayer
 * @param {number} maxLayer
 * @returns {Promise<number[] | null>} Sorted unique layers, or **null** if XML could not be parsed (caller should fall back)
 */
function listOccupiedStageLayersInRange(xmlStr, minLayer, maxLayer) {
	if (!xmlStr || typeof xmlStr !== 'string' || !xmlStr.includes('<channel')) {
		return Promise.resolve(null)
	}
	return new Promise((resolve) => {
		parseString(xmlStr, { explicitArray: false }, (err, result) => {
			if (err || !result) return resolve(null)
			try {
				const out = new Set()
				const ch = result.channel
				if (!ch) return resolve([])
				const stage = ch.stage
				const stageEl = Array.isArray(stage) ? stage[0] : stage
				if (!stageEl) return resolve([])
				const layerWrap = stageEl.layer
				const layerObj = Array.isArray(layerWrap) ? layerWrap[0] : layerWrap
				if (layerObj && typeof layerObj === 'object') {
					for (const key of Object.keys(layerObj)) {
						if (!key.startsWith('layer_')) continue
						const n = parseInt(key.replace('layer_', ''), 10)
						if (Number.isFinite(n) && n >= minLayer && n <= maxLayer) out.add(n)
					}
				}
				resolve([...out].sort((a, b) => a - b))
			} catch {
				resolve(null)
			}
		})
	})
}

module.exports = {
	infoResponseToXml,
	listOccupiedStageLayersInRange,
}
