'use strict'

/** WO-836 Part 3c — Caspar INFO <ch> XML → "what is playing": clip per layer. Reuses the node's own parser. */

const { parseString } = require('xml2js')
const { getInfoXml2jsOptions, extractChannelInfoFromParsed } = require('../../../src/state/info-channel-parse')

/**
 * @param {string} xml
 * @param {number|null} [layer] keep only this layer
 * @returns {Promise<{framerate:string, layers: Array<{layer:number, clip:string, state:string, background:string, time_s:string, duration_s:string, remaining_s:string}>}>}
 */
function parseInfo(xml, layer = null) {
	return new Promise((resolve, reject) => {
		if (!xml || !xml.includes('<channel')) return reject(new Error(`INFO did not return channel XML (got: ${String(xml).slice(0, 120)})`))
		parseString(xml, getInfoXml2jsOptions(), (err, result) => {
			if (err) return reject(new Error(`INFO XML did not parse: ${err.message}`))
			const { framerate, layers } = extractChannelInfoFromParsed(result)
			const out = []
			layers.forEach((l, idx) => {
				if (!l) return
				if (layer != null && idx !== layer) return
				out.push({ layer: idx, clip: l.fgClip || '', state: l.fgState, background: l.bgClip || '', time_s: l.timeSec, duration_s: l.durationSec, remaining_s: l.remainingSec })
			})
			resolve({ framerate, layers: out })
		})
	})
}

module.exports = { parseInfo }
