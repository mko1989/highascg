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

/**
 * What is actually running on one stage layer, per Caspar's INFO XML.
 *
 * Shape confirmed against this build (2.6.0 253c16c Dev) on 2026-07-21:
 *   channel.stage.layer.layer_4.foreground = {
 *     producer: 'decklink', has_signal: 'false',
 *     file: { name: 'DeckLink 8K Pro', path: '4', format: '1080p5000', … } }
 * For a DeckLink producer `file.path` carries the DEVICE INDEX, not a filename.
 *
 * @param {string} xmlStr
 * @param {number} layer
 * @returns {Promise<{producer: string, device: number|null, hasSignal: boolean|null, path: string}|null>}
 *   null when the XML is unparseable or the layer is empty (caller must not treat that as "absent"
 *   without checking — an unparseable INFO is unknown, not proof of nothing).
 */
function foregroundProducerOnLayer(xmlStr, layer) {
	const n = parseInt(String(layer), 10)
	if (!xmlStr || typeof xmlStr !== 'string' || !xmlStr.includes('<channel') || !Number.isFinite(n)) {
		return Promise.resolve(null)
	}
	return new Promise((resolve) => {
		parseString(xmlStr, { explicitArray: false }, (err, result) => {
			if (err || !result) return resolve(null)
			try {
				const layerObj = result.channel?.stage?.layer
				const lr = layerObj?.[`layer_${n}`]
				const fg = lr?.foreground
				const producer = String(fg?.producer || '').trim()
				if (!producer || producer === 'empty') return resolve(null)
				const rawPath = fg?.file?.path != null ? String(fg.file.path).trim() : ''
				const deviceNum = /^\d+$/.test(rawPath) ? parseInt(rawPath, 10) : NaN
				const sig = fg?.has_signal != null ? String(fg.has_signal).trim().toLowerCase() : ''
				resolve({
					producer,
					device: Number.isFinite(deviceNum) ? deviceNum : null,
					hasSignal: sig === 'true' ? true : sig === 'false' ? false : null,
					path: rawPath,
				})
			} catch {
				resolve(null)
			}
		})
	})
}

/**
 * True when `layer` already runs a DeckLink producer for exactly `device`.
 * @param {{producer: string, device: number|null}|null} fg result of {@link foregroundProducerOnLayer}
 * @param {number} device
 */
function isDecklinkProducerForDevice(fg, device) {
	const want = parseInt(String(device), 10)
	if (!fg || !Number.isFinite(want)) return false
	return fg.producer === 'decklink' && fg.device === want
}

module.exports = {
	infoResponseToXml,
	listOccupiedStageLayersInRange,
	foregroundProducerOnLayer,
	isDecklinkProducerForDevice,
}
