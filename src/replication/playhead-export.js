'use strict'

const { parseString } = require('xml2js')
const { getChannelMap } = require('../config/routing')
const liveSceneState = require('../state/live-scene-state')
const { infoResponseToXml } = require('../caspar/channel-info-xml')
const { getInfoXml2jsOptions, extractChannelInfoFromParsed } = require('../state/info-channel-parse')

/**
 * @param {string} xmlStr
 * @returns {Promise<{ framerate: string, layers: Record<string, { clip: string, state: string, timeSec: number, frame: number, fps: number }> }>}
 */
function parseChannelPlayheadXml(xmlStr) {
	return new Promise((resolve) => {
		if (!xmlStr || !xmlStr.includes('<')) {
			resolve({ framerate: '', layers: {} })
			return
		}
		parseString(xmlStr, getInfoXml2jsOptions(), (err, result) => {
			if (err || !result) {
				resolve({ framerate: '', layers: {} })
				return
			}
			try {
				const { framerate, layers: parsedLayers } = extractChannelInfoFromParsed(result)
				const fps = parseInt(framerate, 10) || 25
				/** @type {Record<string, { clip: string, state: string, timeSec: number, frame: number, fps: number }>} */
				const layers = {}
				for (let layerIdx = 0; layerIdx < parsedLayers.length; layerIdx++) {
					const entry = parsedLayers[layerIdx]
					if (!entry?.fgClip) continue
					const timeSec = parseFloat(entry.timeSec)
					if (!Number.isFinite(timeSec)) continue
					layers[String(layerIdx)] = {
						clip: String(entry.fgClip),
						state: String(entry.fgState || 'empty'),
						timeSec,
						frame: Math.max(0, Math.round(timeSec * fps)),
						fps,
					}
				}
				resolve({ framerate: String(framerate || fps), layers })
			} catch {
				resolve({ framerate: '', layers: {} })
			}
		})
	})
}

/**
 * Sample playhead for all live program channels (local Caspar).
 * @param {object} ctx
 * @returns {Promise<{ at: number, channels: Record<string, { sceneId: string, framerate: string, layers: Record<string, object> }> }>}
 */
async function exportProgramPlayheads(ctx) {
	const at = Date.now()
	/** @type {Record<string, { sceneId: string, framerate: string, layers: Record<string, object> }>} */
	const channels = {}
	if (!ctx?.amcp?.info) return { at, channels }

	const map = getChannelMap(ctx.config || {})
	const live = liveSceneState.getAll()

	for (let screenIdx = 1; screenIdx <= map.screenCount; screenIdx++) {
		const pgmCh = map.programCh(screenIdx)
		const entry = live[String(pgmCh)]
		if (!entry?.sceneId) continue
		try {
			const res = await ctx.amcp.info(pgmCh)
			const xml = infoResponseToXml(res)
			const parsed = await parseChannelPlayheadXml(xml)
			if (Object.keys(parsed.layers).length === 0) continue
			channels[String(pgmCh)] = {
				sceneId: String(entry.sceneId),
				framerate: parsed.framerate,
				layers: parsed.layers,
			}
		} catch {
			/* channel INFO failed */
		}
	}

	return { at, channels }
}

module.exports = { exportProgramPlayheads, parseChannelPlayheadXml }
