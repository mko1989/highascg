'use strict'

const { refreshConfigComparison } = require('../config/config-compare')
const { responseToStr } = require('../utils/query-cycle')
const { runStartupLedTestPatternIfNeeded } = require('./startup-led-test-pattern')

/**
 * @param {{
 *   appCtx: object,
 *   config: object,
 *   onAfterInfoConfigReady?: () => void,
 * }} opts
 * `onAfterInfoConfigReady` runs after INFO CONFIG is fetched (or fails), config comparison is updated when XML exists,
 * and startup LED test pattern AMCP is sent. Use for NDI / UDP STREAM / go2rtc so they start only after Caspar vs HighAsCG alignment.
 */
function createFetchServerInfoConfigAndBroadcast({ appCtx, config, onAfterInfoConfigReady }) {
	/** Debounce DMX refresh so INFO CONFIG + connect/save do not stop/start sampling twice in one burst. */
	let dmxAfterInfoConfigTimer = null

	return async function fetchServerInfoConfigAndBroadcast() {
		if (!appCtx.amcp?.query?.infoConfig) {
			try {
				onAfterInfoConfigReady?.()
			} catch (e) {
				appCtx.log('warn', '[Caspar] onAfterInfoConfigReady: ' + (e?.message || e))
			}
			return
		}
		try {
			const res = await appCtx.amcp.query.infoConfig()
			const xmlStr = responseToStr(res?.data)
			if (!xmlStr || !String(xmlStr).trim()) {
				appCtx.log('warn', 'INFO CONFIG: empty response')
			} else {
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
				try {
					await runStartupLedTestPatternIfNeeded(appCtx)
				} catch (e) {
					appCtx.log('debug', '[Startup LED test] ' + (e?.message || e))
				}
			}
		} catch (e) {
			appCtx.log('warn', 'INFO CONFIG: ' + (e?.message || e))
		} finally {
			try {
				onAfterInfoConfigReady?.()
			} catch (e) {
				appCtx.log('warn', '[Caspar] onAfterInfoConfigReady: ' + (e?.message || e))
			}
		}
	}
}

module.exports = { createFetchServerInfoConfigAndBroadcast }
