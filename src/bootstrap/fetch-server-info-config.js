'use strict'

const { refreshConfigComparison } = require('../config/config-compare')
const { responseToStr } = require('../utils/query-cycle')

function createFetchServerInfoConfigAndBroadcast({ appCtx, config }) {
	/** Debounce DMX refresh so INFO CONFIG + connect/save do not stop/start sampling twice in one burst. */
	let dmxAfterInfoConfigTimer = null

	return async function fetchServerInfoConfigAndBroadcast() {
		if (!appCtx.amcp?.query?.infoConfig) return
		try {
			const res = await appCtx.amcp.query.infoConfig()
			const xmlStr = responseToStr(res?.data)
			if (!xmlStr || !String(xmlStr).trim()) return
			appCtx.gatheredInfo.infoConfig = xmlStr
			try {
				refreshConfigComparison(appCtx)
			} catch (e) {
				appCtx.log('debug', 'configComparison: ' + (e?.message || e))
			}
			if (typeof appCtx._wsBroadcast === 'function') {
				appCtx._wsBroadcast('state', appCtx.getState())
			}
			if (appCtx.samplingManager && config.dmx?.enabled) {
				clearTimeout(dmxAfterInfoConfigTimer)
				dmxAfterInfoConfigTimer = setTimeout(() => {
					appCtx.samplingManager.updateConfig(config.dmx).catch((e) => {
						appCtx.log('error', '[DMX] Config refresh after INFO CONFIG: ' + (e?.message || e))
					})
				}, 650)
			}
			appCtx.log('info', '[Caspar] INFO CONFIG loaded — channel resolutions match running server')
		} catch (e) {
			appCtx.log('warn', 'INFO CONFIG: ' + (e?.message || e))
		}
	}
}

module.exports = { createFetchServerInfoConfigAndBroadcast }
