/**
 * Program output pixel size for a screen index — matches Caspar INFO CONFIG when available.
 */
'use strict'

const { getChannelMap } = require('../config/routing')
const { buildChannelResolutionMap } = require('../config/server-info-config')

/**
 * @param {object} self - app context (config, gatheredInfo)
 * @param {number} [screenIdx=0]
 * @returns {{ w: number, h: number }}
 */
function getProgramResolutionForScreen(self, screenIdx = 0) {
	const cfg = self?.config || {}
	const map = getChannelMap(cfg)
	const ch = map.programCh(screenIdx + 1)
	const infoXml = self?.gatheredInfo?.infoConfig || ''
	const serverByCh = infoXml.trim() ? buildChannelResolutionMap(infoXml) : {}
	const r = serverByCh[ch]
	if (r && r.w > 0 && r.h > 0) return { w: r.w, h: r.h }
	return { w: 1920, h: 1080 }
}

module.exports = { getProgramResolutionForScreen }
